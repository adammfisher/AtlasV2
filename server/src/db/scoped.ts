/**
 * Hard-isolation query helpers (PRD §2 invariant).
 *
 * Every project-scoped read goes through these. No helper can return rows whose
 * project_id differs from the requested project context. The single exception is
 * the explicit shared-library partition ('__shared__'), which callers opt into
 * per call via { includeShared: true } — never by default.
 */
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { getDb } from './db.js';
import { config } from '../config.js';

export const SHARED_PARTITION = '__shared__';

export interface ScopeOptions {
  /** Opt-in: also return rows from the '__shared__' partition (PRD §2). */
  includeShared?: boolean;
}

function scopeIds(projectId: string, opts?: ScopeOptions): string[] {
  return opts?.includeShared ? [projectId, SHARED_PARTITION] : [projectId];
}

function placeholders(n: number): string {
  return Array.from({ length: n }, () => '?').join(',');
}

export interface ConversationRow {
  id: string;
  project_id: string;
  title: string;
  created_at: number;
  updated_at: number;
}

export function scopedConversations(projectId: string): ConversationRow[] {
  return getDb()
    .prepare('SELECT * FROM conversations WHERE project_id = ? ORDER BY updated_at DESC')
    .all(projectId) as ConversationRow[];
}

export interface MessageRow {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  kind: string;
  payload: string;
  created_at: number;
}

export function scopedMessages(projectId: string): MessageRow[] {
  return getDb()
    .prepare(
      `SELECT m.* FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE c.project_id = ? ORDER BY m.created_at`,
    )
    .all(projectId) as MessageRow[];
}

export interface ArtifactRow {
  id: string;
  project_id: string;
  name: string;
  kind: string;
  current_version: number;
  created_at: number;
}

export function scopedArtifacts(projectId: string, opts?: ScopeOptions): ArtifactRow[] {
  const ids = scopeIds(projectId, opts);
  return getDb()
    .prepare(
      `SELECT * FROM artifacts WHERE project_id IN (${placeholders(ids.length)}) ORDER BY created_at DESC`,
    )
    .all(...ids) as ArtifactRow[];
}

export interface ArtifactVersionRow {
  id: string;
  artifact_id: string;
  version: number;
  file_path: string | null;
  meta: string | null;
  validation: string | null;
  payload: string | null;
  created_at: number;
}

export function scopedArtifactVersions(projectId: string): ArtifactVersionRow[] {
  return getDb()
    .prepare(
      `SELECT v.* FROM artifact_versions v
       JOIN artifacts a ON a.id = v.artifact_id
       WHERE a.project_id = ? ORDER BY v.created_at`,
    )
    .all(projectId) as ArtifactVersionRow[];
}

export interface MemKvRow {
  project_id: string;
  key: string;
  value: string;
}

export function scopedMemKv(projectId: string, opts?: ScopeOptions): MemKvRow[] {
  const ids = scopeIds(projectId, opts);
  return getDb()
    .prepare(`SELECT * FROM mem_kv WHERE project_id IN (${placeholders(ids.length)})`)
    .all(...ids) as MemKvRow[];
}

export interface GraphNodeRow {
  id: string;
  project_id: string;
  kind: string;
  name: string;
  props: string;
}

export function scopedGraphNodes(projectId: string, opts?: ScopeOptions): GraphNodeRow[] {
  const ids = scopeIds(projectId, opts);
  return getDb()
    .prepare(`SELECT * FROM mem_graph_nodes WHERE project_id IN (${placeholders(ids.length)})`)
    .all(...ids) as GraphNodeRow[];
}

export interface GraphEdgeRow {
  src: string;
  dst: string;
  project_id: string;
  rel: string;
  props: string;
}

export function scopedGraphEdges(projectId: string, opts?: ScopeOptions): GraphEdgeRow[] {
  const ids = scopeIds(projectId, opts);
  return getDb()
    .prepare(`SELECT * FROM mem_graph_edges WHERE project_id IN (${placeholders(ids.length)})`)
    .all(...ids) as GraphEdgeRow[];
}

export interface ProductStateRow {
  id: string;
  artifact_id: string;
  state: string;
  note: string;
  stamped_by: string | null;
  at_version: number | null;
  created_at: number;
}

/** product_states is project-scoped through its artifact (Amendment 1 §A2). */
export function scopedProductStates(projectId: string): ProductStateRow[] {
  return getDb()
    .prepare(
      `SELECT s.* FROM product_states s
       JOIN artifacts a ON a.id = s.artifact_id
       WHERE a.project_id = ? ORDER BY s.created_at`,
    )
    .all(projectId) as ProductStateRow[];
}

export interface ProjectionRow {
  id: string;
  artifact_id: string;
  kind: string;
  at_version: number;
  output_ref: string | null;
  target_ref: string | null;
  status: string;
  created_at: number;
}

/** projections is project-scoped through its artifact (Amendment 1 §A2). */
export function scopedProjections(projectId: string): ProjectionRow[] {
  return getDb()
    .prepare(
      `SELECT p.* FROM projections p
       JOIN artifacts a ON a.id = p.artifact_id
       WHERE a.project_id = ? ORDER BY p.created_at`,
    )
    .all(projectId) as ProjectionRow[];
}

const PROJECT_ID_RE = /^[A-Za-z0-9_-]+$/;

/**
 * The per-project files root (dataDir/projects/<projectId>/files), created on
 * first use. Rejects any projectId that could escape the jail; the resolved
 * path is asserted to stay inside dataDir/projects.
 */
export function projectFilesRoot(projectId: string): string {
  if (!PROJECT_ID_RE.test(projectId)) {
    throw new Error(`invalid project id: ${JSON.stringify(projectId)}`);
  }
  const base = path.resolve(config.dataDir, 'projects');
  const root = path.resolve(base, projectId, 'files');
  if (!root.startsWith(base + path.sep)) {
    throw new Error(`path escape blocked for project id: ${JSON.stringify(projectId)}`);
  }
  mkdirSync(root, { recursive: true });
  return root;
}
