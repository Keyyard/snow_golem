import { Json } from './util';
import type { Material } from './schema';

/**
 * snow_golem's composite model: one effect = several emitters ("layers").
 * The root layer owns the clock (once or looping) and spawns every other layer from its
 * event timeline. Child layers always run once — they never loop on their own — so stopping
 * the root (entity removed, animation ends) can never leave orphaned looping emitters behind.
 */
export interface LayerSpec {
	/** short key, used as file/identifier suffix: e.g. "sparks" */
	key: string;
	texture: string;
	material: Material;
	/** components WITHOUT emitter lifetime — the builder adds it */
	components: Record<string, Json>;
	curves?: Record<string, Json>;
	/** seconds after the root starts (each loop) */
	delay?: number;
	/** how long this layer emits; defaults to the loop period or the effect duration */
	active_time?: number;
	/** emitter_bound follows the parent (entity/locator); emitter stays where it was spawned */
	spawn_type?: 'emitter_bound' | 'emitter';
	note?: string;
}

export interface EffectSpec {
	namespace: string;
	name: string;
	/** seconds per loop, or null for a one-shot effect */
	loop: number | null;
	/** one-shot: how long the root stays alive (must cover the last delay) */
	duration: number;
	layers: LayerSpec[];
}

export interface BuiltFile {
	identifier: string;
	/** path relative to the resource pack root */
	path: string;
	json: Json;
	role: 'root' | 'layer';
	key: string;
}

const LIFETIME_KEYS = ['minecraft:emitter_lifetime_once', 'minecraft:emitter_lifetime_looping', 'minecraft:emitter_lifetime_expression'];

export function buildEffect(spec: EffectSpec, folder = 'particles'): { files: BuiltFile[]; notes: string[] } {
	const notes: string[] = [];
	if (!spec.layers.length) throw new Error('An effect needs at least one layer');
	const keys = new Set<string>();
	for (const l of spec.layers) {
		if (!/^[a-z0-9_]+$/.test(l.key)) throw new Error(`Layer key "${l.key}" must be lowercase letters, digits and _`);
		if (keys.has(l.key)) throw new Error(`Duplicate layer key "${l.key}"`);
		keys.add(l.key);
	}
	const base = `${spec.namespace}:${spec.name}`;
	const idOf = (l: LayerSpec, i: number) => (i === 0 ? base : `${base}_${l.key}`);
	const fileOf = (l: LayerSpec, i: number) => `${folder}/${spec.name}/${i === 0 ? spec.name : `${spec.name}_${l.key}`}.particle.json`;
	const maxDelay = Math.max(0, ...spec.layers.map(l => l.delay ?? 0));

	const files: BuiltFile[] = spec.layers.map((layer, i) => {
		const comps: Record<string, Json> = {};
		for (const [k, v] of Object.entries(layer.components)) {
			if (LIFETIME_KEYS.includes(k)) {
				notes.push(`Layer "${layer.key}": replaced its own ${k} — the root controls timing in a snow_golem effect`);
				continue;
			}
			comps[k] = v;
		}
		let lifetime: Json;
		if (i === 0) {
			lifetime = spec.loop
				? { 'minecraft:emitter_lifetime_looping': { active_time: spec.loop } }
				: { 'minecraft:emitter_lifetime_once': { active_time: Math.max(layer.active_time ?? spec.duration, maxDelay + 0.05) } };
		} else {
			lifetime = { 'minecraft:emitter_lifetime_once': { active_time: layer.active_time ?? (spec.loop ?? spec.duration) } };
		}
		// keep a readable order: local space, init, rate, lifetime, then the rest
		const ordered: Record<string, Json> = {};
		const first = ['minecraft:emitter_local_space', 'minecraft:emitter_initialization'];
		for (const k of first) if (k in comps) ordered[k] = comps[k];
		for (const [k, v] of Object.entries(comps)) if (k.startsWith('minecraft:emitter_rate')) ordered[k] = v;
		Object.assign(ordered, lifetime);
		for (const [k, v] of Object.entries(comps)) if (!(k in ordered)) ordered[k] = v;

		const pe: Json = {
			description: {
				identifier: idOf(layer, i),
				basic_render_parameters: { material: layer.material, texture: layer.texture },
			},
		};
		if (layer.curves && Object.keys(layer.curves).length) pe.curves = layer.curves;
		pe.components = ordered;
		return { identifier: idOf(layer, i), path: fileOf(layer, i), json: { format_version: '1.10.0', particle_effect: pe }, role: i === 0 ? 'root' : 'layer', key: layer.key } as BuiltFile;
	});

	// Root spawns children from its timeline — timeline events fire on every loop.
	if (files.length > 1) {
		const root = files[0].json.particle_effect;
		const events: Record<string, Json> = { ...(root.events ?? {}) };
		const timeline: Record<string, string[]> = {};
		spec.layers.forEach((layer, i) => {
			if (i === 0) return;
			const ev = `spawn_${layer.key}`;
			events[ev] = { particle_effect: { effect: files[i].identifier, type: layer.spawn_type ?? 'emitter_bound' } };
			const t = (layer.delay ?? 0).toFixed(2);
			(timeline[t] ??= []).push(ev);
		});
		const sortedTimeline = Object.fromEntries(Object.entries(timeline).sort((a, b) => parseFloat(a[0]) - parseFloat(b[0])));
		const comps = root.components;
		const existing = comps['minecraft:emitter_lifetime_events'] ?? {};
		comps['minecraft:emitter_lifetime_events'] = { ...existing, timeline: { ...(existing.timeline ?? {}), ...sortedTimeline } };
		// events go after components for readability
		delete root.events;
		root.events = events;
	}
	return { files, notes };
}
