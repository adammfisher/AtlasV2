import { Router } from 'express';
import { getDb } from '../db/db.js';
import {
  directory,
  installConnector,
  restartInstall,
  removeInstall,
  addCustom,
  probeKnowledgeCore,
  knowledgeCoreAvailable,
  listToolsFor,
} from '../mcp/manager.js';
import { storeCredential, deleteCredential } from '../mcp/credentials.js';

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
  return directory() as unknown as Connector[];
}

export const pluginsRouter = Router();

/** Directory manifest ⨯ install state ⨯ per-project enablement. */
pluginsRouter.get('/directory', (_req, res) => {
  const installs = new Map(
    (getDb().prepare('SELECT * FROM plugin_installs').all() as InstallRow[]).map((r) => [
      r.connector_id,
      r,
    ]),
  );
  void probeKnowledgeCore(); // refresh in the background; current value applies now
  const entries = loadDirectory().map((c) => {
    const install = installs.get(c.id);
    // bundled connectors stay 'bundled'; anything else with an install row is 'installed'
    let status =
      c.status === 'bundled' ? 'bundled' : install ? (install.status === 'installed' ? 'installed' : install.status) : c.status;
    if (c.id === 'knowledge-core' && !install && knowledgeCoreAvailable()) status = 'available';
    return {
      ...c,
      status,
      installId: install?.id ?? null,
      enabledProjects: install ? (JSON.parse(install.enabled_projects) as string[]) : [],
      lastError: install?.last_error ?? null,
      hasCredentials: Boolean((install as { credentials_ref?: string | null } | undefined)?.credentials_ref),
    };
  });
  // custom installs are not in the directory manifest — surface them too
  for (const row of installs.values()) {
    if (!loadDirectory().some((c) => c.id === row.connector_id)) {
      const custom = (row as unknown as { custom_config: string | null }).custom_config;
      const cfg = custom ? (JSON.parse(custom) as Record<string, unknown>) : {};
      entries.push({
        id: row.connector_id,
        name: (cfg.name as string) ?? row.connector_id,
        vendor: 'Custom',
        description: 'Custom MCP server added from this workspace.',
        icon: 'puzzle',
        colorToken: 'amber',
        transport: (cfg.transport as string) ?? 'stdio',
        endpoint: (cfg.url as string) ?? (cfg.launch as { command?: string } | undefined)?.command ?? 'stdio',
        runtime: 'custom',
        tools: [],
        creds: [],
        projectScopable: true,
        category: 'custom',
        status: row.status,
        installId: row.id,
        enabledProjects: JSON.parse(row.enabled_projects) as string[],
        lastError: row.last_error,
        hasCredentials: false,
      } as unknown as (typeof entries)[number]);
    }
  }
  res.json(entries);
});

/** Live tool list for the detail panel (replaces toolsPreview after connect). */
pluginsRouter.get('/installs/:id/tools', (req, res) => {
  const projectId = (req.query.projectId as string) || 'p1';
  listToolsFor(req.params.id, projectId)
    .then((tools) => res.json(tools.map((t) => ({ name: t.name, description: t.description }))))
    .catch((err: Error) => res.status(502).json({ error: err.message }));
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

pluginsRouter.post('/installs', (req, res) => {
  const { connectorId, projectId } = req.body as { connectorId?: string; projectId?: string };
  if (!connectorId) {
    res.status(400).json({ error: 'connectorId is required' });
    return;
  }
  installConnector(connectorId, projectId || 'p1')
    .then((row) =>
      res.json({
        installId: row.id,
        status: row.status,
        lastError: row.last_error,
        enabledProjects: JSON.parse(row.enabled_projects) as string[],
      }),
    )
    .catch((err: Error) => res.status(400).json({ error: err.message }));
});

pluginsRouter.delete('/installs/:id', (req, res) => {
  removeInstall(req.params.id)
    .then(() => res.json({ ok: true }))
    .catch((err: Error) => res.status(400).json({ error: err.message }));
});

pluginsRouter.post('/installs/:id/restart', (req, res) => {
  const projectId = ((req.body ?? {}) as { projectId?: string }).projectId || 'p1';
  restartInstall(req.params.id, projectId)
    .then((row) => res.json({ status: row.status, lastError: row.last_error }))
    .catch((err: Error) => res.status(400).json({ error: err.message }));
});

pluginsRouter.put('/installs/:id/credentials', (req, res) => {
  const { value } = req.body as { value?: string };
  const db = getDb();
  const install = db.prepare('SELECT * FROM plugin_installs WHERE id = ?').get(req.params.id) as
    | (InstallRow & { credentials_ref: string | null })
    | undefined;
  if (!install) {
    res.status(404).json({ error: 'install not found' });
    return;
  }
  if (!value) {
    if (install.credentials_ref) deleteCredential(install.credentials_ref);
    db.prepare('UPDATE plugin_installs SET credentials_ref = NULL WHERE id = ?').run(install.id);
    res.json({ ok: true, hasCredentials: false });
    return;
  }
  const ref = storeCredential(value, install.credentials_ref ?? undefined);
  db.prepare('UPDATE plugin_installs SET credentials_ref = ? WHERE id = ?').run(ref, install.id);
  res.json({ ok: true, hasCredentials: true });
});

pluginsRouter.post('/custom', (req, res) => {
  const { name, transport, command, args, url, projectId } = req.body as {
    name?: string;
    transport?: string;
    command?: string;
    args?: string[];
    url?: string;
    projectId?: string;
  };
  if (!name || !transport) {
    res.status(400).json({ error: 'name and transport are required' });
    return;
  }
  addCustom({ name, transport, command, args, url }, projectId || 'p1')
    .then((row) => res.json({ installId: row.id, status: row.status, lastError: row.last_error }))
    .catch((err: Error) => res.status(400).json({ error: err.message }));
});
