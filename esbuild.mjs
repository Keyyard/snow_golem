import * as esbuild from 'esbuild';
const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const common = { bundle: true, platform: 'node', target: 'node20', format: 'cjs', sourcemap: !production, minify: production, logLevel: 'info', mainFields: ['module', 'main'] };
const builds = [
	{ ...common, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js', external: ['vscode'] },
	{ ...common, entryPoints: ['src/cli.ts'], outfile: 'dist/cli.js', banner: { js: '#!/usr/bin/env node' } },
	{ ...common, entryPoints: ['src/testing.ts'], outfile: 'dist/testing.js' },
];
if (watch) for (const b of builds) (await esbuild.context(b)).watch();
else await Promise.all(builds.map(b => esbuild.build(b)));
