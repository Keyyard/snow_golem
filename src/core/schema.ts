/** Reference data for the Bedrock particle format (format_version 1.10.0). */

export const MATERIALS = ['particles_alpha', 'particles_blend', 'particles_add', 'particles_opaque'] as const;
export type Material = typeof MATERIALS[number];

export const EMITTER_RATE = ['minecraft:emitter_rate_instant', 'minecraft:emitter_rate_steady', 'minecraft:emitter_rate_manual'];
export const EMITTER_LIFETIME = ['minecraft:emitter_lifetime_once', 'minecraft:emitter_lifetime_looping', 'minecraft:emitter_lifetime_expression'];
export const EMITTER_SHAPE = [
	'minecraft:emitter_shape_point', 'minecraft:emitter_shape_sphere', 'minecraft:emitter_shape_box',
	'minecraft:emitter_shape_disc', 'minecraft:emitter_shape_custom', 'minecraft:emitter_shape_entity_aabb',
];

export const KNOWN_COMPONENTS = [
	'minecraft:emitter_local_space',
	'minecraft:emitter_initialization',
	...EMITTER_RATE,
	...EMITTER_LIFETIME,
	'minecraft:emitter_lifetime_events',
	...EMITTER_SHAPE,
	'minecraft:particle_initial_speed',
	'minecraft:particle_initial_spin',
	'minecraft:particle_initialization',
	'minecraft:particle_motion_dynamic',
	'minecraft:particle_motion_parametric',
	'minecraft:particle_motion_collision',
	'minecraft:particle_appearance_billboard',
	'minecraft:particle_appearance_tinting',
	'minecraft:particle_appearance_lighting',
	'minecraft:particle_lifetime_expression',
	'minecraft:particle_lifetime_events',
	'minecraft:particle_expire_if_in_blocks',
	'minecraft:particle_expire_if_not_in_blocks',
	'minecraft:particle_kill_plane',
];

export const FACING_MODES = [
	'rotate_xyz', 'rotate_y', 'lookat_xyz', 'lookat_y', 'lookat_direction',
	'direction_x', 'direction_y', 'direction_z',
	'emitter_transform_xy', 'emitter_transform_xz', 'emitter_transform_yz',
];

/** Textures that exist in the vanilla resource pack and that Snowstorm previews without a file in your pack. */
export const VANILLA_TEXTURES: Record<string, { width: number; height: number; note: string }> = {
	'textures/particle/particles': { width: 128, height: 128, note: 'Vanilla particle atlas (8×8 px cells). See the snowgolem://atlas resource.' },
	'textures/particle/campfire_smoke': { width: 16, height: 192, note: '12-frame vertical smoke flipbook (16×16 frames).' },
	'textures/particle/soul': { width: 16, height: 176, note: '11-frame vertical soul flame flipbook.' },
	'textures/flame_atlas': { width: 16, height: 512, note: '32-frame vertical flame flipbook.' },
	'textures/particle/flame_atlas': { width: 16, height: 512, note: 'Alias used by Snowstorm for the flame atlas; prefer textures/flame_atlas in-game.' },
};

/** Built-in Molang variables available in particle effects. */
export const BUILTIN_VARIABLES = [
	'emitter_age', 'emitter_lifetime', 'emitter_random_1', 'emitter_random_2', 'emitter_random_3', 'emitter_random_4',
	'particle_age', 'particle_lifetime', 'particle_random_1', 'particle_random_2', 'particle_random_3', 'particle_random_4',
	'entity_scale',
];

export const MATH_FUNCTIONS = [
	'abs', 'acos', 'asin', 'atan', 'atan2', 'ceil', 'clamp', 'cos', 'die_roll', 'die_roll_integer', 'exp', 'floor',
	'hermite_blend', 'lerp', 'lerprotate', 'ln', 'max', 'min', 'min_angle', 'mod', 'pi', 'pow', 'random',
	'random_integer', 'round', 'sin', 'sqrt', 'trunc', 'sign', 'copy_sign', 'inverse_lerp',
];

/** Keys whose string values are NOT Molang expressions. */
export const NON_EXPRESSION_KEYS = new Set([
	'format_version', 'identifier', 'material', 'texture', 'facing_camera_mode', 'mode', 'type', 'effect',
	'creation_event', 'expiration_event', 'events', 'sound_effect', 'event_name', 'locator',
]);

export const ATLAS_GUIDE = `Vanilla atlas: textures/particle/particles (128×128, cells are 8×8 px; uv = [u, v] of the cell's top-left)
Row v=0   : smoke puff, 8 frames growing (u=0 smallest → u=56 largest). Vanilla smoke plays u=56→0 with step_UV [-8,0].
Row v=16  : bubble (0,16), fishing bobber (8,16), bubble outline (16,16)
Glow      : soft round white glow, uv [32,16] size [32,32] — great for flashes, fireballs, cores (tint it).
Row v=24  : flame (0,24), lava (8,24), drip/water (16,24), cyan gem (24,24)
Row v=32  : note (0,32), crit X (8,32), enchanted-hit ring (16,32)
Row v=40  : heart (0,40), angry villager (8,40), happy villager green star (16,40)
Row v=48  : water drop (0,48), blue dot (8,48), white 4-point sparkle (16,48)
Row v=64  : spell swirl, 8 frames growing (u=0 → u=56)
Row v=72  : X sparks, 8 frames growing (u=0 → u=56)
Row v=80  : flash ring, 16 frames (u=0 → u=120): dot grows into a ball, then a crescent that dissolves
Row v=88  : solid shapes growing: dot (0), plus (8), square (16), diamond (24), circle (32)… up to u=56
Row v=96  : X/star sparks, 8 frames (u=0 → u=56)
Row v=104 : colored swirl glyphs (orange u=0–16, pink u=24–40, blue u=48–80)
Rows v=112,120 : enchanting-table glyphs (16 + 11 symbols)`;
