/**
 * Axiom built-in filesystem MCP server (PRD §6.2).
 * Root jailed to dataDir/projects/<AXIOM_PROJECT_ID>/files/; fs_write outside
 * the root errors; every call appends to logs/audit.log (no file contents).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { appendFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const projectId = process.env.AXIOM_PROJECT_ID ?? 'p1';
const dataDir = process.env.AXIOM_DATA_DIR ?? '';
if (!dataDir) {
  console.error('AXIOM_DATA_DIR is required');
  process.exit(1);
}
const ROOT = path.join(dataDir, 'projects', projectId, 'files');
mkdirSync(ROOT, { recursive: true });
const AUDIT = path.join(dataDir, 'logs', 'audit.log');
mkdirSync(path.dirname(AUDIT), { recursive: true });

function audit(tool: string, target: string): void {
  appendFileSync(AUDIT, `${new Date().toISOString()}\t${projectId}\t${tool}\t${target}\n`);
}

/** Resolve a user path inside the jail or throw. */
function resolveInRoot(p: string): string {
  const full = path.resolve(ROOT, p.replace(/^\/+/, ''));
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) {
    throw new Error(`path escapes the project files root: ${p}`);
  }
  return full;
}

const server = new McpServer({ name: 'axiom-filesystem', version: '1.0.0' });

server.tool(
  'fs_list',
  'List files and directories under a path inside the project files root.',
  { path: z.string().default('.').describe('Relative path under the project files root') },
  async ({ path: rel }) => {
    const full = resolveInRoot(rel);
    audit('fs_list', rel);
    const entries = readdirSync(full).map((name) => {
      const st = statSync(path.join(full, name));
      return `${st.isDirectory() ? 'dir ' : 'file'} ${name}${st.isDirectory() ? '/' : ` (${st.size}B)`}`;
    });
    return { content: [{ type: 'text', text: entries.join('\n') || '(empty)' }] };
  },
);

server.tool(
  'fs_read',
  'Read a UTF-8 text file inside the project files root.',
  { path: z.string().describe('Relative file path') },
  async ({ path: rel }) => {
    const full = resolveInRoot(rel);
    audit('fs_read', rel);
    const text = readFileSync(full, 'utf8');
    return { content: [{ type: 'text', text: text.slice(0, 40_000) }] };
  },
);

server.tool(
  'fs_write',
  'Write a UTF-8 text file inside the project files root (creates parent dirs).',
  { path: z.string(), content: z.string() },
  async ({ path: rel, content }) => {
    const full = resolveInRoot(rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, content);
    audit('fs_write', rel);
    return { content: [{ type: 'text', text: `wrote ${content.length} bytes to ${rel}` }] };
  },
);

server.tool(
  'fs_search',
  'Search file names and text contents under the project files root.',
  { query: z.string() },
  async ({ query }) => {
    audit('fs_search', query);
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        const st = statSync(full);
        if (st.isDirectory()) walk(full);
        else {
          const rel = path.relative(ROOT, full);
          if (name.toLowerCase().includes(query.toLowerCase())) hits.push(`name: ${rel}`);
          else if (st.size < 256_000) {
            try {
              const text = readFileSync(full, 'utf8');
              const idx = text.toLowerCase().indexOf(query.toLowerCase());
              if (idx >= 0) hits.push(`text: ${rel} — …${text.slice(Math.max(0, idx - 40), idx + 60).replace(/\n/g, ' ')}…`);
            } catch {
              // binary file — skip
            }
          }
        }
      }
    };
    walk(ROOT);
    return { content: [{ type: 'text', text: hits.slice(0, 50).join('\n') || 'no matches' }] };
  },
);

await server.connect(new StdioServerTransport());
