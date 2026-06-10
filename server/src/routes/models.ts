import { Router } from 'express';
import os from 'node:os';
import { scanModels } from '../llama/models.js';
import { llamaState, llamaRssGB } from '../llama/spawn.js';
import { getSetting, setSetting } from '../db/db.js';

export const modelsRouter = Router();

function registry() {
  const llama = llamaState();
  return {
    models: scanModels(),
    selected: getSetting('selectedModel') ?? 'auto',
    bedrock: { connected: false },
    hardware: {
      ramGB: Math.round(os.totalmem() / 1024 ** 3),
      rssGB: llamaRssGB(),
      ctx: 8192,
      residentFile: llama.modelFile,
      residentTier: llama.status === 'ready' ? residentTier(llama.modelFile) : null,
    },
  };
}

function residentTier(file: string | null): string | null {
  if (!file) return null;
  const f = file.toLowerCase();
  if (f.includes('e2b')) return 'e2b';
  if (f.includes('e4b')) return 'e4b';
  if (f.includes('12b')) return '12b';
  return null;
}

modelsRouter.get('/', (_req, res) => res.json(registry()));

modelsRouter.post('/refresh', (_req, res) => res.json(registry()));

modelsRouter.post('/select', (req, res) => {
  const { id } = req.body as { id?: string };
  if (id !== 'auto') {
    const entry = scanModels().find((m) => m.id === id);
    if (!entry || !entry.selectable) {
      res.status(400).json({ error: 'model not selectable' });
      return;
    }
  }
  setSetting('selectedModel', id as string);
  res.json({ ok: true, selected: id });
});

modelsRouter.post('/bedrock/connect', (_req, res) => {
  res
    .status(501)
    .json({ error: 'Bedrock connect ships in Stage 5 — the provider layer is not built yet.' });
});
