/**
 * MCP plugin manager (PRD §6.2): spawns/connects clients, runs the lifecycle
 * (install/remove/restart), probes Knowledge Core, jails built-in servers to
 * the data dir, scrubs env, and exposes the per-project tool surface for chat.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  listInstalls,
  putInstall,
  deleteInstall,
  listProjects,
  type PluginInstallRow,
} from '../db/appdb.js';
import { dataDir, repoRoot } from '../config.js';
import { logTo } from '../log.js';
import { readCredential } from './credentials.js';

const BUNDLED = ['filesystem', 'memory', 'sqlite'];
const KC_URL = 'http://127.0.0.1:7979/mcp';

export interface ConnectorEntry {
  id: string;
  name: string;
  transport: string;
  url?: string;
  launch?: { command: string; args: string[] };
  status: string;
  auth?: { type: string };
  [key: string]: unknown;
}

export interface InstallRow extends PluginInstallRow {
  custom_config?: string | null;
  credentials_ref?: string | null;
  last_error?: string | null;
}

interface Live {
  client: Client;
  key: string;
}

const live = new Map<string, Live>();
let kcAvailable = false;

export function directory(): ConnectorEntry[] {
  const raw = readFileSync(path.join(repoRoot, 'directory', 'connectors.json'), 'utf8');
  return (JSON.parse(raw) as { connectors: ConnectorEntry[] }).connectors;
}

function audit(line: string): void {
  const file = path.join(dataDir, 'logs', 'audit.log');
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, `${new Date().toISOString()}\t${line}\n`);
}

/** Block private ranges except loopback (PRD §6.2); loopback explicitly allowed. */
export function urlAllowed(url: string): boolean {
  try {
    const u = new URL(url);
    if (!['http:', 'https:'].includes(u.protocol)) return false;
    const host = u.hostname;
    if (host === '127.0.0.1' || host === 'localhost' || host === '::1') return true;
    if (/^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\.|^169\.254\./.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}

function bundledTransport(connectorId: string, projectId: string): StdioClientTransport {
  // portable build ships pre-bundled .mjs servers run by the vendored node;
  // dev runs the .ts sources through tsx
  const bundled = path.join(repoRoot, 'servers', `${connectorId}.mjs`);
  const useBundled = existsSync(bundled);
  return new StdioClientTransport({
    command: useBundled ? process.execPath : path.join(repoRoot, 'node_modules/.bin/tsx'),
    args: [useBundled ? bundled : path.join(repoRoot, 'servers', `${connectorId}.ts`)],
    cwd: dataDir, // jail: built-ins never run with the repo as cwd
    env: {
      ATLAS_PROJECT_ID: projectId,
      ATLAS_DB_PATH: path.join(dataDir, 'data', 'atlas.db'),
      ATLAS_DATA_DIR: dataDir,
      PATH: process.env.PATH ?? '',
    },
  });
}

async function connectClient(install: InstallRow, projectId: string): Promise<Client> {
  const key = `${install.connector_id}:${projectId}`;
  const existing = live.get(key);
  if (existing) return existing.client;

  const entry = directory().find((c) => c.id === install.connector_id);
  const custom = install.custom_config ? (JSON.parse(install.custom_config) as ConnectorEntry) : null;
  const spec = custom ?? entry;
  if (!spec) throw new Error(`unknown connector ${install.connector_id}`);

  const client = new Client({ name: 'atlas', version: '2.0.0' });
  if (BUNDLED.includes(install.connector_id) && install.source !== 'custom') {
    await client.connect(bundledTransport(install.connector_id, projectId));
  } else if (spec.transport === 'stdio' && spec.launch) {
    const command = path.resolve(repoRoot, spec.launch.command);
    if (!command.startsWith(repoRoot + path.sep)) {
      throw new Error('stdio commands must resolve inside the Atlas repo/runtimes');
    }
    await client.connect(
      new StdioClientTransport({
        command,
        args: spec.launch.args ?? [],
        cwd: dataDir,
        env: {
          ATLAS_PROJECT_ID: projectId,
          ATLAS_DB_PATH: path.join(dataDir, 'data', 'atlas.db'),
          ATLAS_DATA_DIR: dataDir,
          PATH: process.env.PATH ?? '',
        },
      }),
    );
  } else {
    const url = spec.url as string;
    if (!urlAllowed(url)) throw new Error(`URL not allowed by policy: ${url}`);
    const headers: Record<string, string> = {};
    if (install.credentials_ref) {
      const token = readCredential(install.credentials_ref);
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    await client.connect(
      new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } }),
    );
  }
  live.set(key, { client, key });
  return client;
}

export async function installs(): Promise<InstallRow[]> {
  return (await listInstalls()) as InstallRow[];
}

export async function installFor(connectorId: string): Promise<InstallRow | undefined> {
  return (await installs()).find((r) => r.connector_id === connectorId);
}

/** Bundled servers: install rows on first boot, connected, enabled in p1. */
export async function ensureBundledInstalled(): Promise<void> {
  const rows = await installs();
  // legacy seed rows from Stage 1 fixtures used a different id and status
  for (const legacy of rows.filter((r) => r.connector_id === 'atlas-memory')) {
    await deleteInstall(legacy.id);
  }
  // holistic memory: on for every project by default (stores stay isolated per project)
  const projectIds = (await listProjects()).map((r) => r.id);
  const mem = rows.find((r) => r.connector_id === 'memory');
  if (mem) {
    const enabled = new Set(JSON.parse(mem.enabled_projects) as string[]);
    for (const id of projectIds) enabled.add(id);
    mem.enabled_projects = JSON.stringify([...enabled]);
    await putInstall(mem);
  }
  for (const id of BUNDLED) {
    const row = rows.find((r) => r.connector_id === id);
    if (!row) {
      await putInstall({
        id: `inst_${id}`,
        connector_id: id,
        source: 'bundled',
        status: 'connected',
        enabled_projects: '["p1"]',
        created_at: Date.now(),
      });
      logTo('mcp', `bundled connector installed: ${id}`);
    } else if (row.status !== 'connected' || row.source !== 'bundled') {
      row.status = 'connected';
      row.source = 'bundled';
      await putInstall(row);
    }
  }
}

export async function installConnector(
  connectorId: string,
  activeProject: string,
): Promise<InstallRow> {
  const entry = directory().find((c) => c.id === connectorId);
  if (!entry) throw new Error(`unknown connector ${connectorId}`);
  if (entry.status === 'planned' && !kcAvailable) {
    throw new Error('Reserved — Knowledge Core is not responding on port 7979');
  }
  const id = `inst_${connectorId}_${randomUUID().slice(0, 6)}`;
  const row: InstallRow = {
    id,
    connector_id: connectorId,
    source: 'directory',
    status: 'installing',
    enabled_projects: '[]',
    created_at: Date.now(),
    custom_config: null,
    credentials_ref: null,
    last_error: null,
  };
  await putInstall(row);
  try {
    if (entry.url && !urlAllowed(entry.url)) throw new Error(`URL not allowed by policy: ${entry.url}`);
    await withTimeout(connectClient(row, activeProject), 5000, 'MCP initialize timed out (5s)');
    row.status = 'connected';
    row.enabled_projects = JSON.stringify([activeProject]);
    row.last_error = null;
    await putInstall(row);
    audit(`install\t${connectorId}\tok`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    row.status = 'error';
    row.last_error = message;
    await putInstall(row);
    audit(`install\t${connectorId}\terror`);
  }
  return row;
}

export async function restartInstall(installId: string, activeProject: string): Promise<InstallRow> {
  const row = (await installs()).find((r) => r.id === installId);
  if (!row) throw new Error('install not found');
  for (const [key, entry] of [...live.entries()]) {
    if (key.startsWith(`${row.connector_id}:`)) {
      await entry.client.close().catch(() => undefined);
      live.delete(key);
    }
  }
  try {
    await withTimeout(connectClient(row, activeProject), 5000, 'MCP initialize timed out (5s)');
    row.status = 'connected';
    row.last_error = null;
    await putInstall(row);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    row.status = 'error';
    row.last_error = message;
    await putInstall(row);
  }
  audit(`restart\t${row.connector_id}`);
  return row;
}

export async function removeInstall(installId: string): Promise<void> {
  const row = (await installs()).find((r) => r.id === installId);
  if (!row) return;
  if (row.source === 'bundled') throw new Error('bundled connectors cannot be removed');
  for (const [key, entry] of [...live.entries()]) {
    if (key.startsWith(`${row.connector_id}:`)) {
      await entry.client.close().catch(() => undefined);
      live.delete(key);
    }
  }
  if (row.credentials_ref) {
    const { deleteCredential } = await import('./credentials.js');
    deleteCredential(row.credentials_ref);
  }
  await deleteInstall(installId);
  audit(`remove\t${row.connector_id}`);
}

export async function addCustom(
  config: { name: string; transport: string; command?: string; args?: string[]; url?: string },
  activeProject: string,
): Promise<InstallRow> {
  const connectorId = `custom-${config.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24)}`;
  if (config.transport === 'stdio') {
    const command = path.resolve(repoRoot, config.command ?? '');
    if (!command.startsWith(repoRoot + path.sep)) {
      throw new Error('stdio commands must resolve inside the Atlas repo/runtimes');
    }
  } else if (!config.url || !urlAllowed(config.url)) {
    throw new Error(`URL not allowed by policy: ${config.url}`);
  }
  const id = `inst_${connectorId}_${randomUUID().slice(0, 6)}`;
  const row: InstallRow = {
    id,
    connector_id: connectorId,
    source: 'custom',
    custom_config: JSON.stringify({ id: connectorId, name: config.name, transport: config.transport, launch: config.command ? { command: config.command, args: config.args ?? [] } : undefined, url: config.url }),
    status: 'installing',
    enabled_projects: '[]',
    created_at: Date.now(),
    credentials_ref: null,
    last_error: null,
  };
  await putInstall(row);
  try {
    await withTimeout(connectClient(row, activeProject), 5000, 'MCP initialize timed out (5s)');
    row.status = 'connected';
    row.enabled_projects = JSON.stringify([activeProject]);
    await putInstall(row);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    row.status = 'error';
    row.last_error = message;
    await putInstall(row);
  }
  audit(`custom-add\t${connectorId}`);
  return row;
}

/** KC probe (boot + directory fetch): 1s initialize on 7979. */
export async function probeKnowledgeCore(): Promise<boolean> {
  try {
    const client = new Client({ name: 'atlas-probe', version: '2.0.0' });
    await withTimeout(
      client.connect(new StreamableHTTPClientTransport(new URL(KC_URL))),
      1000,
      'probe timeout',
    );
    await client.close().catch(() => undefined);
    kcAvailable = true;
  } catch {
    kcAvailable = false;
  }
  return kcAvailable;
}

export function knowledgeCoreAvailable(): boolean {
  return kcAvailable;
}

export interface ChatTool {
  connectorId: string;
  connectorName: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** §6.3 injector: tools of connectors enabled in the active project. */
export async function toolsForProject(projectId: string): Promise<ChatTool[]> {
  const result: ChatTool[] = [];
  for (const row of await installs()) {
    if (row.status !== 'connected') continue;
    const enabled = JSON.parse(row.enabled_projects) as string[];
    if (!enabled.includes(projectId)) continue;
    try {
      const client = await connectClient(row, projectId);
      const { tools } = await client.listTools();
      const entry = directory().find((c) => c.id === row.connector_id);
      const custom = row.custom_config ? (JSON.parse(row.custom_config) as { name?: string }) : null;
      for (const tool of tools) {
        result.push({
          connectorId: row.connector_id,
          connectorName: (custom?.name ?? entry?.name ?? row.connector_id) as string,
          name: tool.name,
          description: tool.description ?? '',
          inputSchema: (tool.inputSchema ?? { type: 'object' }) as Record<string, unknown>,
        });
      }
    } catch (err) {
      logTo('mcp', `listTools failed for ${row.connector_id}: ${err instanceof Error ? err.message : err}`);
    }
  }
  return result;
}

export async function callTool(
  connectorId: string,
  projectId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const row = await installFor(connectorId);
  if (!row) throw new Error(`connector not installed: ${connectorId}`);
  const enabled = JSON.parse(row.enabled_projects) as string[];
  if (!enabled.includes(projectId)) {
    throw new Error(`connector ${connectorId} is not enabled in this project`);
  }
  const client = await connectClient(row, projectId);
  audit(`call\t${connectorId}\t${name}\t${projectId}`);
  const result = await withTimeout(client.callTool({ name, arguments: args }), 30_000, 'tool call timed out (30s)');
  const content = (result.content ?? []) as Array<{ type: string; text?: string }>;
  return content.map((c) => (c.type === 'text' ? (c.text ?? '') : `[${c.type}]`)).join('\n').slice(0, 8000);
}

export async function listToolsFor(installId: string, projectId: string): Promise<ChatTool[]> {
  const row = (await installs()).find((r) => r.id === installId);
  if (!row) throw new Error('install not found');
  const client = await connectClient(row, projectId);
  const { tools } = await client.listTools();
  const entry = directory().find((c) => c.id === row.connector_id);
  return tools.map((t) => ({
    connectorId: row.connector_id,
    connectorName: (entry?.name ?? row.connector_id) as string,
    name: t.name,
    description: t.description ?? '',
    inputSchema: (t.inputSchema ?? { type: 'object' }) as Record<string, unknown>,
  }));
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}
