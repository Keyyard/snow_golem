import * as path from 'node:path';
import { Json, closest } from './util';
import {
	KNOWN_COMPONENTS, EMITTER_RATE, EMITTER_LIFETIME, EMITTER_SHAPE, MATERIALS, FACING_MODES,
	VANILLA_TEXTURES, NON_EXPRESSION_KEYS, BUILTIN_VARIABLES,
} from './schema';
import { checkMolang } from './molang';
import type { ProjectScan } from './pack';

export type Severity = 'error' | 'warning' | 'info';
export interface Issue { severity: Severity; where: string; message: string }

export interface ValidateOptions {
	file?: string;
	scan?: ProjectScan;
	/** identifiers that are about to be written alongside this file (for composite checks before apply) */
	pendingIdentifiers?: string[];
	/** true when this file is spawned by a parent effect, so unknown variables may come from pre_effect_expression */
	isChildLayer?: boolean;
}

/** Walk every string value that is a Molang expression. */
function forEachExpression(node: Json, where: string, cb: (expr: string, where: string) => void, parentKey = '') {
	if (typeof node === 'string') {
		if (NON_EXPRESSION_KEYS.has(parentKey)) return;
		if (node.startsWith('#')) return; // hex color
		if (['outwards', 'inwards'].includes(node) && parentKey === 'direction') return;
		cb(node, where);
		return;
	}
	if (Array.isArray(node)) {
		node.forEach((v, i) => forEachExpression(v, `${where}[${i}]`, cb, parentKey));
		return;
	}
	if (node && typeof node === 'object') {
		for (const [k, v] of Object.entries(node)) {
			if (parentKey === 'gradient') continue; // gradient keys/values are colors
			if (k === 'timeline' || k === 'events') continue;
			forEachExpression(v, `${where}/${k}`, cb, k);
		}
	}
}

export function validateParticle(data: Json, opts: ValidateOptions = {}): Issue[] {
	const issues: Issue[] = [];
	const add = (severity: Severity, where: string, message: string) => issues.push({ severity, where, message });

	if (opts.file && !/\.particle\.json$/i.test(opts.file)) {
		add('warning', 'file', `Name ends in "${path.basename(opts.file)}" — Snowstorm's VS Code editor only opens files named *.particle.json`);
	}
	if (!data || typeof data !== 'object') { add('error', '/', 'File is not a JSON object'); return issues; }
	if (!data.format_version) add('warning', '/format_version', 'Missing format_version — use "1.10.0"');
	const pe = data.particle_effect;
	if (!pe) { add('error', '/particle_effect', 'Missing "particle_effect"'); return issues; }

	// description
	const desc = pe.description ?? {};
	const id: string = desc.identifier ?? '';
	if (!id) add('error', '/particle_effect/description/identifier', 'Missing identifier');
	else if (!/^[a-z0-9_.-]+:[a-z0-9_.\/-]+$/.test(id)) add('error', '/particle_effect/description/identifier', `Identifier "${id}" must be lowercase "namespace:name"`);
	else if (id.startsWith('minecraft:')) add('warning', '/particle_effect/description/identifier', 'Using the minecraft: namespace overrides vanilla effects — use your own namespace');
	const brp = desc.basic_render_parameters ?? {};
	if (!brp.material) add('error', '/particle_effect/description/basic_render_parameters/material', 'Missing material');
	else if (!MATERIALS.includes(brp.material)) add('warning', '/particle_effect/description/basic_render_parameters/material', `Unknown material "${brp.material}" (expected one of ${MATERIALS.join(', ')})`);
	const tex: string | undefined = brp.texture;
	if (!tex) add('error', '/particle_effect/description/basic_render_parameters/texture', 'Missing texture');
	else {
		if (/\.(png|tga)$/i.test(tex)) add('warning', '/particle_effect/description/basic_render_parameters/texture', 'Texture paths should not include the file extension');
		const clean = tex.replace(/\.(png|tga)$/i, '');
		if (opts.scan && !VANILLA_TEXTURES[clean] && !opts.scan.textures.includes(clean)) {
			add('warning', '/particle_effect/description/basic_render_parameters/texture', `Texture "${tex}" not found in the resource pack and is not a known vanilla texture`);
		}
	}

	// components
	const comps: Record<string, Json> = pe.components ?? {};
	for (const name of Object.keys(comps)) {
		if (!KNOWN_COMPONENTS.includes(name)) {
			const s = closest(name, KNOWN_COMPONENTS, 6);
			add('error', `/particle_effect/components/${name}`, `Unknown component "${name}"${s ? ` — did you mean "${s}"?` : ''}`);
		}
	}
	const count = (list: string[]) => list.filter(c => c in comps);
	const rate = count(EMITTER_RATE), life = count(EMITTER_LIFETIME), shape = count(EMITTER_SHAPE);
	if (rate.length === 0) add('error', '/particle_effect/components', 'No emitter rate component — the effect will spawn nothing (add minecraft:emitter_rate_instant or _steady)');
	if (rate.length > 1) add('error', '/particle_effect/components', `Only one rate component allowed, found ${rate.join(', ')}`);
	if (life.length === 0) add('error', '/particle_effect/components', 'No emitter lifetime component (add minecraft:emitter_lifetime_once or _looping)');
	if (life.length > 1) add('error', '/particle_effect/components', `Only one lifetime component allowed, found ${life.join(', ')}`);
	if (shape.length > 1) add('error', '/particle_effect/components', `Only one shape component allowed, found ${shape.join(', ')}`);
	if (shape.length === 0) add('info', '/particle_effect/components', 'No shape component — particles spawn at a single point');
	if (!comps['minecraft:particle_lifetime_expression']) add('warning', '/particle_effect/components', 'No minecraft:particle_lifetime_expression — particles may never expire');

	const bb = comps['minecraft:particle_appearance_billboard'];
	if (!bb) add('error', '/particle_effect/components', 'No minecraft:particle_appearance_billboard — particles will be invisible');
	else {
		if (!Array.isArray(bb.size) || bb.size.length !== 2) add('error', '/particle_effect/components/minecraft:particle_appearance_billboard/size', 'size must be [width, height]');
		if (bb.facing_camera_mode && !FACING_MODES.includes(bb.facing_camera_mode)) add('error', '/particle_effect/components/minecraft:particle_appearance_billboard/facing_camera_mode', `Unknown facing_camera_mode "${bb.facing_camera_mode}"`);
		const uv = bb.uv;
		if (uv && typeof uv === 'object') {
			const tw = uv.texture_width ?? 1, th = uv.texture_height ?? 1;
			const vt = tex ? VANILLA_TEXTURES[tex] : undefined;
			if (vt && (tw !== vt.width || th !== vt.height)) add('warning', '/particle_effect/components/minecraft:particle_appearance_billboard/uv', `${tex} is ${vt.width}×${vt.height} but texture_width/height say ${tw}×${th}`);
			const fb = uv.flipbook;
			const checkRect = (base: Json, size: Json, label: string) => {
				if (!Array.isArray(base) || !Array.isArray(size)) return;
				if ([...base, ...size].some(v => typeof v !== 'number')) return;
				if (base[0] < 0 || base[1] < 0 || base[0] + size[0] > tw || base[1] + size[1] > th) add('error', `/particle_effect/components/minecraft:particle_appearance_billboard/uv`, `${label} [${base}] + [${size}] is outside the ${tw}×${th} texture`);
			};
			if (fb) {
				checkRect(fb.base_UV, fb.size_UV, 'flipbook first frame');
				if (Array.isArray(fb.base_UV) && Array.isArray(fb.step_UV) && typeof fb.max_frame === 'number') {
					const last = [fb.base_UV[0] + fb.step_UV[0] * (fb.max_frame - 1), fb.base_UV[1] + fb.step_UV[1] * (fb.max_frame - 1)];
					checkRect(last, fb.size_UV, `flipbook last frame (#${fb.max_frame})`);
				}
				if (!fb.stretch_to_lifetime && !fb.frames_per_second) add('warning', '/particle_effect/components/minecraft:particle_appearance_billboard/uv/flipbook', 'Flipbook needs frames_per_second or stretch_to_lifetime: true');
			} else checkRect(uv.uv, uv.uv_size, 'uv');
		}
	}
	if (rate.includes('minecraft:emitter_rate_steady') && comps['minecraft:emitter_rate_steady']?.max_particles === undefined) {
		add('warning', '/particle_effect/components/minecraft:emitter_rate_steady', 'No max_particles — Bedrock defaults it to 50, which may cap your effect');
	}

	// events
	const events: Record<string, Json> = pe.events ?? {};
	const lifeEvents = comps['minecraft:emitter_lifetime_events'] ?? {};
	const refEvents: [string, string][] = [];
	const pushRefs = (v: Json, where: string) => (Array.isArray(v) ? v : v ? [v] : []).forEach((e: string) => refEvents.push([e, where]));
	pushRefs(lifeEvents.creation_event, 'creation_event');
	pushRefs(lifeEvents.expiration_event, 'expiration_event');
	for (const [t, v] of Object.entries(lifeEvents.timeline ?? {})) pushRefs(v, `timeline/${t}`);
	const pLife = comps['minecraft:particle_lifetime_events'] ?? {};
	pushRefs(pLife.creation_event, 'particle creation_event');
	pushRefs(pLife.expiration_event, 'particle expiration_event');
	for (const [e, where] of refEvents) if (!(e in events)) add('error', `/particle_effect/components (${where})`, `Event "${e}" is used but not defined in particle_effect.events`);

	const known = new Set([...(opts.scan?.particles.map(p => p.identifier) ?? []), ...(opts.pendingIdentifiers ?? [])]);
	const checkEventNode = (node: Json, where: string) => {
		if (!node || typeof node !== 'object') return;
		const eff = node.particle_effect;
		if (eff) {
			if (!eff.effect) add('error', where, 'particle_effect event is missing "effect"');
			else if (opts.scan && !known.has(eff.effect)) add('warning', where, `Spawns "${eff.effect}", which is not in this pack`);
			if (eff.type && !['emitter', 'emitter_bound', 'particle', 'particle_with_velocity'].includes(eff.type)) add('error', where, `Unknown particle_effect type "${eff.type}"`);
			if (eff.effect === id) add('error', where, 'Effect spawns itself — this recurses forever');
			if (eff.pre_effect_expression) for (const m of checkMolang(eff.pre_effect_expression).errors) add('error', `${where}/pre_effect_expression`, m);
		}
		for (const k of ['sequence', 'randomize']) if (Array.isArray(node[k])) node[k].forEach((n: Json, i: number) => checkEventNode(n, `${where}/${k}[${i}]`));
		if (typeof node.expression === 'string') for (const m of checkMolang(node.expression).errors) add('error', `${where}/expression`, m);
	};
	for (const [name, ev] of Object.entries(events)) checkEventNode(ev, `/particle_effect/events/${name}`);

	// Molang
	const reads = new Map<string, string>();
	const writes = new Set<string>(Object.keys(pe.curves ?? {}).map(k => k.replace(/^(variable|v)\./i, '').toLowerCase()));
	const exprComps = Object.fromEntries(Object.entries(comps).filter(([k]) => !/expire_if_(not_)?in_blocks$/.test(k)));
	forEachExpression(exprComps, '/particle_effect/components', (expr, where) => {
		const r = checkMolang(expr);
		r.errors.forEach(m => add('error', where, `Molang: ${m} in "${expr}"`));
		r.warnings.forEach(m => add('info', where, `Molang: ${m}`));
		r.reads.forEach(v => { if (!reads.has(v)) reads.set(v, where); });
		r.writes.forEach(v => writes.add(v));
	});
	forEachExpression(pe.curves ?? {}, '/particle_effect/curves', (expr, where) => {
		const r = checkMolang(expr);
		r.errors.forEach(m => add('error', where, `Molang: ${m} in "${expr}"`));
		r.reads.forEach(v => { if (!reads.has(v)) reads.set(v, where); });
	});
	for (const [v, where] of reads) {
		if (BUILTIN_VARIABLES.includes(v) || writes.has(v)) continue;
		const m = /^(particle|emitter)_random_(\d+)$/.exec(v);
		if (m) { add('error', where, `variable.${v} does not exist — only ${m[1]}_random_1 to _4`); continue; }
		const s = closest(v, [...BUILTIN_VARIABLES, ...writes], 3);
		add(opts.isChildLayer ? 'info' : 'warning', where, `variable.${v} is never set in this file${s ? ` — did you mean variable.${s}?` : ''}${opts.isChildLayer ? ' (fine if a parent sets it via pre_effect_expression)' : ''}`);
	}
	return issues;
}

export function summarizeIssues(issues: Issue[]) {
	return {
		errors: issues.filter(i => i.severity === 'error').length,
		warnings: issues.filter(i => i.severity === 'warning').length,
		ok: !issues.some(i => i.severity === 'error'),
	};
}
