import { Router } from 'express';
import { getDb, setSetting } from '../db/db.js';

const EXPOSED = ['activeProjectId', 'selectedModel', 'userName'] as const;

export const settingsRouter = Router();

settingsRouter.get('/', (_req, res) => {
  const rows = getDb().prepare('SELECT key, value FROM settings').all() as Array<{
    key: string;
    value: string;
  }>;
  const out: Record<string, string> = {};
  for (const row of rows) {
    if ((EXPOSED as readonly string[]).includes(row.key)) out[row.key] = row.value;
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
