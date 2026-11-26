import * as http from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { VERSION } from './server';

export interface HttpOptions {
	port: number;
	path?: string;
	makeServer: () => McpServer;
	log?: (msg: string) => void;
}

/**
 * Local MCP endpoint (Streamable HTTP, stateless), like the Blockbench MCP plugin.
 * Bound to 127.0.0.1 only, with DNS-rebinding protection so web pages cannot talk to it.
 */
export function startHttpServer(opts: HttpOptions): Promise<http.Server> {
	const route = opts.path ?? '/mcp';
	const log = opts.log ?? (() => {});
	const allowedHosts = [`127.0.0.1:${opts.port}`, `localhost:${opts.port}`, '127.0.0.1', 'localhost'];
	const httpServer = http.createServer(async (req, res) => {
		const url = new URL(req.url ?? '/', `http://127.0.0.1:${opts.port}`);
		if (url.pathname !== route) {
			res.writeHead(url.pathname === '/' ? 200 : 404, { 'content-type': 'application/json' });
			res.end(JSON.stringify({ name: 'snow_golem', version: VERSION, mcp_endpoint: `http://127.0.0.1:${opts.port}${route}` }));
			return;
		}
		if (req.method !== 'POST') {
			res.writeHead(405, { allow: 'POST' }).end();
			return;
		}
		const server = opts.makeServer();
		const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, enableDnsRebindingProtection: true, allowedHosts });
		res.on('close', () => { transport.close(); server.close(); });
		try {
			await server.connect(transport);
			await transport.handleRequest(req, res);
		} catch (e) {
			log(`request failed: ${e instanceof Error ? e.stack : e}`);
			if (!res.headersSent) res.writeHead(500).end();
		}
	});
	return new Promise((resolve, reject) => {
		httpServer.once('error', reject);
		httpServer.listen(opts.port, '127.0.0.1', () => {
			httpServer.off('error', reject);
			log(`snow_golem MCP listening on http://127.0.0.1:${opts.port}${route}`);
			resolve(httpServer);
		});
	});
}
