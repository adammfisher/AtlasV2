/**
 * §8 model downloads: manifest-driven, resumable (.part + Range), SHA256
 * verified, progress surfaced in the registry. Only used when a manifestUrl is
 * configured; the place-a-GGUF flow is the default.
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, renameSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { logTo } from '../log.js';

export interface ManifestModel {
  name: string;
  tier: string;
  quant: string;
  url: string;
  sha256: string;
  sizeBytes: number;
}

export interface DownloadState {
  name: string;
  state: 'downloading' | 'verifying' | 'done' | 'error';
  pct: number;
  error?: string;
}

const downloads = new Map<string, DownloadState>();

export function downloadStates(): DownloadState[] {
  return [...downloads.values()];
}

export async function fetchManifest(overrideUrl?: string): Promise<ManifestModel[]> {
  const url = overrideUrl ?? config.models.manifestUrl;
  if (!url) throw new Error('no manifestUrl configured — place GGUF files in the models folder instead');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`manifest fetch failed: ${res.status}`);
  const data = (await res.json()) as { models?: ManifestModel[] };
  return data.models ?? [];
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash('sha256');
  await new Promise<void>((resolve, reject) => {
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve())
      .on('error', reject);
  });
  return hash.digest('hex');
}

export async function downloadModel(model: ManifestModel): Promise<void> {
  const target = path.join(config.models.dir, model.name);
  const part = `${target}.part`;
  const entry: DownloadState = { name: model.name, state: 'downloading', pct: 0 };
  downloads.set(model.name, entry);

  try {
    const have = existsSync(part) ? statSync(part).size : 0;
    const headers: Record<string, string> = have > 0 ? { Range: `bytes=${have}-` } : {};
    const res = await fetch(model.url, { headers });
    if (!res.ok || !res.body) throw new Error(`download failed: ${res.status}`);
    const resumed = res.status === 206;
    const out = createWriteStream(part, { flags: resumed ? 'a' : 'w' });
    let written = resumed ? have : 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      out.write(value);
      written += value.length;
      entry.pct = Math.min(99, Math.round((written / model.sizeBytes) * 100));
    }
    await new Promise<void>((resolve, reject) => out.end((err: Error | null | undefined) => (err ? reject(err) : resolve())));

    entry.state = 'verifying';
    const digest = await sha256File(part);
    if (digest !== model.sha256.toLowerCase()) {
      rmSync(part, { force: true });
      throw new Error(`SHA256 mismatch (got ${digest.slice(0, 12)}…, manifest says ${model.sha256.slice(0, 12)}…)`);
    }
    renameSync(part, target);
    entry.state = 'done';
    entry.pct = 100;
    logTo('app', `model downloaded + verified: ${model.name}`);
  } catch (err) {
    entry.state = 'error';
    entry.error = err instanceof Error ? err.message : String(err);
    logTo('app', `model download failed: ${model.name} — ${entry.error}`);
  }
}
