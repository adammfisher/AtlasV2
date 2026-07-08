/* Typed client for the Atlas API (all under /api, proxied to :5175 in dev). */

export interface Project {
  id: string;
  name: string;
  instructions: string;
  created_at: number;
  chats: number;
  templates: number;
  plugins: number;
  shared: boolean;
}

export interface Conversation {
  id: string;
  projectId: string;
  title: string;
  created_at: number;
  updated_at: number;
}

export interface ArtifactRef {
  artifactId?: string;
  name: string;
  kind: string;
  meta: string;
  ver: number;
  state?: string | null;
}

export interface PipelineStep {
  state: 'ok' | 'warn' | 'pending';
  label: string;
  detail?: string;
}

export interface TextMessage {
  id: string;
  role: 'user' | 'assistant';
  kind: 'text';
  text: string;
  feedback?: 'up' | 'down' | '' | null;
  toolCalls?: Array<{ tool: string; connector: string }>;
  attachments?: Array<{ id: string; name: string; kind: 'image' | 'document' }>;
}

export interface PipelineMessageData {
  id: string;
  role: 'assistant';
  kind: 'pipeline';
  skill: string;
  skillBadge?: string;
  duration?: string;
  edit?: boolean;
  steps: PipelineStep[];
  text: string;
  artifact?: ArtifactRef;
}

export type Message = TextMessage | PipelineMessageData;

export interface ConversationDetail extends Conversation {
  messages: Message[];
}

export interface Skill {
  id: string;
  name: string;
  ext: string;
  icon: string;
  colorToken: string;
  triggers: string;
  metaTokens: number;
  fullTokens: number;
  helper: string;
  validators: string[];
  tier: string;
  note: string;
  enabled: boolean;
}

export interface PluginEntry {
  hasCredentials?: boolean;
  id: string;
  name: string;
  vendor: string;
  featured?: boolean;
  icon: string;
  colorToken: string;
  transport: string;
  endpoint: string;
  status: 'bundled' | 'installed' | 'available' | 'error' | 'connected' | 'installing' | 'planned';
  description: string;
  tools: string[];
  creds: Array<{ key: string; label: string }>;
  runtime: string;
  installId: string | null;
  enabledProjects: string[];
  lastError: string | null;
}

export interface ArtifactVersion {
  version: number;
  meta: string | null;
  validation: PipelineStep[];
  hasFile: boolean;
  created_at: number;
}

export interface ProjectionRow {
  id: string;
  kind: string;
  atVersion: number;
  status: string;
  stale: boolean;
  generated: boolean;
  outputRef: string | null;
  targetRef: string | null;
}

export interface ProductStateRow {
  state: string;
  note: string;
  stamped_by: string;
  at_version: number;
  created_at: number;
}

export interface ArtifactDetailData {
  id: string;
  projectId: string;
  project: string;
  name: string;
  kind: string;
  ver: number;
  meta: string;
  state: string | null;
  created_at: number;
  versions: ArtifactVersion[];
  timeline?: ProductStateRow[];
  promote?: { to: string; unmet: string[] } | null;
  projections?: ProjectionRow[];
  payload?: Record<string, unknown> | null;
}

export interface ModelEntry {
  id: string;
  name: string;
  sub: string;
  file: string | null;
  sizeGB: number | null;
  present: boolean;
  selectable: boolean;
  roles: string[];
}

export interface ModelsRegistry {
  /** The Claude models Atlas exposes — the only selectable inference backends. */
  bedrockModels: Array<{ id: string; name: string; sub: string }>;
  models: ModelEntry[];
  selected: string;
  bedrock: { connected: boolean; region?: string; profile?: string; modelId?: string };
  hardware: {
    ramGB: number;
    rssGB: number;
    ctx: number;
    residentFile: string | null;
    residentTier: string | null;
  };
}

export interface Health {
  ok: boolean;
  llama: {
    status: 'starting' | 'ready' | 'restarting' | 'error' | 'stopped';
    modelFile: string | null;
    port: number;
    pid: number | null;
    error: string | null;
  };
  llamaVersion: string;
  models: Array<{ id: string; file: string | null; present: boolean }>;
  appVersion: string;
}

export type Settings = Record<string, string>;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    const message = body.error ?? `${res.status} ${res.statusText}`;
    window.dispatchEvent(new CustomEvent('atlas-error', { detail: message }));
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => request<Health>('/health'),
  settings: () => request<Settings>('/settings'),
  patchSettings: (patch: Settings) =>
    request<{ ok: boolean }>('/settings', { method: 'PATCH', body: JSON.stringify(patch) }),
  projects: () => request<Project[]>('/projects'),
  createProject: (name: string, instructions: string) =>
    request<Project>('/projects', { method: 'POST', body: JSON.stringify({ name, instructions }) }),
  deleteProject: (id: string) => request<{ ok: boolean }>(`/projects/${id}`, { method: 'DELETE' }),
  updateProject: (id: string, patch: { name?: string; instructions?: string }) =>
    request<Project>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  conversations: () => request<Conversation[]>('/conversations'),
  createConversation: (projectId?: string) =>
    request<Conversation>('/conversations', { method: 'POST', body: JSON.stringify(projectId ? { projectId } : {}) }),
  conversation: (id: string) => request<ConversationDetail>(`/conversations/${id}`),
  deleteConversations: (ids: string[]) =>
    request<{ ok: boolean; deleted: number }>('/conversations/delete', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),
  skills: () => request<Skill[]>('/skills'),
  toggleSkill: (id: string, enabled: boolean) =>
    request<{ ok: boolean }>(`/skills/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
  pluginsDirectory: () => request<PluginEntry[]>('/plugins/directory'),
  togglePluginProject: (installId: string, projectId: string, enabled: boolean) =>
    request<{ ok: boolean; enabledProjects: string[] }>(`/plugins/installs/${installId}/projects`, {
      method: 'POST',
      body: JSON.stringify({ projectId, enabled }),
    }),
  installPlugin: (connectorId: string, projectId?: string) =>
    request<{ installId: string; status: string; lastError: string | null }>('/plugins/installs', {
      method: 'POST',
      body: JSON.stringify({ connectorId, projectId }),
    }),
  removePlugin: (installId: string) =>
    request<{ ok: boolean }>(`/plugins/installs/${installId}`, { method: 'DELETE' }),
  restartPlugin: (installId: string, projectId?: string) =>
    request<{ status: string; lastError: string | null }>(`/plugins/installs/${installId}/restart`, {
      method: 'POST',
      body: JSON.stringify({ projectId }),
    }),
  setPluginCredential: (installId: string, value: string) =>
    request<{ ok: boolean; hasCredentials: boolean }>(`/plugins/installs/${installId}/credentials`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    }),
  addCustomPlugin: (cfg: { name: string; transport: string; command?: string; args?: string[]; url?: string; projectId?: string }) =>
    request<{ installId: string; status: string; lastError: string | null }>('/plugins/custom', {
      method: 'POST',
      body: JSON.stringify(cfg),
    }),
  pluginTools: (installId: string, projectId: string) =>
    request<Array<{ name: string; description: string }>>(
      `/plugins/installs/${installId}/tools?projectId=${encodeURIComponent(projectId)}`,
    ),
  artifact: (id: string) => request<ArtifactDetailData>(`/artifacts/${id}`),
  revealArtifact: (id: string, version: number) =>
    request<{ ok: boolean }>(`/artifacts/${id}/versions/${version}/reveal`, { method: 'POST' }),
  restoreArtifact: (id: string, version: number) =>
    request<{ ok: boolean; ver: number }>(`/artifacts/${id}/restore`, {
      method: 'POST',
      body: JSON.stringify({ version }),
    }),
  promoteProduct: (id: string, to: string, note: string) =>
    request<{ ok: boolean; state: string; ambers: string[] }>(`/artifacts/${id}/state`, {
      method: 'POST',
      body: JSON.stringify({ to, note }),
    }),
  generateProjection: (id: string, kind: string) =>
    request<ProjectionRow>(`/artifacts/${id}/projections`, {
      method: 'POST',
      body: JSON.stringify({ kind }),
    }),
  models: () => request<ModelsRegistry>('/models'),
  selectModel: (id: string) =>
    request<{ ok: boolean }>('/models/select', { method: 'POST', body: JSON.stringify({ id }) }),
  uploadAttachment: (name: string, dataBase64: string) =>
    request<{ id: string; name: string; kind: 'image' | 'document'; size: number }>('/uploads', {
      method: 'POST',
      body: JSON.stringify({ name, dataBase64 }),
    }),
  projectMemory: (projectId: string) =>
    request<{
      kv: Array<{ key: string; value: string }>;
      notes: Array<{ id: string; content: string; created_at: number }>;
      facts: Array<{ src: string; rel: string; dst: string }>;
      profile: { text: string; generated_at: number; fact_count: number } | null;
    }>(`/projects/${projectId}/memory`),
  consolidateMemory: (scopeId: string) =>
    request<{ ok: boolean; profile: string | null }>(`/projects/${scopeId}/memory/consolidate`, {
      method: 'POST',
    }),
  upsertProjectMemory: (projectId: string, key: string, value: string) =>
    request<{ ok: boolean }>(`/projects/${projectId}/memory/kv`, {
      method: 'PUT',
      body: JSON.stringify({ key, value }),
    }),
  deleteProjectMemory: (projectId: string, kind: string, ref: Record<string, string>) =>
    request<{ ok: boolean }>(`/projects/${projectId}/memory/delete`, {
      method: 'POST',
      body: JSON.stringify({ kind, ref }),
    }),
  messageFeedback: (convId: string, messageId: string, rating: 'up' | 'down' | null) =>
    request<{ ok: boolean }>(`/conversations/${convId}/feedback`, {
      method: 'POST',
      body: JSON.stringify({ messageId, rating }),
    }),
  renameConversation: (id: string, title: string) =>
    request<{ ok: boolean }>(`/conversations/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) }),
  searchConversations: (q: string) =>
    request<Conversation[]>(`/conversations/search?q=${encodeURIComponent(q)}`),
  truncateConversation: (id: string, messageId: string, inclusive: boolean) =>
    request<{ ok: boolean; deleted: number }>(`/conversations/${id}/truncate`, {
      method: 'POST',
      body: JSON.stringify({ messageId, inclusive }),
    }),
  projectKnowledge: (projectId: string) =>
    request<Array<{ id: string; name: string; size: number; status: string; chunks: number; error: string | null; created_at: number }>>(
      `/projects/${projectId}/knowledge`,
    ),
  uploadKnowledge: (projectId: string, name: string, dataBase64: string) =>
    request<{ id: string; status: string }>('/uploads/knowledge', {
      method: 'POST',
      body: JSON.stringify({ projectId, name, dataBase64 }),
    }),
  deleteKnowledge: (projectId: string, kid: string) =>
    request<{ ok: boolean }>(`/projects/${projectId}/knowledge/${kid}/delete`, { method: 'POST' }),
  shareArtifact: (id: string, version: number) =>
    request<{ url: string; expiresDays: number }>(`/artifacts/${id}/versions/${version}/share`, { method: 'POST' }),
  conversationRemember: (convId: string) =>
    request<{ remember: boolean }>(`/conversations/${convId}/remember`),
  setConversationRemember: (convId: string, enabled: boolean) =>
    request<{ ok: boolean }>(`/conversations/${convId}/remember`, {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    }),
  revealModelsFolder: () => request<{ ok: boolean }>('/models/reveal', { method: 'POST' }),
  refreshModels: () => request<ModelsRegistry>('/models/refresh', { method: 'POST' }),
  connectBedrock: (region: string, profile: string) =>
    request<{ ok: boolean; models: number; region: string; modelId: string }>('/models/bedrock/connect', {
      method: 'POST',
      body: JSON.stringify({ region, profile }),
    }),
  disconnectBedrock: () => request<{ ok: boolean }>('/models/bedrock/disconnect', { method: 'POST' }),
};
