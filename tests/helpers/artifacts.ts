/**
 * Artifact-flow helpers for the Phase 3 live suite (TESTPLAN §5 A-tests).
 * Downloads go through the real API as e2etest; validation shells out to the
 * Python validity harness; router decisions are asserted from pipeline.log —
 * never inferred from prose.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { API, loginE2E, api, streamMessage } from './axiom-api.js';

const exec = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SCRATCH = path.join(os.tmpdir(), 'axiom-artifact-tests');

export interface ArtifactDetail {
  id: string;
  name: string;
  kind: string;
  ver: number;
  versions: Array<{ version: number; hasFile: boolean; created_at: number }>;
}

export async function artifactDetail(id: string): Promise<ArtifactDetail> {
  return api<ArtifactDetail>(`/artifacts/${id}`);
}

/** Download a version through the real endpoint; returns the saved file path. */
export async function downloadArtifact(id: string, ver: number, ext: string): Promise<string> {
  const token = await loginE2E();
  const res = await fetch(`${API}/artifacts/${id}/versions/${ver}/download`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`download ${id} v${ver} → ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 64) throw new Error(`download ${id} v${ver}: implausibly small (${buf.length} bytes)`);
  mkdirSync(SCRATCH, { recursive: true });
  const file = path.join(SCRATCH, `${id}-v${ver}.${ext}`);
  writeFileSync(file, buf);
  return file;
}

export interface Verdict {
  ok: boolean;
  findings: string[];
}

/** Run the Python validity harness on a produced file. */
export async function validateFile(
  kind: string,
  file: string,
  spec?: { slides?: number; contains?: string[]; sheets?: string[]; columns?: string[] },
  opts?: { design?: boolean },
): Promise<Verdict> {
  const args = [path.join(ROOT, 'tests/validators/validate.py'), kind, file];
  if (spec) {
    mkdirSync(SCRATCH, { recursive: true });
    const specFile = path.join(SCRATCH, `spec-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(specFile, JSON.stringify(spec));
    args.push('--spec', specFile);
  }
  if (opts?.design) args.push('--design');
  try {
    const { stdout } = await exec(path.join(ROOT, 'runtimes/python/venv/bin/python'), args, { timeout: 240_000 });
    return JSON.parse(stdout.trim().split('\n').pop() ?? '{}') as Verdict;
  } catch (err) {
    const e = err as { stdout?: string; message?: string };
    const line = e.stdout?.trim().split('\n').pop();
    if (line?.startsWith('{')) return JSON.parse(line) as Verdict;
    return { ok: false, findings: [`validator crashed: ${e.message ?? String(err)}`] };
  }
}

/**
 * Router decisions logged for a conversation (dataDir/logs/pipeline.log).
 * Two label shapes come out of chat.ts:265 — the normal router path
 * (`<workflowId> stage=<s> conf=<c>`) and the product path (`product(<intent>)`,
 * no stage/conf). Handle both rather than only the former.
 */
export function routerDecisions(convId: string): Array<{ workflow: string; stage: string; intent: string; skill: string }> {
  const logFile = path.join(os.homedir(), 'Library/Application Support/AtlasLocal/logs/pipeline.log');
  const out: Array<{ workflow: string; stage: string; intent: string; skill: string }> = [];
  for (const line of readFileSync(logFile, 'utf8').split('\n')) {
    const m = line.match(/route conv=(\S+) (.+?) → intent=(\S+) skill=(\S+)/);
    if (!m || m[1] !== convId) continue;
    const label = m[2]!;
    const stage = label.match(/stage=(\S+)/)?.[1] ?? 'product';
    out.push({ workflow: label.split(' ')[0]!, stage, intent: m[3]!, skill: m[4]! });
  }
  return out;
}

/** Structured office extraction (slides/sheets/blocks) for update-vs-rewrite diffs. */
export async function extractPreview(id: string, ver: number): Promise<{
  slides?: Array<{ title: string; bullets: string[] }>;
  sheets?: Array<{ name: string; rows: string[][] }>;
  blocks?: Array<{ style: string; text?: string }>;
  text?: string;
}> {
  return api(`/artifacts/${id}/versions/${ver}/preview`);
}

/** raw source / file map for text + code kinds. */
export async function artifactContent(id: string, ver: number): Promise<{ source?: string; files?: Record<string, string>; entry?: string }> {
  return api(`/artifacts/${id}/versions/${ver}/content`);
}

/**
 * A file on disk suitable for `tests/validators/validate.py`. For single-file
 * kinds this is just the download. react/site are multi-file: the download
 * endpoint deliberately zips them (PRD §7 — the right thing for a human
 * downloading a React app), but js-validate.ts's react/site validator expects
 * the raw `{files, entry}` JSON the `/content` endpoint returns directly —
 * using the zip download here would hand the validator a zip and nothing
 * else. Not a product bug: two different endpoints for two different
 * consumers, both correct for their own purpose.
 */
export async function validatableFile(kind: string, id: string, ver: number, ext: string): Promise<string> {
  if (kind !== 'react' && kind !== 'site') return downloadArtifact(id, ver, ext);
  const content = await artifactContent(id, ver);
  mkdirSync(SCRATCH, { recursive: true });
  const file = path.join(SCRATCH, `${id}-v${ver}.json`);
  writeFileSync(file, JSON.stringify({ files: content.files ?? {}, entry: content.entry }));
  return file;
}

export interface PipelineMsg {
  id: string;
  kind: string;
  role: string;
  text?: string;
  edit?: boolean;
  artifact?: { artifactId?: string; kind: string; ver: number; name: string };
}

export async function lastPipelineMessage(convId: string): Promise<PipelineMsg | undefined> {
  const conv = await api<{ messages: PipelineMsg[] }>(`/conversations/${convId}`);
  return [...conv.messages].reverse().find((m) => m.kind === 'pipeline');
}

/**
 * The single most-recent assistant message regardless of kind — this is the
 * edit-vs-describe gate's real signal. A description-instead-of-edit failure
 * produces a `kind: 'text'` message, which `lastPipelineMessage` would never
 * see (it only looks at `kind === 'pipeline'` rows), silently passing a bug
 * this test suite exists specifically to catch.
 */
export async function lastMessage(convId: string): Promise<PipelineMsg | undefined> {
  const conv = await api<{ messages: PipelineMsg[] }>(`/conversations/${convId}`);
  const assistant = conv.messages.filter((m) => m.role === 'assistant');
  return assistant[assistant.length - 1];
}

export interface SendResult {
  messageId?: string;
  artifact?: { artifactId: string; name: string; kind: string; ver: number };
  error?: string;
  text: string;
  routeIntent?: string;
  tools: string[];
}

/** Send a message via the raw API and consume the SSE stream to completion —
 * no browser needed, so it's faster and immune to UI-selector flake for tests
 * that only care about structural correctness (Phase 3's A{skill}-* suite).
 * UI rendering itself is covered separately by A0-1 and the render checks. */
export async function sendAndWait(
  convId: string,
  text: string,
  opts?: { attachments?: Array<{ id: string; name: string; kind: 'image' | 'document' }>; timeoutMs?: number },
): Promise<SendResult> {
  const result: SendResult = { text: '', tools: [] };
  const timeout = opts?.timeoutMs ?? 180_000;
  const deadline = Date.now() + timeout;
  let buf = '';
  for await (const { chunk } of streamMessage(convId, text, { attachments: opts?.attachments })) {
    buf += chunk;
    let idx: number;
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const block = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const lines = block.split('\n');
      const eventLine = lines.find((l) => l.startsWith('event: '));
      const dataLine = lines.find((l) => l.startsWith('data: '));
      if (!eventLine || !dataLine) continue;
      const event = eventLine.slice(7).trim();
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(dataLine.slice(6)) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (event === 'artifact') result.artifact = data as unknown as SendResult['artifact'];
      else if (event === 'tool' && typeof data.tool === 'string') result.tools.push(data.tool);
      else if (event === 'error') result.error = String(data.message ?? 'error');
      else if (event === 'done') result.messageId = String(data.messageId ?? '');
      else if (event === 'route') result.routeIntent = String(data.intent ?? '');
      else if (event === 'assistant_text') result.text += String(data.text ?? '');
      else if (event === 'token') result.text += String(data.delta ?? '');
    }
    if (Date.now() > deadline) throw new Error(`sendAndWait: exceeded ${timeout}ms waiting for "${text.slice(0, 60)}" to complete`);
  }
  return result;
}

export async function uploadFixture(name: string): Promise<{ id: string; name: string; kind: 'image' | 'document' }> {
  const data = readFileSync(path.join(ROOT, 'tests/fixtures/files', name));
  return api(`/uploads`, {
    method: 'POST',
    body: JSON.stringify({ name, dataBase64: data.toString('base64') }),
  });
}
