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
  id: string;
  name: string;
  vendor: string;
  featured?: boolean;
  icon: string;
  colorToken: string;
  transport: string;
  endpoint: string;
  status: 'bundled' | 'installed' | 'available' | 'error';
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
  models: ModelEntry[];
  selected: string;
  bedrock: { connected: boolean };
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
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
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
  conversations: () => request<Conversation[]>('/conversations'),
  createConversation: () =>
    request<Conversation>('/conversations', { method: 'POST', body: JSON.stringify({}) }),
  conversation: (id: string) => request<ConversationDetail>(`/conversations/${id}`),
  skills: () => request<Skill[]>('/skills'),
  toggleSkill: (id: string, enabled: boolean) =>
    request<{ ok: boolean }>(`/skills/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
  pluginsDirectory: () => request<PluginEntry[]>('/plugins/directory'),
  togglePluginProject: (installId: string, projectId: string, enabled: boolean) =>
    request<{ ok: boolean; enabledProjects: string[] }>(`/plugins/installs/${installId}/projects`, {
      method: 'POST',
      body: JSON.stringify({ projectId, enabled }),
    }),
  installPlugin: (connectorId: string) =>
    request<{ ok: boolean }>('/plugins/installs', {
      method: 'POST',
      body: JSON.stringify({ connectorId }),
    }),
  artifact: (id: string) => request<ArtifactDetailData>(`/artifacts/${id}`),
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
};
