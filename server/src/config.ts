import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export interface AtlasConfig {
  userName: string;
  dataDir: string;
  models: { dir: string; manifestUrl: string | null };
  llamaServer: {
    binary: string;
    chatPort: number;
    embedPort: number;
    ctx: number;
    parallel: number;
    extraFlags: string[];
  };
  server: { port: number };
  bedrock: { enabled: boolean; region: string; profile: string };
}

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function loadConfig(): AtlasConfig {
  const raw = readFileSync(path.join(repoRoot, 'atlas.config.json'), 'utf8');
  return JSON.parse(raw) as AtlasConfig;
}

export const config = loadConfig();
