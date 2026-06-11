import { Router } from 'express';
import os from 'node:os';
import { scanModels } from '../llama/models.js';
import { llamaState, llamaRssGB, auxState, ensureAux } from '../llama/spawn.js';
import { getSetting, setSetting } from '../db/db.js';
import { config } from '../config.js';
import { execFile } from 'node:child_process';
import { connectBedrock, disconnectBedrock, bedrockSettings } from '../providers/bedrock.js';
import { fetchManifest, downloadModel, downloadStates } from '../llama/download.js';

function configCtx(): number {
  return config.llamaServer.ctx;
}

export const modelsRouter = Router();

function registry() {
  const llama = llamaState();
  return {
    models: scanModels(),
    selected: getSetting('selectedModel') ?? 'auto',
    bedrock: (() => {
      const b = bedrockSettings();
      return { connected: b.connected, region: b.region, profile: b.profile, modelId: b.modelId };
    })(),
    hardware: {
      ramGB: Math.round(os.totalmem() / 1024 ** 3),
      rssGB: llamaRssGB(),
      ctx: configCtx(),
      residentFile: llama.modelFile,
      residentTier: llama.status === 'ready' ? residentTier(llama.modelFile) : null,
      aux: auxState(),
    },
    downloads: downloadStates(),
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

modelsRouter.post('/refresh', (_req, res) => {
  ensureAux(); // a freshly dropped 12B/E2B GGUF brings the aux process up live
  res.json(registry());
});

modelsRouter.post('/select', (req, res) => {
  const { id } = req.body as { id?: string };
  if (id === 'bedrock') {
    if (!bedrockSettings().connected) {
      res.status(400).json({ error: 'Bedrock is not connected — add credentials first' });
      return;
    }
  } else if (id !== 'auto') {
    const entry = scanModels().find((m) => m.id === id);
    if (!entry || !entry.selectable) {
      res.status(400).json({ error: 'model not selectable' });
      return;
    }
  }
  setSetting('selectedModel', id as string);
  res.json({ ok: true, selected: id });
});

modelsRouter.post('/bedrock/connect', (req, res) => {
  const { region, profile } = req.body as { region?: string; profile?: string };
  connectBedrock(region || 'us-east-1', profile || 'default')
    .then((ids) => res.json({ ok: true, models: ids.length, ...bedrockSettings() }))
    .catch((err: Error) => res.status(400).json({ error: err.message }));
});

modelsRouter.post('/bedrock/disconnect', (_req, res) => {
  disconnectBedrock();
  const sel = getSetting('selectedModel');
  if (sel === 'bedrock') setSetting('selectedModel', 'auto');
  res.json({ ok: true });
});

modelsRouter.get('/manifest', (req, res) => {
  fetchManifest((req.query.url as string) || undefined)
    .then((models) => res.json(models))
    .catch((err: Error) => res.status(400).json({ error: err.message }));
});

modelsRouter.post('/download', (req, res) => {
  const { name, manifestUrl } = req.body as { name?: string; manifestUrl?: string };
  fetchManifest(manifestUrl)
    .then((models) => {
      const model = models.find((m) => m.name === name);
      if (!model) {
        res.status(404).json({ error: `model not in manifest: ${name}` });
        return;
      }
      void downloadModel(model); // progress lands in the registry downloads array
      res.json({ ok: true, name });
    })
    .catch((err: Error) => res.status(400).json({ error: err.message }));
});

/** Reveal the models folder in Finder (the place-a-GGUF flow). */
modelsRouter.post('/reveal', (_req, res) => {
  execFile('/usr/bin/open', [config.models.dir], (err) =>
    err ? res.status(500).json({ error: err.message }) : res.json({ ok: true }),
  );
});
