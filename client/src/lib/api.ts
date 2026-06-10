/* Typed client for the Atlas API (all under /api, proxied to :5175 in dev). */

export interface Project {
  id: string;
  name: string;
  instructions: string;
  created_at: number;
  chats: number;
  artifacts: number;
  memory: string;
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
}

export interface TextMessage {
  id: string;
  role: 'user' | 'assistant';
  kind: 'text';
  text: string;
  pending?: boolean;
  error?: string;
}

export interface PipelineMessageData {
  id: string;
  role: 'assistant';
  kind: 'pipeline';
  stage: number;
  skill: string;
  edit?: boolean;
  escalated?: boolean;
  modelChip: string;
  skillChip: string;
  extraChip?: string;
  steps: string[];
  checks: Array<[string, number]>;
  artifact?: ArtifactRef;
  text: string;
  diagram?: boolean;
  preview?: boolean;
}

export type Message = TextMessage | PipelineMessageData;

export interface ConversationDetail extends Conversation {
  messages: Message[];
}

export interface Skill {
  id: string;
  name: string;
  ext: string;
  triggers: string;
  metaTokens: number;
  fullTokens: string;
  helper: string;
  checks: string[];
  tier: string;
  schema: string;
  enabled: boolean;
}

export interface PluginEntry {
  id: string;
  name: string;
  vendor: string;
  description: string;
  icon: string;
  transport: string;
  launch?: string;
  url?: string;
  auth: 'none' | 'token' | 'connection';
  authFields?: Array<[string, string]>;
  toolsPreview: Array<[string, string]>;
  status: 'connected' | 'installing' | 'available' | 'planned' | 'error';
  plannedNotice?: string;
  bundledRuntime?: boolean;
  category: string;
  installId: string | null;
  enabledProjects: string[];
  lastError: string | null;
}

export interface ArtifactSummary {
  id: string;
  projectId: string;
  project: string;
  name: string;
  kind: string;
  ver: number;
  meta: string;
  created_at: number;
}

export interface ArtifactVersion {
  version: number;
  meta: string | null;
  validation: Array<[string, number]>;
  hasFile: boolean;
  created_at: number;
}

export interface ArtifactDetailData extends ArtifactSummary {
  versions: ArtifactVersion[];
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
  hardware: { ramGB: number; ctx: number; residentFile: string | null };
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
  artifacts: () => request<ArtifactSummary[]>('/artifacts'),
  artifact: (id: string) => request<ArtifactDetailData>(`/artifacts/${id}`),
  models: () => request<ModelsRegistry>('/models'),
  selectModel: (id: string) =>
    request<{ ok: boolean }>('/models/select', { method: 'POST', body: JSON.stringify({ id }) }),
  bedrockConnect: (region: string, profile: string) =>
    request<{ ok: boolean }>('/models/bedrock/connect', {
      method: 'POST',
      body: JSON.stringify({ region, profile }),
    }),
};
