/**
 * Atlas built-in sqlite MCP server (PRD §6.2).
 * Read-only (PRAGMA query_only); target file must resolve inside dataDir.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import Database from 'better-sqlite3';
import path from 'node:path';

const dataDir = process.env.ATLAS_DATA_DIR ?? '';
const defaultDb = process.env.ATLAS_DB_PATH ?? '';
if (!dataDir || !defaultDb) {
  console.error('ATLAS_DATA_DIR and ATLAS_DB_PATH are required');
  process.exit(1);
}

function openReadOnly(file?: string): Database.Database {
  const target = file ? path.resolve(dataDir, file) : defaultDb;
  if (target !== defaultDb && !target.startsWith(dataDir + path.sep)) {
    throw new Error(`database path must resolve inside the Atlas data dir: ${file}`);
  }
  const db = new Database(target, { readonly: true, fileMustExist: true });
  db.pragma('query_only = ON');
  return db;
}

const server = new McpServer({ name: 'atlas-sqlite', version: '1.0.0' });

server.tool(
  'sql_schema',
  'List tables and their columns in the Atlas database (or another sqlite file inside the data dir).',
  { file: z.string().optional() },
  async ({ file }) => {
    const db = openReadOnly(file);
    try {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all() as Array<{ name: string }>;
      const lines = tables.map((t) => {
        const cols = db.prepare(`PRAGMA table_info(${JSON.stringify(t.name).replace(/"/g, '`')})`).all() as Array<{ name: string; type: string }>;
        return `${t.name}(${cols.map((c) => `${c.name} ${c.type}`.trim()).join(', ')})`;
      });
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    } finally {
      db.close();
    }
  },
);

server.tool(
  'sql_query',
  'Run a read-only SELECT against the Atlas database. Mutations are rejected.',
  { sql: z.string(), file: z.string().optional() },
  async ({ sql, file }) => {
    if (!/^\s*(select|with)\b/i.test(sql)) {
      throw new Error('only SELECT/WITH queries are allowed (read-only server)');
    }
    const db = openReadOnly(file);
    try {
      const rows = db.prepare(sql).all() as Array<Record<string, unknown>>;
      const text = rows.length
        ? rows.slice(0, 50).map((r) => JSON.stringify(r)).join('\n')
        : '(no rows)';
      return { content: [{ type: 'text', text }] };
    } finally {
      db.close();
    }
  },
);

await server.connect(new StdioServerTransport());
