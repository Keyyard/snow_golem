// End-to-end tests: core checks + a real MCP client talking to the HTTP server on a copy of the demo addon.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createRequire } from 'node:module';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const require = createRequire(import.meta.url);
const T = require('../dist/testing.js');
const here = path.dirname(new URL(import.meta.url).pathname);

let passed = 0, failed = 0;
const check = (name, cond, detail) => {
	if (cond) { passed++; console.log(`  ✓ ${name}`); }
	else { failed++; console.log(`  ✗ ${name}${detail ? `\n      ${typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2).slice(0, 1500)}` : ''}`); }
};

// ---------- Molang checker ----------
console.log('Molang checker');
const ok = e => T.checkMolang(e).errors.length === 0;
check('valid expression', ok('math.sin(v.particle_age * 360) * 0.5 + variable.particle_random_1'));
check('ternary + assignment + return', ok('v.x = v.particle_random_1 > 0.5 ? 1 : 0; return v.x * 2;'));
check('unclosed paren is an error', !ok('math.sin(v.emitter_age * 90'));
check('double operator is an error', !ok('1 +* 2'));
check('unknown math fn suggests fix', T.checkMolang('math.randm(1, 2)').errors[0]?.includes('math.random'));
check('missing namespace is an error', !ok('particle_age * 2'));
check('dangling ternary is an error', !ok('v.a ? 1 :'));

// ---------- presets ----------
console.log('Presets');
const out = path.join(here, 'out', 'presets');
fs.rmSync(path.join(here, 'out'), { recursive: true, force: true });
for (const p of T.PRESETS) {
	const spec = T.buildPreset(p.id, { namespace: 'demo', name: p.id });
	const built = T.buildEffect(spec);
	const ids = built.files.map(f => f.identifier);
	const errs = built.files.flatMap(f => T.validateParticle(f.json, { file: f.path, pendingIdentifiers: ids, isChildLayer: f.role === 'layer' }).filter(i => i.severity !== 'info').map(i => `${f.identifier} ${i.where}: ${i.message}`));
	check(`${p.id}: ${built.files.length} layers validate clean`, errs.length === 0, errs.join('\n      '));
	const peak = built.files.reduce((n, f) => n + T.layerCost(f.json).peak_particles, 0);
	check(`${p.id}: fits mobile budget (peak ≈ ${peak})`, T.rateBudget(peak, 'mobile').verdict === 'ok');
	const root = built.files[0].json.particle_effect;
	const children = built.files.slice(1);
	check(`${p.id}: root spawns every layer from its timeline`, children.every(c => Object.values(root.events ?? {}).some(e => e.particle_effect?.effect === c.identifier)));
	check(`${p.id}: only the root may loop`, children.every(c => 'minecraft:emitter_lifetime_once' in c.json.particle_effect.components));
	for (const f of built.files) {
		const dest = path.join(out, f.path);
		fs.mkdirSync(path.dirname(dest), { recursive: true });
		fs.writeFileSync(dest, JSON.stringify(f.json, null, '\t'));
	}
}
check('bad color is rejected', (() => { try { T.buildPreset('impact', { namespace: 'a', name: 'b', color: 'red' }); return false; } catch { return true; } })());

// ---------- validator on a broken hand-written file ----------
console.log('Validator on demo:old_smoke');
const smoke = JSON.parse(fs.readFileSync(path.join(here, 'fixture/demo_addon/RP/particles/old_smoke.json'), 'utf8'));
const issues = T.validateParticle(smoke, { file: 'particles/old_smoke.json' });
const has = s => issues.some(i => i.message.includes(s));
check('flags non-.particle.json name', has('*.particle.json'));
check('flags component typo with suggestion', has('did you mean "minecraft:emitter_shape_sphere"'));
check('flags math.randm', has('math.random'));
check('flags particle_random_5', has('particle_random_5'));
check('flags unclosed paren', has('Expected ")"'));
check('flags .png in texture path', has('file extension'));
check('flags UV outside texture', has('outside the 16×16'));
check('flags missing max_particles', has('max_particles'));
const cost = T.layerCost(smoke);
check('collision cost flagged', cost.flags.some(f => f.includes('Collision')));

// ---------- MCP over HTTP ----------
console.log('MCP server (HTTP) on a copy of the demo addon');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'snow_golem_'));
fs.cpSync(path.join(here, 'fixture/demo_addon'), work, { recursive: true });
const opened = [];
const ctx = { root: work, gate: new T.WriteGate(work), host: { openInSnowstorm: async p => { opened.push(p); return 'opened'; }, budget: () => 'mobile' } };
const port = 39170 + Math.floor(Math.random() * 500);
const httpServer = await T.startHttpServer({ port, makeServer: () => T.createSnowGolemServer(ctx) });
const client = new Client({ name: 'test', version: '0' });
await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`)));
const call = async (name, args = {}) => {
	const r = await client.callTool({ name, arguments: args });
	const body = r.content[0].text;
	let data; try { data = JSON.parse(body); } catch { data = body; }
	return { data, isError: !!r.isError, diff: r.content[1]?.text };
};
const tools = (await client.listTools()).tools.map(t => t.name);
check('13 tools listed', tools.length === 13, tools);

let r = await call('scan_project');
check('scan finds RP, entity, animations, locators', r.data.resource_pack?.name === 'Demo Addon RP' && r.data.entities[0]?.locators?.includes('right_hand') && r.data.animation_count === 2, r.data);

r = await call('create_effect', { name: 'slam_hit', preset: 'impact', color: '#00F0FF' });
check('create_effect proposes 4 files without writing', r.data.change_set_id && r.data.files?.length === 4 && !fs.existsSync(path.join(work, 'RP/particles/slam_hit')), r.data);
check('namespace inferred from pack (demo)', r.data.effect === 'demo:slam_hit');
check('diff returned', r.diff?.includes('+++ b/RP/particles/slam_hit/slam_hit.particle.json'));
const cs1 = r.data.change_set_id;

r = await call('apply_changes', { change_set_id: cs1 });
check('apply writes files and opens root in Snowstorm', r.data.applied?.length === 4 && opened[0]?.endsWith('slam_hit.particle.json'), r.data);
r = await call('apply_changes', { change_set_id: cs1 });
check('a change set cannot be applied twice', r.isError);

r = await call('create_effect', { name: 'slam_hit', preset: 'impact' });
check('refuses to clobber an existing effect', r.isError && String(r.data).includes('Already in the pack'));

r = await call('validate', { target: 'demo:slam_hit' });
check('validate whole composite tree: 4 files ok', r.data.checked === 4 && r.data.all_ok, r.data);

r = await call('validate');
check('pack-wide validate catches old_smoke errors', !r.data.all_ok && r.data.files.some(f => f.identifier === 'demo:old_smoke' && f.errors >= 5), r.data);

r = await call('lint_performance', { target: 'demo:slam_hit' });
check('lint sums all layers', r.data.layers?.length === 4 && r.data.verdict === 'ok', r.data);

r = await call('attach_to_entity', { entity: 'demo:glitch_boss', effect: 'demo:slam_hit' });
check('attach proposes short name', r.data.short_name === 'slam_hit' && r.diff?.includes('"slam_hit": "demo:slam_hit"'), r);
await call('apply_changes', { change_set_id: r.data.change_set_id });
const entText = fs.readFileSync(path.join(work, 'RP/entity/glitch_boss.entity.json'), 'utf8');
check('entity edit keeps the hand-written comment', entText.includes('// hand-written comment') && entText.includes('"slam_hit": "demo:slam_hit"'));
check('backup of entity file created', fs.readdirSync(path.join(work, '.snow_golem/backups')).length === 1);

r = await call('key_into_animation', { animation: 'animation.glitch_boss.slam', time: 0.8, effect: 'slam_hit', locator: 'right_hand', entity: 'demo:glitch_boss' });
check('key_into_animation with valid locator has no warnings', r.data.messages?.length === 1 && r.diff?.includes('"0.8"'), r.data);
await call('apply_changes', { change_set_id: r.data.change_set_id });
r = await call('key_into_animation', { animation: 'animation.glitch_boss.slam', time: 0.8, effect: 'slam_hit', locator: 'left_hand', entity: 'demo:glitch_boss' });
check('unknown locator is warned about', r.data.messages?.some(m => m.includes('left_hand') && m.includes('right_hand')), r.data);
await call('discard_changes', { change_set_id: r.data.change_set_id });
r = await call('key_into_animation', { animation: 'animation.glitch_boss.slam', time: 3, effect: 'slam_hit' });
check('keyframe after animation end is warned about', r.data.messages?.some(m => m.includes('never fire')));
await call('discard_changes', { change_set_id: r.data.change_set_id });

r = await call('edit_effect', { target: 'demo:slam_hit_sparks', operations: [{ op: 'set', path: '/particle_effect/components/minecraft:emitter_rate_instant/num_particles', value: 30 }] });
check('edit_effect proposes a one-line change', r.data.ok && r.diff?.includes('+\t\t\t\t"num_particles": 30'), r);
// someone edits the file by hand before apply → conflict
const sparks = path.join(work, 'RP/particles/slam_hit/slam_hit_sparks.particle.json');
fs.appendFileSync(sparks, ' ');
const conflict = await call('apply_changes', { change_set_id: r.data.change_set_id });
check('apply refuses when the file changed on disk', conflict.isError && String(conflict.data).includes('changed on disk'));

r = await call('edit_effect', { target: 'demo:slam_hit_sparks', operations: [{ op: 'set', path: '/particle_effect/components/minecraft:emiter_rate_instant/num_particles', value: 3 }] });
check('edit that introduces a typo is reported', r.data.ok === false && r.data.issues.some(i => i.message.includes('did you mean')), r.data);
await call('discard_changes', { change_set_id: r.data.change_set_id });

r = await call('create_effect', { name: 'escape', namespace: 'demo', folder: '../../outside', preset: 'impact' });
check('writes outside the project are refused', r.isError && String(r.data).includes('outside the project'));

r = await call('create_effect', {
	name: 'custom_pulse', layers: [
		{ key: 'ring', texture: 'textures/particle/particles', material: 'particles_add', components: {
			'minecraft:emitter_rate_instant': { num_particles: 12 },
			'minecraft:emitter_lifetime_looping': { active_time: 9 },
			'minecraft:emitter_shape_disc': { radius: 0.5, surface_only: true, direction: 'outwards' },
			'minecraft:particle_initial_speed': 3,
			'minecraft:particle_lifetime_expression': { max_lifetime: 0.5 },
			'minecraft:particle_appearance_billboard': { size: [0.1, 0.1], facing_camera_mode: 'rotate_xyz', uv: { texture_width: 128, texture_height: 128, uv: [0, 88], uv_size: [8, 8] } },
		} },
		{ key: 'glow', texture: 'textures/particle/particles', material: 'particles_add', delay: 0.1, components: {
			'minecraft:emitter_rate_instant': { num_particles: 1 },
			'minecraft:particle_lifetime_expression': { max_lifetime: 0.3 },
			'minecraft:particle_appearance_billboard': { size: [1, 1], facing_camera_mode: 'rotate_xyz', uv: { texture_width: 128, texture_height: 128, uv: [32, 16], uv_size: [32, 32] } },
		} },
	],
});
check('custom layers: lifetime overridden with a note, delay on timeline', r.data.notes?.[0]?.includes('root controls timing') && r.diff?.includes('"0.10"'), r.data);
await call('discard_changes', { change_set_id: r.data.change_set_id });

r = await call('share_link', { target: 'demo:slam_hit' });
check('share link is a snowstorm.app URL and warns about layers', r.data.url?.startsWith('https://snowstorm.app/?loadParticle=') && r.data.warning?.includes('3 other layer'), r.data);

const res = await client.readResource({ uri: 'snowgolem://guide' });
check('guide resource served', res.contents[0].text.includes('Composite effects'));

const { request } = await import('node:http');
const status = await new Promise(res => { const req = request({ host: '127.0.0.1', port, path: '/mcp', method: 'POST', headers: { host: 'evil.example.com', 'content-type': 'application/json', accept: 'application/json, text/event-stream' } }, r2 => { r2.resume(); res(r2.statusCode); }); req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' })); });
check('DNS-rebinding protection rejects foreign Host headers', status === 403, status);

await client.close();
httpServer.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
