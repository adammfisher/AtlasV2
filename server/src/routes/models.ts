import { Router } from 'express';
import os from 'node:os';
import { scanModels } from '../llama/models.js';
import { llamaState } from '../llama/spawn.js';
import { getSetting, setSetting } from '../db/db.js';

export const modelsRouter = Router();

function registry() {
  return {
    models: scanModels(),
    selected: getSetting('selectedModel') ?? 'e4b',
    bedrock: { connected: false },
    hardware: {
      ramGB: Math.round(os.totalmem() / 1024 ** 3),
      ctx: 8192,
      residentFile: llamaState().modelFile,
    },
  };
}

modelsRouter.get('/', (_req, res) => res.json(registry()));

modelsRouter.post('/refresh', (_req, res) => res.json(registry()));

modelsRouter.post('/select', (req, res) => {
  const { id } = req.body as { id?: string };
  const entry = scanModels().find((m) => m.id === id);
  if (!entry || !entry.selectable) {
    res.status(400).json({ error: 'model not selectable' });
    return;
  }
  setSetting('selectedModel', entry.id);
  res.json({ ok: true, selected: entry.id });
});

modelsRouter.post('/bedrock/connect', (_req, res) => {
  res
    .status(501)
    .json({ error: 'Bedrock connect ships in Stage 5 — the provider layer is not built yet.' });
});
