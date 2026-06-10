import { Router } from 'express';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getDb } from '../db/db.js';
import { repoRoot } from '../config.js';

interface Connector {
  id: string;
  status: string;
  [key: string]: unknown;
}

interface InstallRow {
  id: string;
  connector_id: string;
  status: string;
  enabled_projects: string;
  last_error: string | null;
}

function loadDirectory(): Connector[] {
  const raw = readFileSync(path.join(repoRoot, 'directory', 'connectors.json'), 'utf8');
  return (JSON.parse(raw) as { connectors: Connector[] }).connectors;
}

export const pluginsRouter = Router();

/** Directory manifest ⨯ install state ⨯ per-project enablement (PRD §3). */
pluginsRouter.get('/directory', (_req, res) => {
  const installs = new Map(
    (getDb().prepare('SELECT * FROM plugin_installs').all() as InstallRow[]).map((r) => [
      r.connector_id,
      r,
    ]),
  );
  const entries = loadDirectory().map((c) => {
    const install = installs.get(c.id);
    const status = install
      ? install.status === 'installed'
        ? 'connected'
        : install.status
      : c.status === 'bundled'
        ? 'available'
        : c.status;
    return {
      ...c,
      status,
      installId: install?.id ?? null,
      enabledProjects: install ? (JSON.parse(install.enabled_projects) as string[]) : [],
      lastError: install?.last_error ?? null,
    };
  });
  res.json(entries);
});

pluginsRouter.post('/installs/:id/projects', (req, res) => {
  const { projectId, enabled } = req.body as { projectId?: string; enabled?: boolean };
  if (!projectId || typeof enabled !== 'boolean') {
    res.status(400).json({ error: 'projectId and enabled are required' });
    return;
  }
  const db = getDb();
  const install = db.prepare('SELECT * FROM plugin_installs WHERE id = ?').get(req.params.id) as
    | InstallRow
    | undefined;
  if (!install) {
    res.status(404).json({ error: 'install not found' });
    return;
  }
  const current = new Set(JSON.parse(install.enabled_projects) as string[]);
  if (enabled) current.add(projectId);
  else current.delete(projectId);
  db.prepare('UPDATE plugin_installs SET enabled_projects = ? WHERE id = ?').run(
    JSON.stringify([...current]),
    install.id,
  );
  res.json({ ok: true, enabledProjects: [...current] });
});

const stage4 = (feature: string) => ({
  error: `${feature} ships in Stage 4 — the MCP lifecycle layer is not built yet.`,
});

pluginsRouter.post('/installs', (_req, res) => res.status(501).json(stage4('Plugin install')));
pluginsRouter.delete('/installs/:id', (_req, res) => res.status(501).json(stage4('Plugin removal')));
pluginsRouter.post('/installs/:id/restart', (_req, res) =>
  res.status(501).json(stage4('Plugin restart')),
);
pluginsRouter.put('/installs/:id/credentials', (_req, res) =>
  res.status(501).json(stage4('Credential storage')),
);
pluginsRouter.post('/custom', (_req, res) => res.status(501).json(stage4('Custom servers')));
