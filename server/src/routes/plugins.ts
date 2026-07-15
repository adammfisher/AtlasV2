import { Router } from 'express';
import { listInstalls, putInstall, getSetting } from '../db/appdb.js';
import {
  directory,
  installConnector,
  configureInstall,
  restartInstall,
  removeInstall,
  addCustom,
  probeKnowledgeCore,
  knowledgeCoreAvailable,
  listToolsFor,
  type InstallRow,
} from '../mcp/manager.js';

interface Connector {
  id: string;
  status: string;
  [key: string]: unknown;
}

function loadDirectory(): Connector[] {
  return directory() as unknown as Connector[];
}

export const pluginsRouter = Router();

/** Directory manifest ⨯ install state ⨯ per-project enablement. */
pluginsRouter.get('/directory', (_req, res) => {
  void (async () => {
    const installs = new Map(
      ((await listInstalls()) as InstallRow[]).map((r) => [r.connector_id, r]),
    );
    void probeKnowledgeCore(); // refresh in the background; current value applies now
    const entries = loadDirectory().map((c) => {
      const install = installs.get(c.id);
      // bundled connectors stay 'bundled'; anything else with an install row is 'installed'
      let status =
        c.status === 'bundled' ? 'bundled' : install ? (install.status === 'installed' ? 'installed' : install.status) : c.status;
      // a manifest 'planned' outranks any stale install row — there is no
      // server to be installed (P1 honesty)
      if (c.status === 'planned') status = 'planned';
      if (c.id === 'knowledge-core' && !install && knowledgeCoreAvailable()) status = 'available';
      // honesty (P1): stdio/loopback connectors cannot run in the Lambda
      // deployment — surface that instead of a dead Connect button
      const cloud = Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME);
      const availability = (c as { availability?: string }).availability ?? null;
      if (cloud && availability === 'local-only') status = 'unavailable';
      return {
        ...c,
        status,
        availability,
        installId: install?.id ?? null,
        enabledProjects: install ? (JSON.parse(install.enabled_projects) as string[]) : [],
        lastError: install?.last_error ?? null,
        hasCredentials: Boolean(install?.credentials_ref),
        // non-secret settings only (host URLs and the like) — tokens live in the
        // encrypted store and are never returned by any API
        configValues: install?.config ? (JSON.parse(install.config) as Record<string, string>) : {},
      };
    });
    // custom installs are not in the directory manifest — surface them too
    for (const row of installs.values()) {
      if (!loadDirectory().some((c) => c.id === row.connector_id)) {
        const custom = row.custom_config;
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
          lastError: row.last_error ?? null,
          hasCredentials: false,
        } as unknown as (typeof entries)[number]);
      }
    }
    res.json(entries);
  })().catch((err: Error) => res.status(502).json({ error: err.message }));
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
  void (async () => {
    const install = ((await listInstalls()) as InstallRow[]).find((r) => r.id === req.params.id);
    if (!install) {
      res.status(404).json({ error: 'install not found' });
      return;
    }
    const current = new Set(JSON.parse(install.enabled_projects) as string[]);
    if (enabled) current.add(projectId);
    else current.delete(projectId);
    install.enabled_projects = JSON.stringify([...current]);
    await putInstall(install);
    res.json({ ok: true, enabledProjects: [...current] });
  })().catch((err: Error) => res.status(502).json({ error: err.message }));
});

pluginsRouter.post('/installs', (req, res) => {
  const { connectorId, projectId, credential, config } = req.body as {
    connectorId?: string;
    projectId?: string;
    credential?: string;
    config?: Record<string, string>;
  };
  if (!connectorId) {
    res.status(400).json({ error: 'connectorId is required' });
    return;
  }
  installConnector(connectorId, projectId || 'p1', { credential, config })
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

/**
 * Save an install's non-secret config and/or its token, then reconnect so the
 * reported status reflects the new settings. Values are stored encrypted and
 * never read back — the response only says whether a credential exists.
 */
pluginsRouter.put('/installs/:id/settings', (req, res) => {
  const { config, credential, projectId } = req.body as {
    config?: Record<string, string>;
    credential?: string | null;
    projectId?: string;
  };
  configureInstall(req.params.id, { config, credential }, projectId || 'p1')
    .then((row) =>
      res.json({
        ok: true,
        status: row.status,
        lastError: row.last_error,
        hasCredentials: Boolean(row.credentials_ref),
      }),
    )
    .catch((err: Error) =>
      res.status(err.message === 'install not found' ? 404 : 502).json({ error: err.message }),
    );
});

/** Legacy credential-only alias for the settings endpoint. */
pluginsRouter.put('/installs/:id/credentials', (req, res) => {
  const { value, projectId } = req.body as { value?: string; projectId?: string };
  configureInstall(req.params.id, { credential: value ?? null }, projectId || 'p1')
    .then((row) =>
      res.json({ ok: true, hasCredentials: Boolean(row.credentials_ref), status: row.status }),
    )
    .catch((err: Error) =>
      res.status(err.message === 'install not found' ? 404 : 502).json({ error: err.message }),
    );
});

pluginsRouter.post('/custom', (req, res) => {
  const { name, transport, command, args, url, projectId, credential, credentialKey } = req.body as {
    name?: string;
    transport?: string;
    command?: string;
    args?: string[];
    url?: string;
    projectId?: string;
    credential?: string;
    credentialKey?: string;
  };
  if (!name || !transport) {
    res.status(400).json({ error: 'name and transport are required' });
    return;
  }
  // default to the ACTIVE project — 'p1' left freshly-added servers enabled
  // for a project nobody was in (found adding deepwiki to the deployed app)
  addCustom(
    { name, transport, command, args, url, credential, credentialKey },
    projectId || getSetting('activeProjectId') || 'p1',
  )
    .then((row) => res.json({ installId: row.id, status: row.status, lastError: row.last_error }))
    .catch((err: Error) => res.status(400).json({ error: err.message }));
});
