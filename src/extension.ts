import * as vscode from 'vscode';
import type * as http from 'node:http';
import { createSnowGolemServer, Context, VERSION } from './mcp/server';
import { startHttpServer } from './mcp/http';
import { WriteGate } from './core/changes';
import type { Budget } from './core/lint';

const SNOWSTORM_EXTENSION = 'JannisX11.snowstorm';
const SNOWSTORM_EDITOR = 'x11.snowstorm';

let httpServer: http.Server | undefined;
let status: vscode.StatusBarItem;
let output: vscode.OutputChannel;
let currentPort: number | undefined;
const mcpChanged = new vscode.EventEmitter<void>();

const cfg = () => vscode.workspace.getConfiguration('snowGolem');
const log = (m: string) => output.appendLine(`[${new Date().toLocaleTimeString()}] ${m}`);
const endpoint = () => `http://127.0.0.1:${currentPort ?? cfg().get<number>('port', 3917)}/mcp`;

function projectRoot(): string | undefined {
	const configured = cfg().get<string>('projectRoot');
	if (configured) return configured;
	return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

async function openInSnowstorm(absPath: string): Promise<string> {
	const uri = vscode.Uri.file(absPath);
	if (!vscode.extensions.getExtension(SNOWSTORM_EXTENSION)) {
		await vscode.window.showTextDocument(uri, { preview: false });
		const pick = await vscode.window.showWarningMessage('snow_golem previews effects in the Snowstorm extension, which is not installed.', 'Install Snowstorm');
		if (pick) vscode.commands.executeCommand('workbench.extensions.installExtension', SNOWSTORM_EXTENSION);
		return 'Opened as text — the Snowstorm extension is not installed.';
	}
	await vscode.commands.executeCommand('vscode.openWith', uri, SNOWSTORM_EDITOR, { preview: false, viewColumn: vscode.ViewColumn.Beside });
	return `Opened ${vscode.workspace.asRelativePath(uri)} in Snowstorm.`;
}

function isDirty(absPath: string): boolean {
	return vscode.workspace.textDocuments.some(d => d.uri.fsPath === absPath && d.isDirty);
}

async function start(): Promise<void> {
	if (httpServer) return;
	const root = projectRoot();
	if (!root) {
		setStatus('no folder', 'Open a folder with your addon to start snow_golem');
		return;
	}
	const ctx: Context = {
		root,
		gate: new WriteGate(root, { isDirty }),
		host: {
			openInSnowstorm,
			autoApply: () => cfg().get<boolean>('autoApply', false),
			budget: () => cfg().get<Budget>('performanceBudget', 'mobile'),
			packHint: () => cfg().get<string>('resourcePack') || undefined,
			log,
		},
	};
	const port = cfg().get<number>('port', 3917);
	try {
		httpServer = await startHttpServer({ port, makeServer: () => createSnowGolemServer(ctx), log });
		currentPort = port;
		setStatus(`:${port}`, `snow_golem ${VERSION} — MCP at ${endpoint()}\nProject: ${root}\nClick for options`);
		mcpChanged.fire();
	} catch (e: any) {
		httpServer = undefined;
		const msg = e?.code === 'EADDRINUSE' ? `Port ${port} is in use. Change "snowGolem.port" or stop the other server.` : String(e?.message ?? e);
		log(`failed to start: ${msg}`);
		setStatus('error', msg);
		vscode.window.showErrorMessage(`snow_golem: ${msg}`);
	}
}

async function stop(): Promise<void> {
	if (!httpServer) return;
	await new Promise<void>(r => httpServer!.close(() => r()));
	httpServer.closeAllConnections?.();
	httpServer = undefined;
	currentPort = undefined;
	log('stopped');
	setStatus('off', 'snow_golem is stopped — click to start');
	mcpChanged.fire();
}

function setStatus(label: string, tooltip: string) {
	status.text = `$(snow) snow_golem ${label}`;
	status.tooltip = tooltip;
	status.show();
}

async function menu() {
	const running = !!httpServer;
	const items: (vscode.QuickPickItem & { run: () => any })[] = [
		{ label: '$(copy) Copy Claude Code command', detail: `claude mcp add --transport http snow_golem ${endpoint()}`, run: copyClaudeCode },
		{ label: '$(json) Copy MCP JSON config', detail: 'For Claude Desktop, Cursor and other MCP clients', run: copyJson },
		running ? { label: '$(debug-restart) Restart server', run: async () => { await stop(); await start(); } } : { label: '$(play) Start server', run: start },
		...(running ? [{ label: '$(debug-stop) Stop server', run: stop }] : []),
		{ label: '$(output) Show log', run: () => output.show() },
		{ label: '$(gear) Settings', run: () => vscode.commands.executeCommand('workbench.action.openSettings', 'snowGolem') },
	];
	const pick = await vscode.window.showQuickPick(items, { title: `snow_golem ${VERSION}${running ? ` — ${endpoint()}` : ''}` });
	await pick?.run();
}

async function copyClaudeCode() {
	await vscode.env.clipboard.writeText(`claude mcp add --transport http snow_golem ${endpoint()}`);
	vscode.window.showInformationMessage('Copied. Run it in a terminal in your addon folder, then start Claude Code.');
}
async function copyJson() {
	await vscode.env.clipboard.writeText(JSON.stringify({ mcpServers: { snow_golem: { type: 'http', url: endpoint() } } }, null, 2));
	vscode.window.showInformationMessage('Copied the MCP server config JSON.');
}

export async function activate(context: vscode.ExtensionContext) {
	output = vscode.window.createOutputChannel('snow_golem');
	status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
	status.command = 'snowGolem.menu';
	setStatus('off', 'snow_golem is stopped — click to start');
	context.subscriptions.push(
		output, status, mcpChanged,
		vscode.commands.registerCommand('snowGolem.menu', menu),
		vscode.commands.registerCommand('snowGolem.start', start),
		vscode.commands.registerCommand('snowGolem.stop', stop),
		vscode.commands.registerCommand('snowGolem.restart', async () => { await stop(); await start(); }),
		vscode.commands.registerCommand('snowGolem.copyClaudeCodeCommand', copyClaudeCode),
		vscode.commands.registerCommand('snowGolem.copyMcpConfig', copyJson),
		vscode.workspace.onDidChangeConfiguration(async e => {
			if (e.affectsConfiguration('snowGolem.port') || e.affectsConfiguration('snowGolem.projectRoot')) { await stop(); await start(); }
		}),
		vscode.workspace.onDidChangeWorkspaceFolders(async () => { if (!httpServer) await start(); }),
		{ dispose: () => { void stop(); } },
	);
	// Let VS Code's own agent mode find the server too.
	if ((vscode as any).lm?.registerMcpServerDefinitionProvider) {
		context.subscriptions.push(vscode.lm.registerMcpServerDefinitionProvider('snowGolem.mcp', {
			onDidChangeMcpServerDefinitions: mcpChanged.event,
			provideMcpServerDefinitions: () => (httpServer ? [new vscode.McpHttpServerDefinition('snow_golem', vscode.Uri.parse(endpoint()), {}, VERSION)] : []),
		}));
	}
	if (cfg().get<boolean>('autoStart', true)) await start();
}

export async function deactivate() {
	await stop();
}
