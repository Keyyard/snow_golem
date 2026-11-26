import Molang from 'molangjs';
import { Json, round } from './util';

export type Budget = 'mobile' | 'desktop';
export const BUDGETS: Record<Budget, { warn: number; error: number; note: string }> = {
	mobile: { warn: 150, error: 400, note: 'Low-end phones and Switch; Marketplace content should be tested here' },
	desktop: { warn: 400, error: 1200, note: 'Windows / consoles' },
};

export interface LayerCost {
	identifier: string;
	mode: 'instant' | 'steady' | 'manual' | 'none';
	peak_particles: number;
	particles_per_second: number;
	avg_lifetime: number;
	avg_size: number;
	loops: boolean;
	flags: string[];
}

const parser = new (Molang as any)();
parser.cache_enabled = false;

/** Average an expression over random seeds — math.random and particle_random_* both vary. */
function avg(expr: Json, fallback: number, extra: Record<string, number> = {}, samples = 64): number {
	if (expr === undefined || expr === null) return fallback;
	if (typeof expr === 'number') return expr;
	if (typeof expr === 'boolean') return expr ? 1 : 0;
	if (typeof expr !== 'string') return fallback;
	let sum = 0;
	for (let i = 0; i < samples; i++) {
		const vars: Record<string, number> = { ...extra };
		for (let r = 1; r <= 4; r++) {
			const pr = Math.random(), er = Math.random();
			vars[`variable.particle_random_${r}`] = pr; vars[`v.particle_random_${r}`] = pr;
			vars[`variable.emitter_random_${r}`] = er; vars[`v.emitter_random_${r}`] = er;
		}
		let v: number;
		try { v = Number(parser.parse(expr, vars)); } catch { v = fallback; }
		sum += Number.isFinite(v) ? v : fallback;
	}
	return sum / samples;
}

export function layerCost(data: Json): LayerCost {
	const pe = data?.particle_effect ?? {};
	const c: Record<string, Json> = pe.components ?? {};
	const id = pe.description?.identifier ?? '?';
	const flags: string[] = [];
	const lifeOnce = c['minecraft:emitter_lifetime_once'];
	const lifeLoop = c['minecraft:emitter_lifetime_looping'];
	const activeTime = avg((lifeOnce ?? lifeLoop)?.active_time, 10);
	const pl = c['minecraft:particle_lifetime_expression'];
	const lifetime = Math.max(0.05, avg(pl?.max_lifetime, pl ? 1 : 3));
	const size = c['minecraft:particle_appearance_billboard']?.size;
	const avgSize = Array.isArray(size) ? Math.max(0, avg(size[0], 0.1, { 'variable.particle_age': 0, 'v.particle_age': 0 })) : 0;

	let mode: LayerCost['mode'] = 'none';
	let peak = 0, pps = 0;
	if (c['minecraft:emitter_rate_instant']) {
		mode = 'instant';
		peak = avg(c['minecraft:emitter_rate_instant'].num_particles, 10);
		pps = peak / Math.max(activeTime, lifetime, 0.05);
	} else if (c['minecraft:emitter_rate_steady']) {
		mode = 'steady';
		const rate = avg(c['minecraft:emitter_rate_steady'].spawn_rate, 1);
		const max = avg(c['minecraft:emitter_rate_steady'].max_particles, 50);
		peak = Math.min(max, rate * Math.min(lifetime, lifeOnce ? activeTime + lifetime : lifetime));
		pps = rate;
		if (rate * lifetime > max * 1.2) flags.push(`max_particles (${round(max, 0)}) caps the effect — it wants ~${round(rate * lifetime, 0)} alive at once`);
	} else if (c['minecraft:emitter_rate_manual']) {
		mode = 'manual';
		peak = avg(c['minecraft:emitter_rate_manual'].max_particles, 50);
		flags.push('Manual rate: count depends on how often the parent spawns it');
	}
	if (c['minecraft:particle_motion_collision']) {
		flags.push(`Collision on ~${round(peak, 0)} particles — collision is the most expensive particle component`);
	}
	if (c['minecraft:particle_appearance_lighting']) flags.push('Lighting enabled: small extra cost per particle');
	const material = pe.description?.basic_render_parameters?.material;
	if (material !== 'particles_opaque' && avgSize > 1.5 && peak > 20) flags.push(`Overdraw: ~${round(peak, 0)} large (${round(avgSize, 1)} block) transparent particles fill the screen up close`);
	if (lifeLoop && !lifeLoop.active_time && !lifeLoop.sleep_time) flags.push('Loops forever — bind it to an entity or stop it from script');
	return { identifier: id, mode, peak_particles: round(peak, 0), particles_per_second: round(pps, 1), avg_lifetime: round(lifetime, 2), avg_size: round(avgSize, 2), loops: !!lifeLoop, flags };
}

export function rateBudget(totalPeak: number, budget: Budget) {
	const b = BUDGETS[budget];
	const verdict = totalPeak >= b.error ? 'too heavy' : totalPeak >= b.warn ? 'heavy' : 'ok';
	return { budget, verdict, total_peak_particles: round(totalPeak, 0), thresholds: { warn: b.warn, error: b.error }, note: `${b.note}. Thresholds are snow_golem heuristics per effect instance, not official limits — several instances on screen multiply the cost.` };
}
