import * as fs from 'node:fs';
import * as path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { scanProject, summarizeScan, findParticle, ProjectScan } from '../core/pack';
import { buildEffect, EffectSpec, LayerSpec } from '../core/composite';
import { buildPreset, describePresets } from '../core/presets';
import { validateParticle, summarizeIssues, Issue } from '../core/validate';
import { layerCost, rateBudget, Budget } from '../core/lint';
import { WriteGate, ChangeSet } from '../core/changes';
import { attachToEntity, keyIntoAnimation, editJsonText } from '../core/wiring';
import { snowstormShareLink } from '../core/share';
import { SERVER_INSTRUCTIONS, AUTHORING_GUIDE } from '../core/guide';
import { readJsonc, stringifyBedrock, toPosix, pointerTokens, parseJsoncText, Json } from '../core/util';
import { MATERIALS } from '../core/schema';

export const VERSION = '0.1.0';

export interface Host {
	/** open a file in the Snowstorm editor; returns a status message */
	openInSnowstorm?: (absPath: string) => Promise<string>;
	autoApply?: () => boolean;
	budget?: () => Budget;
	packHint?: () => string | undefined;
	log?: (msg: string) => void;
}

export interface Context { root: string; gate: WriteGate; host: Host }

type Content = { type: 'text'; text: string }[];
const text = (s: string) => ({ type: 'text' as const, text: s });
const json = (o: unknown) => text(JSON.stringify(o, null, 2));
function result(obj: unknown, diff?: string) {
	const content: Content = [json(obj)];
	if (diff) content.push(text('```diff\n' + diff + '\n```'));
	return { content };
}
function fail(e: unknown) {
	return { content: [text(`Error: ${e instanceof Error ? e.message : String(e)}`)], isError: true };
}
const safe = <A>(fn: (a: A) => Promise<any> | any) => async (a: A) => { try { return await fn(a); } catch (e) { return fail(e); } };

export function createSnowGolemServer(ctx: Context): McpServer {
	const server = new McpServer({ name: 'snow_golem', version: VERSION }, { instructions: SERVER_INSTRUCTIONS });
	const scan = (pack?: string) => scanProject(ctx.root, pack ?? ctx.host.packHint?.());
	const rpRel = (s: ProjectScan) => toPosix(path.relative(ctx.root, s.resourcePack!.root));
	const joinRp = (s: ProjectScan, p: string) => toPosix(path.join(rpRel(s), p));
	const needRp = (s: ProjectScan) => { if (!s.resourcePack) throw new Error(s.problems[0] ?? 'No resource pack found'); };

	const defaultNamespace = (s: ProjectScan): string | undefined => {
		const counts = new Map<string, number>();
		for (const id of [...s.particles.map(p => p.identifier), ...s.entities.map(e => e.identifier)]) {
			const ns = id.split(':')[0];
			if (ns && ns !== 'minecraft' && id.includes(':')) counts.set(ns, (counts.get(ns) ?? 0) + 1);
		}
		return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
	};

	/** Present a change set, or apply it right away if the user enabled auto-apply. */
	const finish = async (cs: ChangeSet, extra: Record<string, unknown>, openFile?: string) => {
		if (!cs.files.length) return result({ ...extra, change_set_id: null, message: 'No changes — files already match.' });
		const diff = ctx.gate.diff(cs);
		if (ctx.host.autoApply?.()) {
			const applied = ctx.gate.apply(cs.id);
			let opened: string | undefined;
			if (openFile && ctx.host.openInSnowstorm) opened = await ctx.host.openInSnowstorm(path.join(ctx.root, openFile));
			return result({ ...extra, auto_applied: true, ...applied, opened }, diff);
		}
		return result({ ...extra, change_set_id: cs.id, status: 'proposed — nothing written yet. Show the user the diff, then call apply_changes.', files: cs.files.map(f => ({ path: f.path, action: f.before === null ? 'create' : 'modify' })) }, diff);
	};

	const issuesFor = (issues: Issue[], verbose = false) => (verbose ? issues : issues.filter(i => i.severity !== 'info'));

	const effectTree = (s: ProjectScan, rootId: string) => {
		const seen = new Set<string>();
		const order: string[] = [];
		const rec = (id: string) => {
			if (seen.has(id)) return;
			seen.add(id);
			order.push(id);
			findParticle(s, id)?.spawns.forEach(rec);
		};
		rec(rootId);
		return order;
	};

	// ---------------- tools ----------------

	server.registerTool('scan_project', {
		title: 'Scan project',
		description: 'Map the resource pack: particle effects (and which spawn which), client entities with their particle short names, animations that fire particles, geometry locators and particle textures. Call this first.',
		inputSchema: { pack: z.string().optional().describe('Resource pack name or folder, if the project has several') },
		annotations: { readOnlyHint: true },
	}, safe(async ({ pack }) => result(summarizeScan(scan(pack)))));

	server.registerTool('list_presets', {
		title: 'List effect presets',
		description: 'Built-in layered effect presets for create_effect, with what each is good for and its default colors.',
		inputSchema: {},
		annotations: { readOnlyHint: true },
	}, safe(async () => result({ presets: describePresets(), parameters: { color: 'main hex color', accent_color: 'highlight hex color', scale: 'size/spread multiplier (1 = player-sized mob)', intensity: 'particle count multiplier' } })));

	const layerSchema = z.object({
		key: z.string().describe('short lowercase key, becomes the identifier suffix, e.g. "sparks"'),
		texture: z.string().describe('texture path without extension, e.g. textures/particle/particles'),
		material: z.enum(MATERIALS),
		components: z.record(z.string(), z.any()).describe('Bedrock particle components WITHOUT emitter lifetime (the root controls timing)'),
		curves: z.record(z.string(), z.any()).optional(),
		delay: z.number().min(0).optional().describe('seconds after the root starts, every loop'),
		active_time: z.number().positive().optional(),
		spawn_type: z.enum(['emitter_bound', 'emitter']).optional(),
	});

	server.registerTool('create_effect', {
		title: 'Create layered effect',
		description: 'Create a multi-layer particle effect in the resource pack, from a preset or from your own layers. The first layer is the root (gets the identifier and controls one-shot/loop timing) and spawns the others. Returns a proposed change set with a diff, validation and a performance estimate — nothing is written until apply_changes.',
		inputSchema: {
			name: z.string().regex(/^[a-z0-9_]+$/).describe('effect name, lowercase snake_case, e.g. "boss_slam"'),
			namespace: z.string().regex(/^[a-z0-9_.-]+$/).optional().describe('defaults to the namespace most used in the pack'),
			preset: z.string().optional().describe('preset id from list_presets'),
			color: z.string().optional(),
			accent_color: z.string().optional(),
			scale: z.number().optional(),
			intensity: z.number().optional(),
			layers: z.array(layerSchema).optional().describe('custom layers instead of a preset'),
			loop: z.number().positive().nullable().optional().describe('custom layers: seconds per loop, or null for one-shot (default)'),
			duration: z.number().positive().optional().describe('custom one-shot: how long the root emits (default 0.5)'),
			folder: z.string().optional().describe('folder inside the resource pack, default "particles"'),
			overwrite: z.boolean().optional().describe('allow replacing an existing effect with the same identifiers'),
			pack: z.string().optional(),
		},
	}, safe(async (a) => {
		const s = scan(a.pack);
		needRp(s);
		const namespace = a.namespace ?? defaultNamespace(s);
		if (!namespace) throw new Error('No namespace found in the pack — pass namespace (e.g. your addon prefix).');
		if (namespace === 'minecraft') throw new Error('Do not use the minecraft namespace.');
		let spec: EffectSpec;
		if (a.preset && a.layers) throw new Error('Pass either preset or layers, not both.');
		if (a.preset) spec = buildPreset(a.preset, { namespace, name: a.name, color: a.color, accent_color: a.accent_color, scale: a.scale, intensity: a.intensity });
		else if (a.layers?.length) spec = { namespace, name: a.name, loop: a.loop ?? null, duration: a.duration ?? 0.5, layers: a.layers as LayerSpec[] };
		else throw new Error('Pass a preset (see list_presets) or custom layers.');
		const folder = (a.folder ?? 'particles').replace(/^\/+|\/+$/g, '');
		const built = buildEffect(spec, folder);
		const clashes = built.files.filter(f => s.particles.some(p => p.identifier === f.identifier));
		if (clashes.length && !a.overwrite) throw new Error(`Already in the pack: ${clashes.map(c => c.identifier).join(', ')}. Use another name, edit_effect, or overwrite: true.`);
		const pending = built.files.map(f => f.identifier);
		const report = built.files.map(f => {
			const issues = validateParticle(f.json, { file: f.path, scan: s, pendingIdentifiers: pending, isChildLayer: f.role === 'layer' });
			return { identifier: f.identifier, role: f.role, file: joinRp(s, f.path), ...summarizeIssues(issues), issues: issuesFor(issues), cost: layerCost(f.json) };
		});
		const total = report.reduce((n, r) => n + r.cost.peak_particles, 0);
		const cs = ctx.gate.propose(`create ${namespace}:${a.name}`, built.files.map(f => ({ path: joinRp(s, f.path), content: stringifyBedrock(f.json) })));
		return finish(cs, {
			effect: `${namespace}:${a.name}`,
			timing: spec.loop ? `looping every ${spec.loop}s` : 'one-shot',
			root_file: joinRp(s, built.files[0].path),
			layers: report.map(r => ({ identifier: r.identifier, role: r.role, file: r.file, ok: r.ok, issues: r.issues.length ? r.issues : undefined, peak_particles: r.cost.peak_particles, flags: r.cost.flags.length ? r.cost.flags : undefined })),
			performance: rateBudget(total, ctx.host.budget?.() ?? 'mobile'),
			notes: built.notes.length ? built.notes : undefined,
		}, joinRp(s, built.files[0].path));
	}));

	server.registerTool('edit_effect', {
		title: 'Edit a particle file',
		description: 'Change one particle file with JSON Pointer operations (e.g. path "/particle_effect/components/minecraft:emitter_rate_instant/num_particles"), keeping comments and formatting. Validates and re-estimates cost. Proposes a change set.',
		inputSchema: {
			target: z.string().describe('particle identifier or file path'),
			operations: z.array(z.object({ op: z.enum(['set', 'remove']), path: z.string(), value: z.any().optional() })).optional(),
			replace_with: z.any().optional().describe('a complete particle JSON to replace the file with'),
			pack: z.string().optional(),
		},
	}, safe(async (a) => {
		const s = scan(a.pack);
		needRp(s);
		const p = findParticle(s, a.target);
		if (!p) throw new Error(`Particle "${a.target}" not found.`);
		const abs = path.join(ctx.root, p.file);
		let content = fs.readFileSync(abs, 'utf8');
		if (a.replace_with) content = stringifyBedrock(typeof a.replace_with === 'string' ? JSON.parse(a.replace_with) : a.replace_with);
		for (const op of a.operations ?? []) content = editJsonText(content, pointerTokens(op.path), op.op === 'remove' ? undefined : op.value);
		const data = parseJsoncText(content).data;
		const isChild = s.particles.some(x => x.spawns.includes(p.identifier));
		const issues = validateParticle(data, { file: p.file, scan: s, isChildLayer: isChild });
		const cs = ctx.gate.propose(`edit ${p.identifier}`, [{ path: p.file, content }]);
		return finish(cs, { identifier: data?.particle_effect?.description?.identifier, file: p.file, ...summarizeIssues(issues), issues: issuesFor(issues), cost: layerCost(data) }, p.file);
	}));

	server.registerTool('validate', {
		title: 'Validate particles',
		description: 'Check particle files for structural errors, unknown components (with typo suggestions), Molang syntax errors, undefined variables, missing events/textures, UV out of bounds and broken composite links. Without target, checks the whole pack.',
		inputSchema: { target: z.string().optional().describe('identifier or file; includes the layers it spawns'), verbose: z.boolean().optional(), pack: z.string().optional() },
		annotations: { readOnlyHint: true },
	}, safe(async ({ target, verbose, pack }) => {
		const s = scan(pack);
		needRp(s);
		let ids: string[];
		if (target) {
			const p = findParticle(s, target);
			if (!p) throw new Error(`Particle "${target}" not found.`);
			ids = effectTree(s, p.identifier);
		} else ids = s.particles.map(p => p.identifier);
		const children = new Set(s.particles.flatMap(p => p.spawns));
		const files = ids.map(id => {
			const p = findParticle(s, id)!;
			if (!p) return { identifier: id, ok: false, issues: [{ severity: 'error', where: '-', message: 'Spawned effect not found in pack' }] };
			const { data, errors } = readJsonc(path.join(ctx.root, p.file));
			const issues: Issue[] = errors.map(e => ({ severity: 'error' as const, where: 'syntax', message: e }));
			if (data) issues.push(...validateParticle(data, { file: p.file, scan: s, isChildLayer: children.has(id) }));
			return { identifier: id, file: p.file, ...summarizeIssues(issues), issues: issuesFor(issues, verbose) };
		});
		return result({ checked: files.length, all_ok: files.every(f => f.ok), files: files.filter(f => verbose || f.issues.length), pack_problems: s.problems.length ? s.problems : undefined });
	}));

	server.registerTool('lint_performance', {
		title: 'Estimate performance',
		description: 'Estimate how many particles an effect keeps alive (root plus every layer it spawns), flag expensive patterns, and rate it against a mobile or desktop budget.',
		inputSchema: { target: z.string(), budget: z.enum(['mobile', 'desktop']).optional(), pack: z.string().optional() },
		annotations: { readOnlyHint: true },
	}, safe(async ({ target, budget, pack }) => {
		const s = scan(pack);
		const p = findParticle(s, target);
		if (!p) throw new Error(`Particle "${target}" not found.`);
		const layers = effectTree(s, p.identifier).map(id => {
			const f = findParticle(s, id);
			return f ? layerCost(readJsonc(path.join(ctx.root, f.file)).data) : null;
		}).filter(Boolean) as ReturnType<typeof layerCost>[];
		const total = layers.reduce((n, l) => n + l.peak_particles, 0);
		return result({ effect: p.identifier, layers, ...rateBudget(total, budget ?? ctx.host.budget?.() ?? 'mobile') });
	}));

	server.registerTool('apply_changes', {
		title: 'Apply proposed changes',
		description: 'Write a proposed change set to disk. Backs up every overwritten file to .snow_golem/backups/. Refuses if a file changed since the proposal or has unsaved edits. Call only after the user has seen and accepted the diff.',
		inputSchema: { change_set_id: z.string(), open_in_snowstorm: z.boolean().optional().describe('open the first particle file in Snowstorm afterwards (default true)') },
		annotations: { destructiveHint: false },
	}, safe(async ({ change_set_id, open_in_snowstorm }) => {
		const cs = ctx.gate.get(change_set_id);
		const res = ctx.gate.apply(change_set_id);
		let opened: string | undefined;
		const particle = cs?.files.find(f => f.path.endsWith('.particle.json'));
		if (open_in_snowstorm !== false && particle && ctx.host.openInSnowstorm) opened = await ctx.host.openInSnowstorm(path.join(ctx.root, particle.path));
		return result({ ...res, opened });
	}));

	server.registerTool('discard_changes', {
		title: 'Discard proposed changes',
		description: 'Drop a proposed change set without writing anything.',
		inputSchema: { change_set_id: z.string() },
	}, safe(async ({ change_set_id }) => result({ discarded: ctx.gate.discard(change_set_id) })));

	server.registerTool('list_pending_changes', {
		title: 'List pending changes',
		description: 'Change sets that were proposed but not applied or discarded yet.',
		inputSchema: {},
		annotations: { readOnlyHint: true },
	}, safe(async () => result(ctx.gate.list().map(c => ({ change_set_id: c.id, title: c.title, files: c.files.map(f => f.path), age_seconds: Math.round((Date.now() - c.created) / 1000) })))));

	server.registerTool('open_in_snowstorm', {
		title: 'Open in Snowstorm',
		description: "Open a particle file in the Snowstorm editor inside VS Code for a live preview. For a layered effect, open the root — Snowstorm plays the layers it spawns.",
		inputSchema: { target: z.string().describe('identifier or file'), pack: z.string().optional() },
		annotations: { readOnlyHint: true },
	}, safe(async ({ target, pack }) => {
		const s = scan(pack);
		const p = findParticle(s, target);
		if (!p) throw new Error(`Particle "${target}" not found.`);
		const abs = path.join(ctx.root, p.file);
		if (!ctx.host.openInSnowstorm) return result({ file: p.file, message: 'Not running inside VS Code — open this file with the Snowstorm extension, or use share_link.' });
		return result({ file: p.file, message: await ctx.host.openInSnowstorm(abs) });
	}));

	server.registerTool('share_link', {
		title: 'Snowstorm web link',
		description: 'A snowstorm.app link that opens one particle file in the browser — handy for sharing on Discord. Layers spawned by events are not included in the link (open the root in VS Code to see the whole effect).',
		inputSchema: { target: z.string(), pack: z.string().optional() },
		annotations: { readOnlyHint: true },
	}, safe(async ({ target, pack }) => {
		const s = scan(pack);
		const p = findParticle(s, target);
		if (!p) throw new Error(`Particle "${target}" not found.`);
		const { data } = readJsonc(path.join(ctx.root, p.file));
		let png: Buffer | undefined;
		if (p.texture && s.resourcePack) {
			const f = path.join(s.resourcePack.root, p.texture.replace(/\.png$/i, '') + '.png');
			if (fs.existsSync(f)) png = fs.readFileSync(f);
		}
		const link = snowstormShareLink(data, png);
		return result({ url: link.url, length: link.length, includes_texture: !!png, warning: [p.spawns.length ? `This effect spawns ${p.spawns.length} other layer(s), which the web link cannot include.` : '', link.length > 8000 ? 'Long link — some chat apps cut links this long.' : ''].filter(Boolean).join(' ') || undefined });
	}));

	server.registerTool('attach_to_entity', {
		title: 'Register effect on an entity',
		description: 'Add the effect to a client entity\'s particle_effects with a short name, so animations and animation controllers can fire it. Proposes a change set (comments and formatting are kept).',
		inputSchema: { entity: z.string().describe('client entity identifier or file'), effect: z.string().describe('particle identifier'), short_name: z.string().regex(/^[a-z0-9_]+$/).optional(), pack: z.string().optional() },
	}, safe(async (a) => {
		const s = scan(a.pack);
		const knownEffects = ctx.gate.list().flatMap(c => c.files.map(f => parseJsoncText(f.after).data?.particle_effect?.description?.identifier)).filter(Boolean);
		const r = attachToEntity(s, a.entity, a.effect, { short_name: a.short_name, knownEffects });
		const cs = ctx.gate.propose(`attach ${a.effect} to ${a.entity}`, [{ path: r.file, content: r.content }]);
		return finish(cs, { short_name: r.short_name, messages: r.messages });
	}));

	server.registerTool('key_into_animation', {
		title: 'Key effect into animation',
		description: 'Fire a particle effect at a time in an animation, optionally on a locator. Use the short name registered with attach_to_entity. Checks the locator against the entity geometry when entity is given.',
		inputSchema: {
			animation: z.string().describe('e.g. animation.my_boss.slam'),
			time: z.number().describe('seconds'),
			effect: z.string().describe('short name from the client entity'),
			locator: z.string().optional(),
			entity: z.string().optional().describe('client entity, to check the short name and locator'),
			pre_effect_script: z.string().optional(),
			bind_to_actor: z.boolean().optional(),
			pack: z.string().optional(),
		},
	}, safe(async (a) => {
		const s = scan(a.pack);
		const r = keyIntoAnimation(s, a.animation, a.time, a.effect, { locator: a.locator, entity: a.entity, pre_effect_script: a.pre_effect_script, bind_to_actor: a.bind_to_actor });
		const cs = ctx.gate.propose(`key ${a.effect} into ${a.animation}`, [{ path: r.file, content: r.content }]);
		return finish(cs, { messages: r.messages });
	}));

	server.registerResource('guide', 'snowgolem://guide', { title: 'Particle authoring guide', description: 'Composite model, materials, Molang patterns, performance and the vanilla atlas map', mimeType: 'text/markdown' },
		async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: AUTHORING_GUIDE }] }));

	return server;
}

export type { Json };
