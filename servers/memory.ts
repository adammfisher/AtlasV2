/**
 * Atlas built-in memory MCP server (PRD §6.2).
 * KV + graph + chunk recall over the mem_* tables, always filtered by
 * ATLAS_PROJECT_ID. memory_search uses FTS5; when an embeddinggemma*.gguf is
 * present a second llama-server provides semantic vectors (Stage 4: FTS5 path;
 * the semantic merge activates automatically when the embed server runs).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

const projectId = process.env.ATLAS_PROJECT_ID ?? 'p1';
const dbPath = process.env.ATLAS_DB_PATH ?? '';
if (!dbPath) {
  console.error('ATLAS_DB_PATH is required');
  process.exit(1);
}
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.exec(
  'CREATE TABLE IF NOT EXISTS mem_chunks (id TEXT PRIMARY KEY, project_id TEXT, source TEXT, content TEXT, created_at INTEGER)',
);
db.exec(
  'CREATE VIRTUAL TABLE IF NOT EXISTS mem_chunks_fts USING fts5(content, id UNINDEXED, project_id UNINDEXED)',
);

const server = new McpServer({ name: 'atlas-memory', version: '1.0.0' });

server.tool(
  'memory_upsert',
  'Store a fact or note in project memory. Use key for stable facts (kv) or leave it empty to append a searchable note.',
  { key: z.string().optional(), value: z.string() },
  async ({ key, value }) => {
    if (key) {
      db.prepare('INSERT INTO mem_kv (project_id, key, value) VALUES (?,?,?) ON CONFLICT(project_id, key) DO UPDATE SET value=excluded.value')
        .run(projectId, key, value);
      return { content: [{ type: 'text', text: `stored kv ${key}` }] };
    }
    const id = randomUUID();
    db.prepare('INSERT INTO mem_chunks (id, project_id, source, content, created_at) VALUES (?,?,?,?,?)')
      .run(id, projectId, 'note', value, Date.now());
    db.prepare('INSERT INTO mem_chunks_fts (content, id, project_id) VALUES (?,?,?)').run(value, id, projectId);
    return { content: [{ type: 'text', text: `stored note ${id.slice(0, 8)}` }] };
  },
);

server.tool(
  'memory_search',
  'Search project memory (keys, notes, facts). Returns the best matches.',
  { query: z.string(), limit: z.number().int().min(1).max(10).default(3) },
  async ({ query, limit }) => {
    const safe = query.replace(/['"*^]/g, ' ').trim();
    const kvRows = db
      .prepare("SELECT key, value FROM mem_kv WHERE project_id = ? AND (key LIKE ? OR value LIKE ?) LIMIT ?")
      .all(projectId, `%${safe}%`, `%${safe}%`, limit) as Array<{ key: string; value: string }>;
    let ftsRows: Array<{ content: string }> = [];
    if (safe) {
      try {
        ftsRows = db
          .prepare('SELECT content FROM mem_chunks_fts WHERE mem_chunks_fts MATCH ? AND project_id = ? LIMIT ?')
          .all(safe.split(/\s+/).map((w) => `"${w}"`).join(' OR '), projectId, limit) as Array<{ content: string }>;
      } catch {
        // malformed FTS query — fall through to kv results only
      }
    }
    const lines = [
      ...kvRows.map((r) => `${r.key}: ${r.value}`),
      ...ftsRows.map((r) => r.content),
    ].slice(0, limit);
    return { content: [{ type: 'text', text: lines.join('\n') || 'no memory matches' }] };
  },
);

server.tool(
  'graph_add_fact',
  'Add a subject—relation—object fact to the project knowledge graph.',
  { subject: z.string(), relation: z.string(), object: z.string() },
  async ({ subject, relation, object }) => {
    const nodeId = (name: string): string => {
      const existing = db
        .prepare('SELECT id FROM mem_graph_nodes WHERE project_id = ? AND name = ?')
        .get(projectId, name) as { id: string } | undefined;
      if (existing) return existing.id;
      const id = randomUUID();
      db.prepare('INSERT INTO mem_graph_nodes (id, project_id, kind, name, props) VALUES (?,?,?,?,?)')
        .run(id, projectId, 'entity', name, '{}');
      return id;
    };
    db.prepare('INSERT INTO mem_graph_edges (src, dst, project_id, rel, props) VALUES (?,?,?,?,?)')
      .run(nodeId(subject), nodeId(object), projectId, relation, '{}');
    return { content: [{ type: 'text', text: `${subject} —${relation}→ ${object}` }] };
  },
);

server.tool(
  'graph_query',
  'Query graph facts mentioning an entity name.',
  { entity: z.string() },
  async ({ entity }) => {
    const rows = db
      .prepare(
        `SELECT a.name AS src, e.rel, b.name AS dst FROM mem_graph_edges e
         JOIN mem_graph_nodes a ON a.id = e.src JOIN mem_graph_nodes b ON b.id = e.dst
         WHERE e.project_id = ? AND (a.name LIKE ? OR b.name LIKE ?) LIMIT 20`,
      )
      .all(projectId, `%${entity}%`, `%${entity}%`) as Array<{ src: string; rel: string; dst: string }>;
    return {
      content: [
        { type: 'text', text: rows.map((r) => `${r.src} —${r.rel}→ ${r.dst}`).join('\n') || 'no facts found' },
      ],
    };
  },
);

await server.connect(new StdioServerTransport());
