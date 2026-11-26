import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseJsonc, ParseError, printParseErrorCode } from 'jsonc-parser';

export type Json = any;

export interface ReadJsonResult {
	data: Json | null;
	text: string | null;
	errors: string[];
}

/** Bedrock JSON files often contain comments and trailing commas, so read them as JSONC. */
export function readJsonc(absPath: string): ReadJsonResult {
	let text: string;
	try {
		text = fs.readFileSync(absPath, 'utf8');
	} catch {
		return { data: null, text: null, errors: ['File not found'] };
	}
	return parseJsoncText(text);
}

export function parseJsoncText(text: string): ReadJsonResult {
	const errs: ParseError[] = [];
	const data = parseJsonc(text.replace(/^﻿/, ''), errs, { allowTrailingComma: true, disallowComments: false });
	const errors = errs.map(e => `${printParseErrorCode(e.error)} at offset ${e.offset}`);
	return { data: data ?? null, text, errors };
}

/** Stringify the way Snowstorm and most Bedrock devs format files: tabs, one key per line. */
export function stringifyBedrock(data: Json): string {
	return JSON.stringify(data, null, '\t') + '\n';
}

export function toPosix(p: string): string {
	return p.split(path.sep).join('/');
}

export function walk(dir: string, opts: { maxDepth?: number; filter?: (abs: string) => boolean } = {}): string[] {
	const out: string[] = [];
	const maxDepth = opts.maxDepth ?? 8;
	const skip = new Set(['node_modules', '.git', '.snow_golem', '.vscode', 'dist', 'out']);
	const rec = (d: string, depth: number) => {
		if (depth > maxDepth) return;
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(d, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			if (skip.has(e.name)) continue;
			const abs = path.join(d, e.name);
			if (e.isDirectory()) rec(abs, depth + 1);
			else if (e.isFile() && (!opts.filter || opts.filter(abs))) out.push(abs);
		}
	};
	rec(dir, 0);
	return out;
}

export function levenshtein(a: string, b: string): number {
	const m = a.length, n = b.length;
	const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
	for (let j = 1; j <= n; j++) dp[0][j] = j;
	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
		}
	}
	return dp[m][n];
}

export function closest(word: string, candidates: string[], maxDist = 4): string | undefined {
	let best: string | undefined;
	let bestD = Infinity;
	for (const c of candidates) {
		const d = levenshtein(word, c);
		if (d < bestD) {
			bestD = d;
			best = c;
		}
	}
	return bestD <= maxDist ? best : undefined;
}

export function round(n: number, digits = 3): number {
	const f = Math.pow(10, digits);
	return Math.round(n * f) / f;
}

/** JSON Pointer (RFC 6901) helpers — component keys contain ':' and curve names contain '.', so dotted paths are ambiguous. */
export function pointerTokens(pointer: string): string[] {
	if (pointer === '' || pointer === '/') return [];
	if (!pointer.startsWith('/')) throw new Error(`JSON Pointer must start with "/": ${pointer}`);
	return pointer.slice(1).split('/').map(t => t.replace(/~1/g, '/').replace(/~0/g, '~'));
}
