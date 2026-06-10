import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

export type ModelTier = 'e2b' | 'e4b' | '12b' | 'embedding';

export interface ModelEntry {
  id: ModelTier;
  name: string;
  sub: string;
  file: string | null;
  sizeGB: number | null;
  present: boolean;
  selectable: boolean;
  roles: string[];
}

const CATALOG: Array<Omit<ModelEntry, 'file' | 'sizeGB' | 'present'>> = [
  {
    id: 'e2b',
    name: 'Gemma 4 E2B',
    sub: 'Router · classification · always resident',
    selectable: false,
    roles: ['router'],
  },
  {
    id: 'e4b',
    name: 'Gemma 4 E4B',
    sub: 'Fast chat · summaries · low-RAM default',
    selectable: true,
    roles: ['chat'],
  },
  {
    id: '12b',
    name: 'Gemma 4 12B',
    sub: 'Drafting · office JSON · code · diagrams',
    selectable: true,
    roles: ['chat', 'office_json', 'code'],
  },
  {
    id: 'embedding',
    name: 'EmbeddingGemma',
    sub: 'Semantic memory recall',
    selectable: false,
    roles: ['embedding'],
  },
];

function classify(filename: string): ModelTier | null {
  const f = filename.toLowerCase();
  if (f.includes('e2b')) return 'e2b';
  if (f.includes('e4b')) return 'e4b';
  if (f.includes('12b')) return '12b';
  if (f.includes('embeddinggemma')) return 'embedding';
  return null;
}

/** Discover *.gguf files in the configured models dir and classify by filename (PRD §0.1). */
export function scanModels(): ModelEntry[] {
  const found = new Map<ModelTier, { file: string; sizeGB: number }>();
  let files: string[] = [];
  try {
    files = readdirSync(config.models.dir).filter((f) => f.toLowerCase().endsWith('.gguf'));
  } catch {
    files = [];
  }
  for (const f of files) {
    const tier = classify(f);
    if (!tier || found.has(tier)) continue;
    const full = path.join(config.models.dir, f);
    found.set(tier, { file: f, sizeGB: Math.round((statSync(full).size / 1024 ** 3) * 10) / 10 });
  }
  return CATALOG.map((c) => {
    const hit = found.get(c.id);
    return {
      ...c,
      file: hit?.file ?? null,
      sizeGB: hit?.sizeGB ?? null,
      present: Boolean(hit),
      selectable: c.selectable && Boolean(hit),
    };
  });
}

export function modelPath(entry: ModelEntry): string | null {
  return entry.file ? path.join(config.models.dir, entry.file) : null;
}
