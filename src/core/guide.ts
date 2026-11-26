import { ATLAS_GUIDE } from './schema';

export const SERVER_INSTRUCTIONS = `snow_golem makes Minecraft Bedrock particle VFX inside the user's resource pack and previews them in Snowstorm.

Workflow:
1. Call scan_project first to learn the pack, existing particles, entities, animations and locators.
2. Make effects with create_effect: start from a preset (list_presets) or pass your own layers. An effect is several emitters ("layers"); the first layer is the root that owns the clock and spawns the others.
3. Every write tool only PROPOSES changes and returns a diff plus a change_set id. Show the user what will change, and call apply_changes only after they agree (unless they told you to apply without asking).
4. After applying, call open_in_snowstorm on the root file so the user sees it live. Snowstorm reloads the file whenever you edit it again.
5. Use edit_effect for tweaks (JSON Pointer operations on one layer), validate after hand edits, lint_performance before shipping.
6. To hook an effect into gameplay: attach_to_entity (registers a short name on the client entity), then key_into_animation (fires it at a time on a locator).

Rules: particle files are named *.particle.json (Snowstorm only opens those). Child layers always use emitter_lifetime_once; only the root loops. Never use the minecraft: namespace. Read snowgolem://guide for the authoring cheat sheet and the vanilla texture atlas map.`;

export const AUTHORING_GUIDE = `# snow_golem authoring cheat sheet

## Composite effects
- One particle file = one emitter = one texture + one material. Real VFX need several: flash, sparks, smoke…
- snow_golem builds them as layers. Layer 0 is the root: it gets the effect's identifier and the timing
  (emitter_lifetime_once for one-shots, emitter_lifetime_looping for loops). Other layers get
  "<id>_<key>" and are spawned from the root's emitter_lifetime_events.timeline (fires every loop),
  optionally delayed. Children always run once, so nothing keeps looping after the root stops.
- spawn_type "emitter_bound" follows the entity/locator; "emitter" stays where it was spawned (use for impacts).

## Materials
particles_add: additive, glows, never darkens — flashes, sparks, magic. particles_blend: soft alpha — smoke, dust.
particles_alpha: hard cut-out, pixel-crisp. particles_opaque: no transparency, cheapest.

## Molang in particles
Built-ins: v.particle_age, v.particle_lifetime, v.particle_random_1..4 (fixed per particle), v.emitter_age,
v.emitter_lifetime, v.emitter_random_1..4. Life fraction: v.particle_age / v.particle_lifetime.
Angles are degrees: math.sin(v.particle_age * 360) = one cycle per second. Queries only work when bound to an entity.

## Common patterns
- Shrink over life: size "0.3 * (1 - v.particle_age / v.particle_lifetime)"
- Fade: tinting color { interpolant: "v.particle_age / v.particle_lifetime", gradient: { "0.00": "#FFRRGGBB", "1.00": "#00RRGGBB" } } (#AARRGGBB)
- Streaks: facing_camera_mode "lookat_direction" + direction { mode: "derive_from_velocity" } + tall thin size
- Orbit: particle_motion_parametric relative_position [cos(a)*r, y, sin(a)*r] with a = v.particle_random_1*360 + v.particle_age*speed
- Ground decal: facing_camera_mode "emitter_transform_xz"
- Flipbook: uv.flipbook { base_UV, size_UV, step_UV, max_frame, stretch_to_lifetime: true }

## Performance
Steady emitters: alive ≈ min(max_particles, spawn_rate × lifetime). Keep a whole effect under ~150 alive for phones.
Collision is the most expensive component; big transparent particles cause overdraw.

## ${ATLAS_GUIDE.split('\n')[0]}
${ATLAS_GUIDE.split('\n').slice(1).join('\n')}
`;
