/**
 * Headless runner — same tools without VS Code (no live Snowstorm opening).
 *   node dist/cli.js --root ./my_addon            # stdio (for Claude Code / Claude Desktop)
 *   node dist/cli.js --root ./my_addon --http 3917
 */
import * as path from 'node:path';
import * as fs from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createSnowGolemServer, Context } from './mcp/server';
import { startHttpServer } from './mcp/http';
import { WriteGate } from './core/changes';
import type { Budget } from './core/lint';

function arg(name: string): string | undefined {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const root = path.resolve(arg('root') ?? process.cwd());
if (!fs.existsSync(root)) {
	console.error(`--root does not exist: ${root}`);
	process.exit(1);
}
const ctx: Context = {
	root,
	gate: new WriteGate(root),
	host: {
		autoApply: () => flag('auto-apply'),
		budget: () => (arg('budget') as Budget) ?? 'mobile',
		packHint: () => arg('pack'),
		log: m => console.error(m),
	},
};

const httpPort = arg('http');
if (httpPort) {
	startHttpServer({ port: Number(httpPort), makeServer: () => createSnowGolemServer(ctx), log: m => console.error(m) });
} else {
	createSnowGolemServer(ctx).connect(new StdioServerTransport());
}
