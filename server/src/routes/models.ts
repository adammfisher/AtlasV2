import { Router } from 'express';
import os from 'node:os';
import { scanModels } from '../llama/models.js';
import { llamaState, llamaRssGB, auxState, ensureAux } from '../llama/spawn.js';
import { setSetting } from '../db/db.js';
import { config } from '../config.js';
import { execFile } from 'node:child_process';
import {
  connectBedrock,
  disconnectBedrock,
  bedrockSettings,
  modelCatalog,
  probeSonnet,
  activeModelKey,
  MODEL_KEYS,
} from '../providers/bedrock.js';
import { fetchManifest, downloadModel, downloadStates } from '../llama/download.js';

function configCtx(): number {
  return config.llamaServer.ctx;
}

export const modelsRouter = Router();

function registry() {
  const llama = llamaState();
  const b = bedrockSettings();
  return {
    // Config-driven catalog (models.config.json). `available` gates selection:
    // bedrock models need the connection; api models need their key env set.
    bedrockModels: MODEL_KEYS.map((key) => {
      const m = modelCatalog()[key]!;
      return { id: key, name: m.name, sub: m.sub, provider: m.provider, available: m.available, vision: m.vision };
    }),
    models: scanModels(),
    selected: activeModelKey(),
    bedrock: { connected: b.connected, region: b.region, profile: b.profile, modelId: b.modelId },
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
  void probeSonnet(); // re-check Sonnet 5 activation; registry reflects it next poll
  res.json(registry());
});

modelsRouter.post('/select', (req, res) => {
  const { id } = req.body as { id?: string };
  if (!id || !MODEL_KEYS.includes(id)) {
    res.status(400).json({ error: 'unknown model — choose Claude Haiku 4.5 or Claude Sonnet 5' });
    return;
  }
  if (!bedrockSettings().connected) {
    res.status(400).json({ error: 'Bedrock is not connected — connect AWS credentials first' });
    return;
  }
  setSetting('selectedModel', id);
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
  // selectedModel (haiku|sonnet) is preserved so reconnecting restores the pick.
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
