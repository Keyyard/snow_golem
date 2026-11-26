import * as THREE from 'three';
import Wintersky from 'wintersky';
window.Wintersky = Wintersky;

// Plays the effect by ticking (like Snowstorm's playback), then renders the frame at each requested time.
window.renderEffect = async function (files, rootId, times, opts = {}) {
	const W = opts.size || 360;
	const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
	renderer.setSize(W, W);
	document.body.innerHTML = '';
	document.body.appendChild(renderer.domElement);
	const scene = new THREE.Scene();
	scene.background = new THREE.Color(0x1c1d22);
	scene.add(new THREE.GridHelper(6, 6, 0x3a3c44, 0x2c2e35));
	const camera = new THREE.PerspectiveCamera(45, 1, 0.05, 100);
	const d = opts.distance || 4.2;
	camera.position.set(d * 0.75, d * 0.45 + 0.6, d * 0.75);
	camera.lookAt(0, opts.lookY ?? 0.7, 0);
	const ws = new Wintersky.Scene({ fetchParticleFile: id => files[id] || null });
	scene.add(ws.space);
	const rootConfig = new Wintersky.Config(ws, files[rootId]);
	const play = (t) => {
		const e = new Wintersky.Emitter(ws, rootConfig, { loop_mode: opts.loop ? 'looping' : 'once' });
		e.start();
		const n = Math.round(t * ws.global_options.tick_rate);
		for (let i = 0; i < n; i++) e.tick();
		return e;
	};
	play(Math.max(...times)).stop(true); // warm-up: loads child configs + textures
	await new Promise(r => setTimeout(r, 700));
	const frames = [];
	for (const t of times) {
		const e = play(t);
		ws.updateFacingRotation(camera);
		renderer.render(scene, camera);
		let count = 0;
		const walk = x => { count += x.particles.length; x.child_emitters.forEach(walk); };
		walk(e);
		frames.push({ t, png: renderer.domElement.toDataURL('image/png'), particles: count });
		e.stop(true);
	}
	return frames;
};
