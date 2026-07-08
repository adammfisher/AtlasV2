import { Router } from 'express';
import { getSetting, setSetting } from '../db/db.js';

const EXPOSED = ['activeProjectId', 'selectedModel', 'userName'] as const;

export const settingsRouter = Router();

settingsRouter.get('/', (_req, res) => {
  const out: Record<string, string> = {};
  for (const key of EXPOSED) {
    const value = getSetting(key);
    if (value !== null) out[key] = value;
  }
  res.json(out);
});

settingsRouter.patch('/', (req, res) => {
  const body = req.body as Record<string, unknown>;
  for (const key of EXPOSED) {
    const value = body[key];
    if (typeof value === 'string') setSetting(key, value);
  }
  res.json({ ok: true });
});
