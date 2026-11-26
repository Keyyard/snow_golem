import * as fs from 'node:fs';
import * as path from 'node:path';
import { modify, applyEdits, FormattingOptions } from 'jsonc-parser';
import type { ProjectScan, EntityInfo } from './pack';
import { parseJsoncText } from './util';

/** Edit JSON text in place so comments and formatting in hand-written files survive. */
export function editJsonText(text: string, jsonPath: (string | number)[], value: unknown): string {
	const tabs = /^\t/m.test(text);
	const spaces = /^( +)\S/m.exec(text)?.[1].length ?? 4;
	const fo: FormattingOptions = { insertSpaces: !tabs, tabSize: tabs ? 1 : spaces, eol: text.includes('\r\n') ? '\r\n' : '\n' };
	return applyEdits(text, modify(text, jsonPath, value, { formattingOptions: fo }));
}

export function findEntity(scan: ProjectScan, target: string): EntityInfo | undefined {
	const t = target.replace(/\\/g, '/');
	return scan.entities.find(e => e.identifier === target)
		?? scan.entities.find(e => e.file === t || e.file.endsWith('/' + t))
		?? scan.entities.find(e => e.identifier.split(':')[1] === target);
}

export interface WiringResult { file: string; content: string; messages: string[]; short_name?: string }

export function attachToEntity(scan: ProjectScan, entityTarget: string, effectId: string, opts: { short_name?: string; knownEffects?: string[] } = {}): WiringResult {
	const ent = findEntity(scan, entityTarget);
	if (!ent) throw new Error(`Client entity "${entityTarget}" not found. Known: ${scan.entities.map(e => e.identifier).join(', ') || 'none'}`);
	const messages: string[] = [];
	const known = new Set([...scan.particles.map(p => p.identifier), ...(opts.knownEffects ?? [])]);
	if (!known.has(effectId)) messages.push(`Warning: "${effectId}" is not a particle in this pack (yet).`);
	const existing = Object.entries(ent.particle_effects).find(([, v]) => v === effectId);
	if (existing && !opts.short_name) {
		return { file: ent.file, content: fs.readFileSync(path.join(scan.root, ent.file), 'utf8'), messages: [`${ent.identifier} already maps "${existing[0]}" → ${effectId}. Nothing to change.`], short_name: existing[0] };
	}
	const short = opts.short_name ?? effectId.split(':')[1].replace(/[^a-z0-9_]/g, '_');
	if (ent.particle_effects[short] && ent.particle_effects[short] !== effectId) {
		throw new Error(`${ent.identifier} already uses short name "${short}" for ${ent.particle_effects[short]}. Pick another short_name.`);
	}
	const abs = path.join(scan.root, ent.file);
	const text = fs.readFileSync(abs, 'utf8');
	const content = editJsonText(text, ['minecraft:client_entity', 'description', 'particle_effects', short], effectId);
	messages.push(`Registers "${short}" → ${effectId} on ${ent.identifier}. Use "${short}" as the effect name in animations and animation controllers.`);
	return { file: ent.file, content, messages, short_name: short };
}

function timeKey(t: number): string {
	const s = String(Math.round(t * 10000) / 10000);
	return s.includes('.') ? s : `${s}.0`;
}

export function keyIntoAnimation(scan: ProjectScan, animationName: string, time: number, effectShort: string, opts: { locator?: string; entity?: string; pre_effect_script?: string; bind_to_actor?: boolean } = {}): WiringResult {
	const matches = scan.animations.filter(a => a.name === animationName);
	if (!matches.length) {
		const similar = scan.animations.filter(a => a.name.includes(animationName.replace(/^animation\./, ''))).map(a => a.name).slice(0, 8);
		throw new Error(`Animation "${animationName}" not found.${similar.length ? ` Similar: ${similar.join(', ')}` : ''}`);
	}
	if (matches.length > 1) throw new Error(`Animation "${animationName}" is defined in several files: ${matches.map(m => m.file).join(', ')}`);
	const anim = matches[0];
	const messages: string[] = [];
	if (time < 0) throw new Error('time must be >= 0');
	if (typeof anim.length === 'number' && time > anim.length) messages.push(`Warning: time ${time}s is after the animation's length (${anim.length}s) and will never fire.`);

	if (opts.entity) {
		const ent = findEntity(scan, opts.entity);
		if (!ent) messages.push(`Warning: entity "${opts.entity}" not found, so the short name and locator were not checked.`);
		else {
			if (!ent.particle_effects[effectShort]) messages.push(`Warning: ${ent.identifier} has no particle short name "${effectShort}" — run attach_to_entity first, or the keyframe will do nothing.`);
			if (opts.locator) {
				const locs = Object.values(ent.geometry).flatMap(g => scan.locators[g] ?? []);
				if (!locs.includes(opts.locator)) messages.push(`Warning: locator "${opts.locator}" is not in ${ent.identifier}'s geometry${locs.length ? ` (available: ${locs.join(', ')})` : ' (it has no locators)'}. The effect will spawn at the entity origin.`);
			}
		}
	}
	const abs = path.join(scan.root, anim.file);
	const text = fs.readFileSync(abs, 'utf8');
	const data = parseJsoncText(text).data;
	const key = timeKey(time);
	const entry: Record<string, unknown> = { effect: effectShort };
	if (opts.locator) entry.locator = opts.locator;
	if (opts.pre_effect_script) entry.pre_effect_script = opts.pre_effect_script;
	if (opts.bind_to_actor === false) entry.bind_to_actor = false;
	const current = data?.animations?.[animationName]?.particle_effects?.[key];
	let value: unknown = entry;
	if (current) {
		const list = Array.isArray(current) ? current : [current];
		if (list.some((e: any) => e?.effect === effectShort && (e?.locator ?? null) === (opts.locator ?? null))) {
			return { file: anim.file, content: text, messages: [...messages, `"${effectShort}" is already keyed at ${key}s. Nothing to change.`] };
		}
		value = [...list, entry];
	}
	const content = editJsonText(text, ['animations', animationName, 'particle_effects', key], value);
	messages.push(`Keys "${effectShort}" at ${key}s in ${animationName}${opts.locator ? ` on locator "${opts.locator}"` : ''}.`);
	return { file: anim.file, content, messages };
}
