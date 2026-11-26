/**
 * A small Molang syntax checker. molangjs (the runtime evaluator Snowstorm uses) is deliberately lenient
 * and returns 0 for broken input, so we parse expressions ourselves to report real errors.
 */
import { MATH_FUNCTIONS, BUILTIN_VARIABLES } from './schema';
import { closest } from './util';

type Tok = { t: 'num' | 'id' | 'str' | 'op' | 'eof'; v: string; pos: number };

const OPS = ['??', '&&', '||', '==', '!=', '<=', '>=', '->', '<', '>', '+', '-', '*', '/', '!', '?', ':', '=', '(', ')', '[', ']', '{', '}', ',', ';'];

function tokenize(src: string): { toks: Tok[]; error?: string } {
	const toks: Tok[] = [];
	let i = 0;
	while (i < src.length) {
		const c = src[i];
		if (/\s/.test(c)) { i++; continue; }
		if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
			const m = /^[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?f?/.exec(src.slice(i))!;
			toks.push({ t: 'num', v: m[0], pos: i });
			i += m[0].length;
			continue;
		}
		if (/[A-Za-z_]/.test(c)) {
			const m = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/.exec(src.slice(i))!;
			toks.push({ t: 'id', v: m[0], pos: i });
			i += m[0].length;
			continue;
		}
		if (c === "'") {
			const end = src.indexOf("'", i + 1);
			if (end < 0) return { toks, error: `Unclosed string starting at ${i}` };
			toks.push({ t: 'str', v: src.slice(i, end + 1), pos: i });
			i = end + 1;
			continue;
		}
		const op = OPS.find(o => src.startsWith(o, i));
		if (!op) return { toks, error: `Unexpected character "${c}" at position ${i}` };
		toks.push({ t: 'op', v: op, pos: i });
		i += op.length;
	}
	toks.push({ t: 'eof', v: '', pos: src.length });
	return { toks };
}

export interface MolangCheck {
	errors: string[];
	warnings: string[];
	/** variable.* names read (normalized, without prefix) */
	reads: Set<string>;
	/** variable.* names assigned */
	writes: Set<string>;
}

const KEYWORDS = new Set(['return', 'loop', 'for_each', 'break', 'continue', 'this', 'true', 'false']);

export function checkMolang(src: string): MolangCheck {
	const res: MolangCheck = { errors: [], warnings: [], reads: new Set(), writes: new Set() };
	const { toks, error } = tokenize(src);
	if (error) { res.errors.push(error); return res; }
	let p = 0;
	const peek = () => toks[p];
	const next = () => toks[p++];
	const fail = (msg: string) => { throw new Error(msg); };
	const expect = (v: string) => {
		const t = next();
		if (t.v !== v) fail(`Expected "${v}" but found "${t.v || 'end of expression'}" at position ${t.pos}`);
	};

	const normVar = (id: string): string | null => {
		const m = /^(variable|v)\.([A-Za-z0-9_]+)/i.exec(id);
		return m ? m[2].toLowerCase() : null;
	};

	const checkIdentifier = (id: string, isCall: boolean) => {
		const lower = id.toLowerCase();
		const [ns, ...rest] = lower.split('.');
		const name = rest.join('.');
		if (KEYWORDS.has(lower)) return;
		if (ns === 'math') {
			if (!name) return res.errors.push(`"${id}" is missing a function name`);
			if (!MATH_FUNCTIONS.includes(name) && !name.startsWith('ease_')) {
				const s = closest(name, MATH_FUNCTIONS, 3);
				res.errors.push(`Unknown math function "${id}"${s ? ` — did you mean math.${s}?` : ''}`);
			} else if (name !== 'pi' && !isCall) {
				res.warnings.push(`"${id}" is a function and should be called with parentheses`);
			}
			return;
		}
		if (['variable', 'v', 'temp', 't', 'query', 'q', 'context', 'c', 'array', 'geometry', 'material', 'texture'].includes(ns)) {
			if (!name) res.errors.push(`"${id}" is missing a name after the namespace`);
			if ((ns === 'query' || ns === 'q') && name) {
				res.warnings.push(`"${id}" — queries only resolve when the effect is attached to an entity; in Snowstorm and in world-spawned effects they read 0`);
			}
			return;
		}
		res.errors.push(`Unknown identifier "${id}" — Molang names need a namespace like variable., math., query. or temp.`);
	};

	const parseStatements = (terminator: string) => {
		while (peek().t !== 'eof' && peek().v !== terminator) {
			if (peek().v === ';') { next(); continue; }
			parseStatement();
			if (peek().v === ';') next();
			else if (peek().v !== terminator && peek().t !== 'eof') fail(`Expected ";" before "${peek().v}" at position ${peek().pos}`);
		}
	};
	const parseStatement = () => {
		if (peek().t === 'id' && peek().v.toLowerCase() === 'return') { next(); parseExpr(); return; }
		if (peek().t === 'id' && ['break', 'continue'].includes(peek().v.toLowerCase())) { next(); return; }
		// assignment?
		if (peek().t === 'id' && toks[p + 1]?.v === '=') {
			const id = next().v;
			next();
			const v = normVar(id);
			if (v) res.writes.add(v);
			else if (!/^(temp|t|context|c)\./i.test(id)) res.errors.push(`Cannot assign to "${id}" — only variable.* and temp.* can be assigned`);
			parseExpr();
			return;
		}
		parseExpr();
	};

	const BIN: Record<string, number> = { '??': 1, '||': 2, '&&': 3, '==': 4, '!=': 4, '<': 5, '<=': 5, '>': 5, '>=': 5, '+': 6, '-': 6, '*': 7, '/': 7 };

	const parseExpr = (): void => {
		parseBinary(1);
		if (peek().v === '?') {
			next();
			parseExpr();
			if (peek().v === ':') { next(); parseExpr(); }
		}
	};
	const parseBinary = (minPrec: number): void => {
		parseUnary();
		while (peek().t === 'op' && BIN[peek().v] !== undefined && BIN[peek().v] >= minPrec) {
			const prec = BIN[next().v];
			parseBinary(prec + 1);
		}
	};
	const parseUnary = (): void => {
		if (peek().v === '-' || peek().v === '!') { next(); parseUnary(); return; }
		parsePrimary();
	};
	const parsePrimary = (): void => {
		const t = next();
		if (t.t === 'num' || t.t === 'str') return;
		if (t.v === '(') { parseExpr(); expect(')'); return; }
		if (t.v === '{') { parseStatements('}'); expect('}'); return; }
		if (t.t === 'id') {
			const isCall = peek().v === '(';
			checkIdentifier(t.v, isCall);
			const v = normVar(t.v);
			if (v) res.reads.add(v);
			if (isCall) {
				next();
				if (peek().v !== ')') {
					parseExpr();
					while (peek().v === ',') { next(); parseExpr(); }
				}
				expect(')');
			}
			while (peek().v === '[') { next(); parseExpr(); expect(']'); }
			if (peek().v === '->') { next(); const m = next(); if (m.t !== 'id') fail(`Expected an identifier after "->"`); }
			return;
		}
		fail(t.t === 'eof' ? 'Expression ends too early' : `Unexpected "${t.v}" at position ${t.pos}`);
	};

	try {
		parseStatements('\u0000');
		if (peek().t !== 'eof') fail(`Unexpected "${peek().v}" at position ${peek().pos}`);
	} catch (e: any) {
		res.errors.push(e.message);
	}
	// complex expressions (with ;) must return something to produce a value
	if (/;/.test(src) && !/\breturn\b/i.test(src) && res.writes.size === 0) {
		res.warnings.push('Multi-statement expression without "return" evaluates to 0');
	}
	return res;
}

export function isBuiltinVariable(name: string): boolean {
	return BUILTIN_VARIABLES.includes(name);
}
