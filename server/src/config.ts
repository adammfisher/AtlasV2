import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export type Brand = 'axiom' | 'atlas';

export interface AxiomConfig {
  userName: string;
  /** Display brand — logo + every visible product name. Defaults to 'axiom'
   * when absent so older/bundled configs that predate this field don't need
   * updating. Deliberately does NOT touch AWS resource names, data paths, or
   * the ATLAS_AUTH_SECRET env fallback — those are infra, not display. */
  brand?: Brand;
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

/** Walk up from this module until axiom.config.json appears — the same code
 * runs from server/src (dev) and from the flatter portable bundle layout. */
function findRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 5; i++) {
    if (existsSync(path.join(dir, 'axiom.config.json'))) return dir;
    dir = path.dirname(dir);
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
}

export const repoRoot = findRoot();

function resolveRel(p: string): string {
  return p.startsWith('./') || p.startsWith('../') ? path.resolve(repoRoot, p) : p;
}

export function loadConfig(): AxiomConfig {
  const raw = readFileSync(path.join(repoRoot, 'axiom.config.json'), 'utf8');
  const cfg = JSON.parse(raw) as AxiomConfig;
  cfg.brand = cfg.brand === 'atlas' ? 'atlas' : 'axiom';
  // Lambda: /var/task is read-only — all scratch space lives in /tmp
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
    cfg.dataDir = '/tmp/axiom';
    cfg.models.dir = '/tmp/axiom/models';
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
