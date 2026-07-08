import { readFileSync, existsSync } from 'node:fs';
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

/** Walk up from this module until atlas.config.json appears — the same code
 * runs from server/src (dev) and from the flatter portable bundle layout. */
function findRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    if (existsSync(path.join(dir, 'atlas.config.json'))) return dir;
    dir = path.dirname(dir);
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
}

export const repoRoot = findRoot();

function resolveRel(p: string): string {
  return p.startsWith('./') || p.startsWith('../') ? path.resolve(repoRoot, p) : p;
}

export function loadConfig(): AtlasConfig {
  const raw = readFileSync(path.join(repoRoot, 'atlas.config.json'), 'utf8');
  const cfg = JSON.parse(raw) as AtlasConfig;
  // Lambda: /var/task is read-only — all scratch space lives in /tmp
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
    cfg.dataDir = '/tmp/atlas';
    cfg.models.dir = '/tmp/atlas/models';
    return cfg;
  }
  // portable folder: relative paths resolve against the folder; if the
  // configured macOS dataDir is absent, fall back to ./data (PRD Stage 5)
  cfg.dataDir = resolveRel(cfg.dataDir);
  cfg.models.dir = resolveRel(cfg.models.dir);
  if (cfg.llamaServer.binary !== 'auto') cfg.llamaServer.binary = resolveRel(cfg.llamaServer.binary);
  if (!existsSync(path.dirname(cfg.dataDir))) {
    cfg.dataDir = path.join(repoRoot, 'data');
    cfg.models.dir = path.join(cfg.dataDir, 'models');
  }
  return cfg;
}

export const config = loadConfig();
export const dataDir = config.dataDir;
