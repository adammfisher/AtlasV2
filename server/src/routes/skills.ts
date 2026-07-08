import { Router } from 'express';
import { skillEnabledStates, setSkillEnabled } from '../db/appdb.js';
import { SKILL_REGISTRY } from '../skills/registry.js';

export const skillsRouter = Router();

skillsRouter.get('/', (_req, res) => {
  skillEnabledStates()
    .then((states) =>
      res.json(
        SKILL_REGISTRY.map((s) => ({
          ...s,
          enabled: states[s.id] === undefined ? true : states[s.id] === 1,
        })),
      ),
    )
    .catch((err: Error) => res.status(502).json({ error: err.message }));
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
  setSkillEnabled(req.params.id, enabled)
    .then(() => res.json({ ok: true }))
    .catch((err: Error) => res.status(502).json({ error: err.message }));
});
