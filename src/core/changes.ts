import * as fs from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createTwoFilesPatch } from 'diff';
import { toPosix } from './util';

export interface FileChange {
	/** relative to project root, posix */
	path: string;
	before: string | null;
	after: string;
}

export interface ChangeSet {
	id: string;
	title: string;
	created: number;
	files: FileChange[];
}

export interface ApplyResult {
	applied: string[];
	backups: string[];
	backup_dir?: string;
}

export interface GateHooks {
	/** return true if the file is open in an editor with unsaved changes */
	isDirty?: (absPath: string) => boolean;
}

/**
 * Every write goes through here: tools propose a ChangeSet (shown to the user as a diff),
 * and nothing touches disk until apply() is called with its id.
 */
export class WriteGate {
	private pending = new Map<string, ChangeSet>();
	constructor(public readonly root: string, private hooks: GateHooks = {}) {}

	/** Resolve a project-relative path and refuse anything that escapes the project root. */
	resolveInside(rel: string): string {
		const abs = path.resolve(this.root, rel);
		const rootReal = fs.realpathSync(this.root);
		const relToRoot = path.relative(this.root, abs);
		if (relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) throw new Error(`Refusing to write outside the project: ${rel}`);
		// follow symlinks of the deepest existing ancestor
		let probe = abs;
		while (!fs.existsSync(probe)) probe = path.dirname(probe);
		const real = fs.realpathSync(probe);
		const r = path.relative(rootReal, real);
		if (r.startsWith('..') || path.isAbsolute(r)) throw new Error(`Refusing to write through a link that leaves the project: ${rel}`);
		if (toPosix(relToRoot).split('/').some(s => s === '.snow_golem')) throw new Error('Refusing to write into .snow_golem/');
		return abs;
	}

	propose(title: string, files: { path: string; content: string }[]): ChangeSet {
		const changes: FileChange[] = [];
		for (const f of files) {
			const abs = this.resolveInside(f.path);
			const before = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
			if (before === f.content) continue;
			changes.push({ path: toPosix(path.relative(this.root, abs)), before, after: f.content });
		}
		const cs: ChangeSet = { id: randomUUID().slice(0, 8), title, created: Date.now(), files: changes };
		if (changes.length) this.pending.set(cs.id, cs);
		// keep memory bounded
		if (this.pending.size > 50) this.pending.delete(this.pending.keys().next().value!);
		return cs;
	}

	get(id: string): ChangeSet | undefined { return this.pending.get(id); }
	list(): ChangeSet[] { return [...this.pending.values()]; }
	discard(id: string): boolean { return this.pending.delete(id); }

	diff(cs: ChangeSet, maxLines = 400): string {
		const parts: string[] = [];
		for (const f of cs.files) {
			const patch = createTwoFilesPatch(f.before === null ? '/dev/null' : `a/${f.path}`, `b/${f.path}`, f.before ?? '', f.after, undefined, undefined, { context: 3 });
			parts.push(patch.split('\n').filter(l => !l.startsWith('=====')).join('\n'));
		}
		const lines = parts.join('\n').split('\n');
		if (lines.length <= maxLines) return lines.join('\n');
		return lines.slice(0, maxLines).join('\n') + `\n… diff truncated (${lines.length - maxLines} more lines). Open the files after applying, or ask for a single file's diff.`;
	}

	apply(id: string): ApplyResult {
		const cs = this.pending.get(id);
		if (!cs) throw new Error(`No pending change set "${id}" (it may have been applied, discarded or expired)`);
		// conflict check first — all or nothing
		for (const f of cs.files) {
			const abs = this.resolveInside(f.path);
			const now = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
			if (now !== f.before) throw new Error(`${f.path} changed on disk after this change set was proposed. Discard it and regenerate.`);
			if (this.hooks.isDirty?.(abs)) throw new Error(`${f.path} has unsaved edits in the editor (maybe in Snowstorm). Save or revert it first.`);
		}
		const stamp = new Date().toISOString().replace(/[:.]/g, '-');
		const backupDir = path.join(this.root, '.snow_golem', 'backups', `${stamp}_${cs.id}`);
		const result: ApplyResult = { applied: [], backups: [] };
		for (const f of cs.files) {
			const abs = this.resolveInside(f.path);
			if (f.before !== null) {
				const b = path.join(backupDir, f.path);
				fs.mkdirSync(path.dirname(b), { recursive: true });
				fs.writeFileSync(b, f.before, 'utf8');
				result.backups.push(toPosix(path.relative(this.root, b)));
			}
			fs.mkdirSync(path.dirname(abs), { recursive: true });
			fs.writeFileSync(abs, f.after, 'utf8');
			result.applied.push(f.path);
		}
		if (result.backups.length) {
			result.backup_dir = toPosix(path.relative(this.root, backupDir));
			const gi = path.join(this.root, '.snow_golem', '.gitignore');
			if (!fs.existsSync(gi)) fs.writeFileSync(gi, '*\n', 'utf8');
		}
		this.pending.delete(id);
		return result;
	}
}
