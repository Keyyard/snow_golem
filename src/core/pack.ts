import * as fs from 'node:fs';
import * as path from 'node:path';
import { readJsonc, walk, toPosix, Json } from './util';

export interface PackInfo {
	name: string;
	type: 'resources' | 'behavior';
	/** absolute path of the pack root (folder containing manifest.json) */
	root: string;
	uuid?: string;
}

export interface ParticleInfo {
	identifier: string;
	file: string; // relative to project root
	texture?: string;
	material?: string;
	/** identifiers of other effects spawned by this one's events */
	spawns: string[];
	parseErrors?: string[];
}

export interface EntityInfo {
	identifier: string;
	file: string;
	particle_effects: Record<string, string>;
	animations: Record<string, string>;
	geometry: Record<string, string>;
}

export interface AnimationInfo {
	name: string;
	file: string;
	length?: number;
	loop?: boolean | string;
	particle_keyframes: { time: string; effect: string; locator?: string }[];
}

export interface ProjectScan {
	root: string;
	packs: PackInfo[];
	resourcePack?: PackInfo;
	particles: ParticleInfo[];
	entities: EntityInfo[];
	animations: AnimationInfo[];
	/** geometry identifier -> locator names */
	locators: Record<string, string[]>;
	textures: string[]; // texture paths without extension, relative to RP root
	problems: string[];
}

export function findPacks(root: string): PackInfo[] {
	const manifests = walk(root, { maxDepth: 5, filter: f => path.basename(f) === 'manifest.json' });
	const packs: PackInfo[] = [];
	for (const m of manifests) {
		const { data } = readJsonc(m);
		if (!data?.header) continue;
		const types: string[] = (data.modules ?? []).map((x: Json) => x?.type);
		const type = types.includes('resources') ? 'resources' : types.some(t => t === 'data' || t === 'script') ? 'behavior' : null;
		if (!type) continue;
		packs.push({ name: String(data.header.name ?? path.basename(path.dirname(m))), type, root: path.dirname(m), uuid: data.header.uuid });
	}
	// A bare folder with particles/ and no manifest still counts as a resource pack.
	if (!packs.some(p => p.type === 'resources') && fs.existsSync(path.join(root, 'particles'))) {
		packs.push({ name: path.basename(root), type: 'resources', root });
	}
	return packs;
}

export function pickResourcePack(packs: PackInfo[], hint?: string): PackInfo | undefined {
	const rps = packs.filter(p => p.type === 'resources');
	if (!hint) return rps[0];
	const h = hint.toLowerCase();
	return rps.find(p => p.name.toLowerCase() === h) ?? rps.find(p => toPosix(p.root).toLowerCase().endsWith(h.replace(/\\/g, '/'))) ?? rps.find(p => p.name.toLowerCase().includes(h));
}

function collectSpawns(events: Json): string[] {
	const out: string[] = [];
	const rec = (node: Json) => {
		if (!node || typeof node !== 'object') return;
		if (node.particle_effect?.effect) out.push(String(node.particle_effect.effect));
		for (const k of ['sequence', 'randomize']) if (Array.isArray(node[k])) node[k].forEach(rec);
	};
	if (events && typeof events === 'object') Object.values(events).forEach(rec);
	return [...new Set(out)];
}

export function scanProject(root: string, packHint?: string): ProjectScan {
	const packs = findPacks(root);
	const rp = pickResourcePack(packs, packHint);
	const scan: ProjectScan = { root, packs, resourcePack: rp, particles: [], entities: [], animations: [], locators: {}, textures: [], problems: [] };
	if (!rp) {
		scan.problems.push('No resource pack found (looked for manifest.json with a "resources" module, or a folder with particles/).');
		return scan;
	}
	const rel = (abs: string) => toPosix(path.relative(root, abs));
	const jsonIn = (sub: string) => walk(path.join(rp.root, sub), { filter: f => /\.json$/i.test(f) });

	for (const f of jsonIn('particles')) {
		const { data, errors } = readJsonc(f);
		const pe = data?.particle_effect;
		if (!pe) {
			scan.problems.push(`${rel(f)}: not a particle file${errors.length ? ` (${errors[0]})` : ''}`);
			continue;
		}
		scan.particles.push({
			identifier: String(pe.description?.identifier ?? ''),
			file: rel(f),
			texture: pe.description?.basic_render_parameters?.texture,
			material: pe.description?.basic_render_parameters?.material,
			spawns: collectSpawns(pe.events),
			parseErrors: errors.length ? errors : undefined,
		});
	}
	const ids = new Map<string, string[]>();
	for (const p of scan.particles) ids.set(p.identifier, [...(ids.get(p.identifier) ?? []), p.file]);
	for (const [id, files] of ids) if (files.length > 1) scan.problems.push(`Duplicate particle identifier "${id}" in ${files.join(', ')}`);

	for (const f of jsonIn('entity')) {
		const { data } = readJsonc(f);
		const d = data?.['minecraft:client_entity']?.description;
		if (!d) continue;
		scan.entities.push({
			identifier: String(d.identifier ?? ''),
			file: rel(f),
			particle_effects: d.particle_effects ?? {},
			animations: d.animations ?? {},
			geometry: d.geometry ?? {},
		});
	}
	for (const f of jsonIn('animations')) {
		const { data } = readJsonc(f);
		for (const [name, anim] of Object.entries<Json>(data?.animations ?? {})) {
			const kf: AnimationInfo['particle_keyframes'] = [];
			for (const [time, val] of Object.entries<Json>(anim?.particle_effects ?? {})) {
				for (const v of Array.isArray(val) ? val : [val]) kf.push({ time, effect: v?.effect, locator: v?.locator });
			}
			scan.animations.push({ name, file: rel(f), length: anim?.animation_length, loop: anim?.loop, particle_keyframes: kf });
		}
	}
	for (const f of jsonIn('models')) {
		const { data } = readJsonc(f);
		for (const g of data?.['minecraft:geometry'] ?? []) {
			const id = g?.description?.identifier;
			if (!id) continue;
			const locs: string[] = [];
			for (const b of g.bones ?? []) if (b?.locators) locs.push(...Object.keys(b.locators));
			scan.locators[id] = locs;
		}
	}
	scan.textures = walk(path.join(rp.root, 'textures'), { filter: f => /\.(png|tga)$/i.test(f) })
		.map(f => toPosix(path.relative(rp.root, f)).replace(/\.(png|tga)$/i, ''));
	return scan;
}

/** Compact summary for the model — full lists can be large. */
export function summarizeScan(s: ProjectScan) {
	return {
		root: s.root,
		resource_pack: s.resourcePack ? { name: s.resourcePack.name, path: toPosix(path.relative(s.root, s.resourcePack.root)) || '.' } : null,
		other_packs: s.packs.filter(p => p !== s.resourcePack).map(p => ({ name: p.name, type: p.type, path: toPosix(path.relative(s.root, p.root)) || '.' })),
		particles: s.particles.map(p => ({ id: p.identifier, file: p.file, texture: p.texture, spawns: p.spawns.length ? p.spawns : undefined })),
		entities: s.entities.map(e => ({
			id: e.identifier, file: e.file,
			particle_effects: Object.keys(e.particle_effects).length ? e.particle_effects : undefined,
			animations: Object.keys(e.animations),
			locators: Object.values(e.geometry).flatMap(g => s.locators[g] ?? []),
		})),
		animations_with_particles: s.animations.filter(a => a.particle_keyframes.length).map(a => ({ name: a.name, file: a.file, keyframes: a.particle_keyframes })),
		animation_count: s.animations.length,
		particle_texture_files: s.textures.filter(t => t.startsWith('textures/particle')),
		problems: s.problems.length ? s.problems : undefined,
	};
}

export function findParticle(scan: ProjectScan, target: string): ParticleInfo | undefined {
	const t = target.replace(/\\/g, '/');
	return scan.particles.find(p => p.identifier === target) ?? scan.particles.find(p => p.file === t || p.file.endsWith('/' + t));
}
