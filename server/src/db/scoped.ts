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
import {
  listConversations,
  listMessages,
  listArtifacts,
  listVersions,
  listProductStates,
  listProjectionsFor,
  type ConversationRow,
  type MessageRow,
  type ArtifactRow,
  type ArtifactVersionRow,
  type ProductStateRow,
  type ProjectionRow,
} from './appdb.js';
import { config } from '../config.js';

export const SHARED_PARTITION = '__shared__';

export interface ScopeOptions {
  /** Opt-in: also return rows from the '__shared__' partition (PRD §2). */
  includeShared?: boolean;
}

function scopeIds(projectId: string, opts?: ScopeOptions): string[] {
  return opts?.includeShared ? [projectId, SHARED_PARTITION] : [projectId];
}

export type {
  ConversationRow,
  MessageRow,
  ArtifactRow,
  ArtifactVersionRow,
  ProductStateRow,
  ProjectionRow,
};

export async function scopedConversations(projectId: string): Promise<ConversationRow[]> {
  return listConversations(projectId); // sorted updated_at DESC
}

export async function scopedMessages(projectId: string): Promise<MessageRow[]> {
  const convs = await listConversations(projectId);
  const all: MessageRow[] = [];
  for (const c of convs) all.push(...(await listMessages(c.id)));
  return all.sort((a, b) => a.created_at - b.created_at);
}

export async function scopedArtifacts(projectId: string, opts?: ScopeOptions): Promise<ArtifactRow[]> {
  return listArtifacts(scopeIds(projectId, opts)); // sorted created_at DESC
}

export async function scopedArtifactVersions(projectId: string): Promise<ArtifactVersionRow[]> {
  const artifacts = await listArtifacts([projectId]);
  const all: ArtifactVersionRow[] = [];
  for (const a of artifacts) all.push(...(await listVersions(a.id)));
  return all.sort((a, b) => a.created_at - b.created_at);
}

/** product_states is project-scoped through its artifact (Amendment 1 §A2). */
export async function scopedProductStates(projectId: string): Promise<ProductStateRow[]> {
  const artifacts = await listArtifacts([projectId]);
  const all: ProductStateRow[] = [];
  for (const a of artifacts) all.push(...(await listProductStates(a.id)));
  return all.sort((a, b) => a.created_at - b.created_at);
}

/** projections is project-scoped through its artifact (Amendment 1 §A2). */
export async function scopedProjections(projectId: string): Promise<ProjectionRow[]> {
  const artifacts = await listArtifacts([projectId]);
  const all: ProjectionRow[] = [];
  for (const a of artifacts) all.push(...(await listProjectionsFor(a.id)));
  return all.sort((a, b) => a.created_at - b.created_at);
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
