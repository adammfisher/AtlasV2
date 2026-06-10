import { Router } from 'express';
import { getDb } from '../db/db.js';
import { SKILL_REGISTRY } from '../skills/registry.js';

export const skillsRouter = Router();

skillsRouter.get('/', (_req, res) => {
  const states = new Map(
    (getDb().prepare('SELECT skill_id, enabled FROM skills_state').all() as Array<{
      skill_id: string;
      enabled: number;
    }>).map((r) => [r.skill_id, r.enabled === 1]),
  );
  res.json(SKILL_REGISTRY.map((s) => ({ ...s, enabled: states.get(s.id) ?? true })));
});

skillsRouter.patch('/:id', (req, res) => {
  const { enabled } = req.body as { enabled?: boolean };
  if (typeof enabled !== 'boolean') {
    res.status(400).json({ error: 'enabled (boolean) is required' });
    return;
  }
  if (!SKILL_REGISTRY.some((s) => s.id === req.params.id)) {
    res.status(404).json({ error: 'unknown skill' });
    return;
  }
  getDb()
    .prepare(
      'INSERT INTO skills_state (skill_id, enabled) VALUES (?, ?) ON CONFLICT(skill_id) DO UPDATE SET enabled = excluded.enabled',
    )
    .run(req.params.id, enabled ? 1 : 0);
  res.json({ ok: true });
});
