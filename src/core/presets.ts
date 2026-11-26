import type { EffectSpec, LayerSpec } from './composite';
import { Json } from './util';

export interface PresetParams {
	namespace: string;
	name: string;
	color?: string;
	accent_color?: string;
	/** size and spread multiplier, 1 = sized for a player-sized mob */
	scale?: number;
	/** particle count multiplier */
	intensity?: number;
}

interface Ctx { S: number; I: number; c1: string; c2: string }

export interface Preset {
	id: string;
	summary: string;
	timing: 'one-shot' | 'looping';
	use_for: string;
	defaults: { color: string; accent_color: string };
	build: (ctx: Ctx) => { loop: number | null; duration: number; layers: LayerSpec[] };
}

// ---------- helpers ----------
const ATLAS = 'textures/particle/particles';
const f = (n: number) => String(Math.round(n * 1000) / 1000);
const cnt = (n: number, I: number) => Math.max(1, Math.round(n * I));
const LIFE = 'v.particle_age / v.particle_lifetime';

function hex6(c: string): string {
	const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
	if (!m) throw new Error(`Color "${c}" must be a hex color like #FF8800`);
	return m[1].toUpperCase();
}
/** Bedrock gradient colors are #AARRGGBB */
const argb = (c: string, a: number) => '#' + Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0').toUpperCase() + hex6(c);
const rgb01 = (c: string) => { const h = hex6(c); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255); };

function fade(stops: [number, string, number][]): Json {
	return { color: { interpolant: LIFE, gradient: Object.fromEntries(stops.map(([t, c, a]) => [t.toFixed(2), argb(c, a)])) } };
}
function uvCell(u: number, v: number, w = 8, h = 8): Json {
	return { texture_width: 128, texture_height: 128, uv: [u, v], uv_size: [w, h] };
}
function uvFlip(base: [number, number], step: [number, number], frames: number, size: [number, number] = [8, 8], tex: [number, number] = [128, 128]): Json {
	return { texture_width: tex[0], texture_height: tex[1], flipbook: { base_UV: base, size_UV: size, step_UV: step, max_frame: frames, stretch_to_lifetime: true, loop: false } };
}
const shrink = (s: number, curve = '') => `${f(s)} * (1 - ${curve || LIFE})`;
const GLOW = uvCell(32, 16, 32, 32);
/** the solid 3×3 square inside cell (16,88) — a clean pixel that takes any tint */
const SOLID = uvCell(19, 91, 3, 3);
/** white 4-point sparkle */
const SPARKLE = uvCell(16, 48, 7, 7);

// ---------- presets ----------
export const PRESETS: Preset[] = [
	{
		id: 'impact',
		summary: 'Hit spark: bright flash, streaking sparks, a few embers and a puff of smoke.',
		timing: 'one-shot', use_for: 'melee hits, projectile impacts, block breaks, parries',
		defaults: { color: '#FFB347', accent_color: '#FFF3C4' },
		build: ({ S, I, c1, c2 }) => ({
			loop: null, duration: 0.2,
			layers: [
				{
					key: 'flash', texture: ATLAS, material: 'particles_add',
					components: {
						'minecraft:emitter_rate_instant': { num_particles: 1 },
						'minecraft:emitter_shape_point': {},
						'minecraft:particle_lifetime_expression': { max_lifetime: 0.14 },
						'minecraft:particle_initial_spin': { rotation: 'math.random(0, 360)' },
						'minecraft:particle_appearance_billboard': { size: [shrink(1.1 * S, `${LIFE} * 0.6`), shrink(1.1 * S, `${LIFE} * 0.6`)], facing_camera_mode: 'rotate_xyz', uv: GLOW },
						'minecraft:particle_appearance_tinting': fade([[0, c2, 1], [0.4, c1, 0.9], [1, c1, 0]]),
					},
				},
				{
					key: 'sparks', texture: ATLAS, material: 'particles_add', spawn_type: 'emitter',
					components: {
						'minecraft:emitter_rate_instant': { num_particles: cnt(14, I) },
						'minecraft:emitter_shape_sphere': { radius: f(0.1 * S), direction: 'outwards' },
						'minecraft:particle_lifetime_expression': { max_lifetime: 'math.random(0.18, 0.35)' },
						'minecraft:particle_initial_speed': `math.random(6, 11) * ${f(S)}`,
						'minecraft:particle_motion_dynamic': { linear_acceleration: [0, f(-8 * S), 0], linear_drag_coefficient: 4 },
						'minecraft:particle_appearance_billboard': {
							size: [f(0.035 * S), shrink(0.28 * S)], facing_camera_mode: 'lookat_direction',
							direction: { mode: 'derive_from_velocity', min_speed_threshold: 0.01 }, uv: SOLID,
						},
						'minecraft:particle_appearance_tinting': fade([[0, c2, 1], [0.5, c1, 1], [1, c1, 0]]),
					},
				},
				{
					key: 'embers', texture: ATLAS, material: 'particles_add', spawn_type: 'emitter',
					components: {
						'minecraft:emitter_rate_instant': { num_particles: cnt(7, I) },
						'minecraft:emitter_shape_sphere': { radius: f(0.15 * S), direction: 'outwards' },
						'minecraft:particle_lifetime_expression': { max_lifetime: 'math.random(0.4, 0.8)' },
						'minecraft:particle_initial_speed': `math.random(1.5, 3.5) * ${f(S)}`,
						'minecraft:particle_motion_dynamic': { linear_acceleration: [0, f(-6 * S), 0], linear_drag_coefficient: 1.5 },
						'minecraft:particle_appearance_billboard': { size: [shrink(0.07 * S), shrink(0.07 * S)], facing_camera_mode: 'rotate_xyz', uv: uvCell(8, 88) },
						'minecraft:particle_appearance_tinting': fade([[0, c2, 1], [0.6, c1, 1], [1, c1, 0]]),
					},
				},
				{
					key: 'smoke', texture: ATLAS, material: 'particles_blend', delay: 0.05, spawn_type: 'emitter',
					components: {
						'minecraft:emitter_rate_instant': { num_particles: cnt(4, I) },
						'minecraft:emitter_shape_sphere': { radius: f(0.2 * S), direction: 'outwards' },
						'minecraft:particle_lifetime_expression': { max_lifetime: 'math.random(0.6, 1.0)' },
						'minecraft:particle_initial_speed': f(0.8 * S),
						'minecraft:particle_motion_dynamic': { linear_acceleration: [0, f(0.8 * S), 0], linear_drag_coefficient: 2.5 },
						'minecraft:particle_initial_spin': { rotation: 'math.random(0, 360)', rotation_rate: 'math.random(-40, 40)' },
						'minecraft:particle_appearance_billboard': { size: [f(0.3 * S), f(0.3 * S)], facing_camera_mode: 'rotate_xyz', uv: uvFlip([56, 0], [-8, 0], 8) },
						'minecraft:particle_appearance_tinting': fade([[0, '#5A5A5A', 0.55], [1, '#3A3A3A', 0]]),
					},
				},
			],
		}),
	},
	{
		id: 'explosion',
		summary: 'Big blast: white-hot flash, fireballs, expanding dust ring, flying sparks and a rising smoke column.',
		timing: 'one-shot', use_for: 'boss slams, bombs, death bursts, ultimates',
		defaults: { color: '#FF7A1A', accent_color: '#FFE08A' },
		build: ({ S, I, c1, c2 }) => ({
			loop: null, duration: 0.25,
			layers: [
				{
					key: 'flash', texture: ATLAS, material: 'particles_add',
					components: {
						'minecraft:emitter_rate_instant': { num_particles: 1 },
						'minecraft:emitter_shape_point': {},
						'minecraft:particle_lifetime_expression': { max_lifetime: 0.22 },
						'minecraft:particle_appearance_billboard': { size: [shrink(3.2 * S, `${LIFE} * 0.5`), shrink(3.2 * S, `${LIFE} * 0.5`)], facing_camera_mode: 'rotate_xyz', uv: GLOW },
						'minecraft:particle_appearance_tinting': fade([[0, '#FFFFFF', 1], [0.35, c2, 0.9], [1, c1, 0]]),
					},
				},
				{
					key: 'fireballs', texture: ATLAS, material: 'particles_add', spawn_type: 'emitter',
					components: {
						'minecraft:emitter_rate_instant': { num_particles: cnt(10, I) },
						'minecraft:emitter_shape_sphere': { radius: f(0.4 * S), direction: 'outwards' },
						'minecraft:particle_lifetime_expression': { max_lifetime: 'math.random(0.45, 0.75)' },
						'minecraft:particle_initial_speed': `math.random(2, 4) * ${f(S)}`,
						'minecraft:particle_motion_dynamic': { linear_acceleration: [0, f(1.5 * S), 0], linear_drag_coefficient: 3 },
						'minecraft:particle_appearance_billboard': { size: [`(0.6 + v.particle_random_1 * 0.5) * ${f(S)} * (1 - ${LIFE} * 0.7)`, `(0.6 + v.particle_random_1 * 0.5) * ${f(S)} * (1 - ${LIFE} * 0.7)`], facing_camera_mode: 'rotate_xyz', uv: GLOW },
						'minecraft:particle_appearance_tinting': fade([[0, c2, 1], [0.3, c1, 0.95], [0.7, '#B02A10', 0.5], [1, '#301010', 0]]),
					},
				},
				{
					key: 'ring', texture: ATLAS, material: 'particles_blend', spawn_type: 'emitter',
					components: {
						'minecraft:emitter_rate_instant': { num_particles: cnt(28, I) },
						'minecraft:emitter_shape_disc': { radius: f(0.3 * S), surface_only: true, plane_normal: [0, 1, 0], direction: 'outwards', offset: [0, 0.1, 0] },
						'minecraft:particle_lifetime_expression': { max_lifetime: 'math.random(0.5, 0.8)' },
						'minecraft:particle_initial_speed': f(7 * S),
						'minecraft:particle_motion_dynamic': { linear_drag_coefficient: 5 },
						'minecraft:particle_initial_spin': { rotation: 'math.random(0, 360)' },
						'minecraft:particle_appearance_billboard': { size: [f(0.45 * S), f(0.45 * S)], facing_camera_mode: 'rotate_xyz', uv: uvFlip([56, 0], [-8, 0], 8) },
						'minecraft:particle_appearance_tinting': fade([[0, '#C8B8A0', 0.7], [1, '#8A7E70', 0]]),
					},
				},
				{
					key: 'sparks', texture: ATLAS, material: 'particles_add', spawn_type: 'emitter',
					components: {
						'minecraft:emitter_rate_instant': { num_particles: cnt(22, I) },
						'minecraft:emitter_shape_sphere': { radius: f(0.3 * S), direction: 'outwards' },
						'minecraft:particle_lifetime_expression': { max_lifetime: 'math.random(0.4, 0.9)' },
						'minecraft:particle_initial_speed': `math.random(8, 14) * ${f(S)}`,
						'minecraft:particle_motion_dynamic': { linear_acceleration: [0, f(-14 * S), 0], linear_drag_coefficient: 2 },
						'minecraft:particle_appearance_billboard': {
							size: [f(0.05 * S), shrink(0.4 * S)], facing_camera_mode: 'lookat_direction',
							direction: { mode: 'derive_from_velocity', min_speed_threshold: 0.01 }, uv: SOLID,
						},
						'minecraft:particle_appearance_tinting': fade([[0, '#FFFFFF', 1], [0.3, c2, 1], [1, c1, 0]]),
					},
				},
				{
					key: 'smoke', texture: 'textures/particle/campfire_smoke', material: 'particles_blend', delay: 0.12, spawn_type: 'emitter',
					components: {
						'minecraft:emitter_rate_instant': { num_particles: cnt(9, I) },
						'minecraft:emitter_shape_sphere': { radius: f(0.6 * S), direction: 'outwards' },
						'minecraft:particle_lifetime_expression': { max_lifetime: 'math.random(1.4, 2.4)' },
						'minecraft:particle_initial_speed': f(1.2 * S),
						'minecraft:particle_motion_dynamic': { linear_acceleration: [0, f(1.6 * S), 0], linear_drag_coefficient: 1.2 },
						'minecraft:particle_initial_spin': { rotation: 'math.random(0, 360)', rotation_rate: 'math.random(-20, 20)' },
						'minecraft:particle_appearance_billboard': { size: [`${f(1.1 * S)} * (0.6 + ${LIFE})`, `${f(1.1 * S)} * (0.6 + ${LIFE})`], facing_camera_mode: 'rotate_xyz', uv: uvFlip([0, 0], [0, 16], 12, [16, 16], [16, 192]) },
						'minecraft:particle_appearance_tinting': fade([[0, '#6A6464', 0], [0.1, '#6A6464', 0.75], [1, '#4A4646', 0]]),
					},
				},
			],
		}),
	},
	{
		id: 'aura',
		summary: 'Looping power-up aura: motes rising from a ring at the feet, an orbiting band and a soft ground glow.',
		timing: 'looping', use_for: 'buffs, charged states, boss phase 2, shrines and pickups',
		defaults: { color: '#7CF4FF', accent_color: '#E6FBFF' },
		build: ({ S, I, c1, c2 }) => ({
			loop: 1, duration: 1,
			layers: [
				{
					key: 'motes', texture: ATLAS, material: 'particles_add',
					components: {
						'minecraft:emitter_local_space': { position: true, rotation: false },
						'minecraft:emitter_rate_steady': { spawn_rate: cnt(14, I), max_particles: cnt(40, I) },
						'minecraft:emitter_shape_disc': { radius: f(0.55 * S), plane_normal: [0, 1, 0], offset: [0, 0.05, 0] },
						'minecraft:particle_lifetime_expression': { max_lifetime: 'math.random(1.0, 1.6)' },
						'minecraft:particle_initial_speed': 0,
						'minecraft:particle_motion_dynamic': { linear_acceleration: [`math.sin(v.particle_age * 180 + v.particle_random_1 * 360) * 0.4`, f(1.6 * S), 0], linear_drag_coefficient: 1.2 },
						'minecraft:particle_appearance_billboard': { size: [`${f(0.16 * S)} * (0.6 + v.particle_random_2 * 0.6)`, `${f(0.16 * S)} * (0.6 + v.particle_random_2 * 0.6)`], facing_camera_mode: 'rotate_xyz', uv: SPARKLE },
						'minecraft:particle_appearance_tinting': fade([[0, c1, 0], [0.2, c2, 1], [0.7, c1, 0.9], [1, c1, 0]]),
					},
				},
				{
					key: 'band', texture: ATLAS, material: 'particles_add',
					components: {
						'minecraft:emitter_local_space': { position: true, rotation: false },
						'minecraft:emitter_rate_steady': { spawn_rate: cnt(24, I), max_particles: cnt(30, I) },
						'minecraft:emitter_shape_point': {},
						'minecraft:particle_lifetime_expression': { max_lifetime: 0.9 },
						'minecraft:particle_motion_parametric': {
							relative_position: [
								`math.cos(v.particle_random_1 * 360 + v.particle_age * 220) * ${f(0.7 * S)}`,
								`${f(0.15 * S)} + v.particle_age * ${f(0.5 * S)}`,
								`math.sin(v.particle_random_1 * 360 + v.particle_age * 220) * ${f(0.7 * S)}`,
							],
						},
						'minecraft:particle_appearance_billboard': { size: [shrink(0.07 * S), shrink(0.07 * S)], facing_camera_mode: 'rotate_xyz', uv: SOLID },
						'minecraft:particle_appearance_tinting': fade([[0, c2, 1], [1, c1, 0]]),
					},
				},
				{
					key: 'glow', texture: ATLAS, material: 'particles_add',
					components: {
						'minecraft:emitter_local_space': { position: true, rotation: false },
						'minecraft:emitter_rate_instant': { num_particles: 1 },
						'minecraft:emitter_shape_point': { offset: [0, 0.04, 0] },
						'minecraft:particle_lifetime_expression': { max_lifetime: 1.0 },
						'minecraft:particle_appearance_billboard': { size: [f(1.9 * S), f(1.9 * S)], facing_camera_mode: 'emitter_transform_xz', uv: GLOW },
						'minecraft:particle_appearance_tinting': fade([[0, c1, 0.25], [0.5, c1, 0.4], [1, c1, 0.25]]),
					},
				},
			],
		}),
	},
	{
		id: 'trail',
		summary: 'Projectile trail: glowing core, scattering sparkles and thin smoke left in the world.',
		timing: 'looping', use_for: 'arrows, spells, thrown items, dashing mobs',
		defaults: { color: '#B57CFF', accent_color: '#F0E0FF' },
		build: ({ S, I, c1, c2 }) => ({
			loop: 1, duration: 1,
			layers: [
				{
					key: 'core', texture: ATLAS, material: 'particles_add',
					components: {
						'minecraft:emitter_rate_steady': { spawn_rate: cnt(40, I), max_particles: cnt(30, I) },
						'minecraft:emitter_shape_point': {},
						'minecraft:particle_lifetime_expression': { max_lifetime: 0.25 },
						'minecraft:particle_appearance_billboard': { size: [shrink(0.24 * S), shrink(0.24 * S)], facing_camera_mode: 'rotate_xyz', uv: GLOW },
						'minecraft:particle_appearance_tinting': fade([[0, c2, 0.6], [0.3, c1, 0.5], [1, c1, 0]]),
					},
				},
				{
					key: 'sparkles', texture: ATLAS, material: 'particles_add',
					components: {
						'minecraft:emitter_rate_steady': { spawn_rate: cnt(14, I), max_particles: cnt(20, I) },
						'minecraft:emitter_shape_sphere': { radius: f(0.12 * S), direction: 'outwards' },
						'minecraft:particle_lifetime_expression': { max_lifetime: 'math.random(0.4, 0.7)' },
						'minecraft:particle_initial_speed': f(0.6 * S),
						'minecraft:particle_motion_dynamic': { linear_acceleration: [0, f(-1.5 * S), 0], linear_drag_coefficient: 1 },
						'minecraft:particle_appearance_billboard': { size: [shrink(0.08 * S), shrink(0.08 * S)], facing_camera_mode: 'rotate_xyz', uv: SPARKLE },
						'minecraft:particle_appearance_tinting': fade([[0, c2, 1], [1, c1, 0]]),
					},
				},
				{
					key: 'smoke', texture: ATLAS, material: 'particles_blend',
					components: {
						'minecraft:emitter_rate_steady': { spawn_rate: cnt(8, I), max_particles: cnt(12, I) },
						'minecraft:emitter_shape_point': {},
						'minecraft:particle_lifetime_expression': { max_lifetime: 'math.random(0.6, 0.9)' },
						'minecraft:particle_initial_spin': { rotation: 'math.random(0, 360)' },
						'minecraft:particle_motion_dynamic': { linear_acceleration: [0, f(0.4 * S), 0] },
						'minecraft:particle_appearance_billboard': { size: [f(0.22 * S), f(0.22 * S)], facing_camera_mode: 'rotate_xyz', uv: uvFlip([56, 0], [-8, 0], 8) },
						'minecraft:particle_appearance_tinting': fade([[0, c1, 0.35], [1, '#404040', 0]]),
					},
				},
			],
		}),
	},
	{
		id: 'vortex',
		summary: 'Looping portal vortex: particles spiral inward and upward around a pulsing core over a spinning ground sigil.',
		timing: 'looping', use_for: 'portals, summoning circles, charge-ups, black holes',
		defaults: { color: '#9B4DFF', accent_color: '#5CE1FF' },
		build: ({ S, I, c1, c2 }) => ({
			loop: 1.5, duration: 1.5,
			layers: [
				{
					key: 'spiral', texture: ATLAS, material: 'particles_add',
					components: {
						'minecraft:emitter_local_space': { position: true, rotation: false },
						'minecraft:emitter_rate_steady': { spawn_rate: cnt(45, I), max_particles: cnt(70, I) },
						'minecraft:emitter_shape_point': {},
						'minecraft:particle_lifetime_expression': { max_lifetime: 1.3 },
						'minecraft:particle_motion_parametric': {
							relative_position: [
								`math.cos(v.particle_random_1 * 360 + v.particle_age * 300) * ${f(1.3 * S)} * (1 - ${LIFE})`,
								`v.particle_age * ${f(1.2 * S)}`,
								`math.sin(v.particle_random_1 * 360 + v.particle_age * 300) * ${f(1.3 * S)} * (1 - ${LIFE})`,
							],
						},
						'minecraft:particle_appearance_billboard': { size: [f(0.07 * S), f(0.07 * S)], facing_camera_mode: 'rotate_xyz', uv: SPARKLE },
						'minecraft:particle_appearance_tinting': fade([[0, c1, 0], [0.2, c1, 1], [0.8, c2, 1], [1, '#FFFFFF', 0]]),
					},
				},
				{
					key: 'core', texture: ATLAS, material: 'particles_add',
					components: {
						'minecraft:emitter_local_space': { position: true, rotation: false },
						'minecraft:emitter_rate_instant': { num_particles: 1 },
						'minecraft:emitter_shape_point': { offset: [0, f(0.9 * S), 0] },
						'minecraft:particle_lifetime_expression': { max_lifetime: 1.5 },
						'minecraft:particle_appearance_billboard': { size: [`${f(0.8 * S)} + math.sin(v.particle_age * 480) * ${f(0.12 * S)}`, `${f(0.8 * S)} + math.sin(v.particle_age * 480) * ${f(0.12 * S)}`], facing_camera_mode: 'rotate_xyz', uv: GLOW },
						'minecraft:particle_appearance_tinting': fade([[0, c1, 0.6], [0.5, c2, 0.8], [1, c1, 0.6]]),
					},
				},
				{
					key: 'sigil', texture: ATLAS, material: 'particles_add',
					components: {
						'minecraft:emitter_local_space': { position: true, rotation: true },
						'minecraft:emitter_rate_instant': { num_particles: 1 },
						'minecraft:emitter_shape_point': { offset: [0, 0.03, 0] },
						'minecraft:particle_lifetime_expression': { max_lifetime: 1.5 },
						'minecraft:particle_initial_spin': { rotation: 'v.emitter_random_1 * 360', rotation_rate: 120 },
						'minecraft:particle_appearance_billboard': { size: [f(1.3 * S), f(1.3 * S)], facing_camera_mode: 'emitter_transform_xz', uv: uvCell(56, 64) },
						'minecraft:particle_appearance_tinting': fade([[0, c1, 0.45], [0.5, c2, 0.65], [1, c1, 0.45]]),
					},
				},
			],
		}),
	},
	{
		id: 'glitch',
		summary: 'Looping digital glitch: flickering square pixels that snap between positions, plus horizontal scanline tears.',
		timing: 'looping', use_for: 'cyber/horror mobs, corrupted blocks, hologram flicker, teleport-in',
		defaults: { color: '#00F0FF', accent_color: '#FF2BD6' },
		build: ({ S, I, c1, c2 }) => {
			const [r1, g1, b1] = rgb01(c1), [r2, g2, b2] = rgb01(c2);
			const pick = (a: number, b: number) => `v.particle_random_2 > 0.5 ? ${f(a)} : ${f(b)}`;
			return {
				loop: 0.5, duration: 0.5,
				layers: [
					{
						key: 'pixels', texture: ATLAS, material: 'particles_add',
						components: {
							'minecraft:emitter_local_space': { position: true, rotation: false },
							'minecraft:emitter_rate_steady': { spawn_rate: cnt(45, I), max_particles: cnt(30, I) },
							'minecraft:emitter_shape_box': { offset: [0, f(0.9 * S), 0], half_dimensions: [f(0.45 * S), f(0.9 * S), f(0.45 * S)] },
							'minecraft:particle_lifetime_expression': { max_lifetime: 'math.random(0.08, 0.3)' },
							// no motion: short lives + fresh random spawn points read as pixels snapping around
							'minecraft:particle_appearance_billboard': { size: [`${f(0.05 * S)} + v.particle_random_1 * ${f(0.09 * S)}`, `${f(0.05 * S)} + v.particle_random_1 * ${f(0.09 * S)}`], facing_camera_mode: 'lookat_xyz', uv: SOLID },
							'minecraft:particle_appearance_tinting': { color: [pick(r1, r2), pick(g1, g2), pick(b1, b2), `math.mod(math.floor(v.particle_age * 30), 2) < 1 ? 1 : 0.35`] },
						},
					},
					{
						key: 'scanlines', texture: ATLAS, material: 'particles_add',
						components: {
							'minecraft:emitter_local_space': { position: true, rotation: false },
							'minecraft:emitter_rate_steady': { spawn_rate: cnt(10, I), max_particles: cnt(6, I) },
							'minecraft:emitter_shape_box': { offset: [0, f(0.9 * S), 0], half_dimensions: [0, f(0.9 * S), 0] },
							'minecraft:particle_lifetime_expression': { max_lifetime: 'math.random(0.05, 0.14)' },
							'minecraft:particle_appearance_billboard': { size: [`${f(0.35 * S)} + v.particle_random_1 * ${f(0.4 * S)}`, f(0.025 * S)], facing_camera_mode: 'lookat_y', uv: SOLID },
							'minecraft:particle_appearance_tinting': { color: [pick(1, r2), pick(1, g2), pick(1, b2), 0.8] },
						},
					},
				],
			};
		},
	},
];

export function buildPreset(presetId: string, p: PresetParams): EffectSpec {
	const preset = PRESETS.find(x => x.id === presetId);
	if (!preset) throw new Error(`Unknown preset "${presetId}". Available: ${PRESETS.map(x => x.id).join(', ')}`);
	const ctx: Ctx = {
		S: p.scale ?? 1,
		I: p.intensity ?? 1,
		c1: '#' + hex6(p.color ?? preset.defaults.color),
		c2: '#' + hex6(p.accent_color ?? preset.defaults.accent_color),
	};
	if (ctx.S <= 0 || ctx.S > 20) throw new Error('scale must be between 0 and 20');
	if (ctx.I <= 0 || ctx.I > 10) throw new Error('intensity must be between 0 and 10');
	const b = preset.build(ctx);
	return { namespace: p.namespace, name: p.name, loop: b.loop, duration: b.duration, layers: b.layers };
}

export function describePresets() {
	return PRESETS.map(p => ({ id: p.id, timing: p.timing, summary: p.summary, use_for: p.use_for, default_colors: p.defaults }));
}
