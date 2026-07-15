/**
 * Atlas GitLab MCP server (PRD §6.2).
 * Talks the GitLab REST API v4 with a personal access token. GITLAB_PAT and
 * GITLAB_URL arrive in the env from the install's credential/config record —
 * the token is never logged and never echoed back in a tool result.
 * Host is configurable so self-hosted instances work, not just gitlab.com.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const projectId = process.env.ATLAS_PROJECT_ID ?? 'p1';
const dataDir = process.env.ATLAS_DATA_DIR ?? '';
const token = process.env.GITLAB_PAT ?? '';
const host = (process.env.GITLAB_URL ?? 'https://gitlab.com').replace(/\/+$/, '');

if (!token) {
  console.error('GITLAB_PAT is required — add a personal access token in Plugins → GitLab');
  process.exit(1);
}

const AUDIT = dataDir ? path.join(dataDir, 'logs', 'audit.log') : '';
if (AUDIT) mkdirSync(path.dirname(AUDIT), { recursive: true });

function audit(tool: string, target: string): void {
  if (!AUDIT) return;
  appendFileSync(AUDIT, `${new Date().toISOString()}\t${projectId}\tgitlab.${tool}\t${target}\n`);
}

/** GitLab accepts a numeric id or a URL-encoded "group/project" path. */
function projectRef(ref: string): string {
  return encodeURIComponent(ref.trim());
}

async function gl(pathname: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${host}/api/v4${pathname}`, {
    ...init,
    headers: {
      'PRIVATE-TOKEN': token,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // surface GitLab's own message, but never the token
    throw new Error(`GitLab ${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 300)}` : ''}`);
  }
  return res.json();
}

function text(value: string) {
  return { content: [{ type: 'text' as const, text: value || '(no results)' }] };
}

const server = new McpServer({ name: 'atlas-gitlab', version: '1.0.0' });

interface Project {
  id: number;
  path_with_namespace: string;
  description: string | null;
  web_url: string;
}
interface Issue {
  iid: number;
  title: string;
  state: string;
  author?: { username?: string };
  labels?: string[];
  description?: string | null;
  web_url: string;
}
interface Mr extends Issue {
  source_branch: string;
  target_branch: string;
  draft?: boolean;
}

server.tool(
  'gitlab_search_projects',
  'Search GitLab projects the token can see. Returns the path_with_namespace to use as `project` in the other tools.',
  {
    search: z.string().describe('Text to match against project name/path'),
    limit: z.number().int().min(1).max(50).default(20).describe('Max projects to return'),
  },
  async ({ search, limit }) => {
    audit('search_projects', search);
    const rows = (await gl(
      `/projects?search=${encodeURIComponent(search)}&membership=true&per_page=${limit}&order_by=last_activity_at`,
    )) as Project[];
    return text(
      rows
        .map((p) => `${p.path_with_namespace} (id ${p.id})${p.description ? ` — ${p.description}` : ''}`)
        .join('\n'),
    );
  },
);

server.tool(
  'gitlab_list_issues',
  'List issues in a GitLab project.',
  {
    project: z.string().describe('Project id or "group/project" path'),
    state: z.enum(['opened', 'closed', 'all']).default('opened').describe('Issue state filter'),
    search: z.string().optional().describe('Optional text to match in title/description'),
    limit: z.number().int().min(1).max(50).default(20).describe('Max issues to return'),
  },
  async ({ project, state, search, limit }) => {
    audit('list_issues', project);
    const q = search ? `&search=${encodeURIComponent(search)}` : '';
    const rows = (await gl(
      `/projects/${projectRef(project)}/issues?state=${state}&per_page=${limit}${q}`,
    )) as Issue[];
    return text(
      rows
        .map((i) => `#${i.iid} [${i.state}] ${i.title}${i.labels?.length ? ` (${i.labels.join(', ')})` : ''}`)
        .join('\n'),
    );
  },
);

server.tool(
  'gitlab_get_issue',
  'Read a single GitLab issue including its description.',
  {
    project: z.string().describe('Project id or "group/project" path'),
    iid: z.number().int().describe('Issue iid (the #N shown in GitLab)'),
  },
  async ({ project, iid }) => {
    audit('get_issue', `${project}#${iid}`);
    const i = (await gl(`/projects/${projectRef(project)}/issues/${iid}`)) as Issue;
    return text(
      [
        `#${i.iid} ${i.title}`,
        `state: ${i.state}${i.author?.username ? ` · author: ${i.author.username}` : ''}`,
        i.labels?.length ? `labels: ${i.labels.join(', ')}` : '',
        i.web_url,
        '',
        i.description ?? '(no description)',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  },
);

server.tool(
  'gitlab_create_issue',
  'Create an issue in a GitLab project. Writes to the real project — only call when the user asked for it.',
  {
    project: z.string().describe('Project id or "group/project" path'),
    title: z.string().describe('Issue title'),
    description: z.string().optional().describe('Markdown body'),
    labels: z.string().optional().describe('Comma-separated labels'),
  },
  async ({ project, title, description, labels }) => {
    audit('create_issue', `${project}:${title}`);
    const i = (await gl(`/projects/${projectRef(project)}/issues`, {
      method: 'POST',
      body: JSON.stringify({ title, description, labels }),
    })) as Issue;
    return text(`created #${i.iid} — ${i.web_url}`);
  },
);

server.tool(
  'gitlab_list_merge_requests',
  'List merge requests in a GitLab project.',
  {
    project: z.string().describe('Project id or "group/project" path'),
    state: z.enum(['opened', 'merged', 'closed', 'all']).default('opened').describe('MR state filter'),
    limit: z.number().int().min(1).max(50).default(20).describe('Max MRs to return'),
  },
  async ({ project, state, limit }) => {
    audit('list_merge_requests', project);
    const rows = (await gl(
      `/projects/${projectRef(project)}/merge_requests?state=${state}&per_page=${limit}`,
    )) as Mr[];
    return text(
      rows
        .map((m) => `!${m.iid} [${m.state}]${m.draft ? ' (draft)' : ''} ${m.title} — ${m.source_branch} → ${m.target_branch}`)
        .join('\n'),
    );
  },
);

server.tool(
  'gitlab_get_merge_request',
  'Read a single GitLab merge request including its description.',
  {
    project: z.string().describe('Project id or "group/project" path'),
    iid: z.number().int().describe('Merge request iid (the !N shown in GitLab)'),
  },
  async ({ project, iid }) => {
    audit('get_merge_request', `${project}!${iid}`);
    const m = (await gl(`/projects/${projectRef(project)}/merge_requests/${iid}`)) as Mr;
    return text(
      [
        `!${m.iid} ${m.title}`,
        `state: ${m.state}${m.draft ? ' (draft)' : ''} · ${m.source_branch} → ${m.target_branch}`,
        m.web_url,
        '',
        m.description ?? '(no description)',
      ].join('\n'),
    );
  },
);

await server.connect(new StdioServerTransport());
