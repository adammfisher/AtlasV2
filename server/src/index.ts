import express from 'express';
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { config, repoRoot } from './config.js';
import { log } from './log.js';
import { loadSettings, refreshSettings } from './db/appdb.js';
import { seedIfNeeded } from './db/seed.js';
import { ensureBedrockConnected, bedrockSettings } from './providers/bedrock.js';
import { scheduleConsolidation, startExtractionQueue } from './memory/engine.js';
import { projectsRouter } from './routes/projects.js';
import { settingsRouter } from './routes/settings.js';
import { conversationsRouter } from './routes/conversations.js';
import { chatRouter } from './routes/chat.js';
import { skillsRouter } from './routes/skills.js';
import { authRouter } from './routes/auth.js';
import { pluginsRouter } from './routes/plugins.js';
import { modelsRouter } from './routes/models.js';
import { artifactsRouter } from './routes/artifacts.js';
import { ensureBundledInstalled, probeKnowledgeCore } from './mcp/manager.js';
import { uploadsRouter } from './routes/uploads.js';
import { accounts, runAsAccount } from './lib/account.js';

const IS_LAMBDA = !!process.env.AWS_LAMBDA_FUNCTION_NAME;

// 1. Scratch directories (build steps + upload staging; durable copies live in S3)
for (const dir of ['artifacts', 'logs', 'uploads', 'knowledge']) {
  mkdirSync(path.join(config.dataDir, dir), { recursive: true });
}

// 2. Data layer (DynamoDB) — settings cache, first-boot seed, bundled plugins
await loadSettings();
// FX-9: seedIfNeeded/ensureBundledInstalled partition by the CURRENT account
// context (AsyncLocalStorage), which is unset here — they only ever ran as
// the primary account. Every other configured account (users.config.json)
// got zero starter projects and, critically, no bundled plugin installs —
// the memory connector included, so remember/forget/recall were silently
// non-functional for every non-primary user, not just the test harness.
for (const acct of accounts()) {
  await runAsAccount(acct.username, async () => {
    await seedIfNeeded();
    await ensureBundledInstalled();
  });
}
void probeKnowledgeCore();

// 3. Bedrock auto-connect (non-fatal on failure)
void ensureBedrockConnected();

// 3b. memory lifecycle. In Lambda, EventBridge hits /api/internal/sweep and
// /api/internal/consolidate instead of in-process timers (nothing to keep warm).
if (!IS_LAMBDA) {
  startExtractionQueue();
  scheduleConsolidation();
  setInterval(() => void refreshSettings(), 30_000); // cross-process settings drift
}

// 4. HTTP API
const app = express();

// ---- accounts: bind every request to its workspace (users.config.json) ----
// Open: login, health, internal sweeps (EventBridge), static assets. Everything
// else under /api requires a token; the ALS context partitions the data layer.
const loadedAccounts = new Set<string>();
app.use((req, res, next) => {
  const open =
    !req.path.startsWith('/api') ||
    req.path === '/api/auth/login' ||
    req.path === '/api/auth/logout' ||
    req.path === '/api/health' ||
    req.path.startsWith('/api/internal/');
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  const cookie = /(?:^|;\s*)axiom_token=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
  // next() runs the whole downstream chain INSIDE this promise, so a synchronous
  // throw in any route rejects it too. Answering every rejection with 401 made
  // unrelated bugs look like auth failures — and the client ends the session on
  // any 401, so a transient route error silently signed the user out mid-work.
  // This flag marks the point where the auth decision is already made: anything
  // after it is a downstream fault and must NOT be reported as an auth problem.
  let authSettled = false;
  void (async () => {
    const { verifyToken, runAsAccount } = await import('./lib/account.js');
    const user = bearer || cookie ? await verifyToken(bearer || cookie || '') : null;
    if (!user && !open) {
      res.status(401).json({ error: 'not signed in', code: 'unauthenticated' });
      return;
    }
    authSettled = true;
    const run = (): void => {
      if (user && !loadedAccounts.has(user)) {
        loadedAccounts.add(user);
        void refreshSettings(); // lazy first load of this account's settings cache
      }
      next();
    };
    if (user) runAsAccount(user, run);
    else run();
  })().catch((err: unknown) => {
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    // headers are already gone once an SSE stream has started — the response is
    // the stream's to finish; all we can still do is leave a trace
    if (authSettled) {
      log(`error in ${req.method} ${req.path}: ${detail}`);
      if (!res.headersSent) res.status(500).json({ error: 'internal error' });
      return;
    }
    log(`auth check failed for ${req.method} ${req.path}: ${detail}`);
    if (!res.headersSent) res.status(401).json({ error: 'auth failed', code: 'unauthenticated' });
  });
});

// uploads carry base64 files (own 40mb parser) — mount BEFORE the global 2mb
// json limit or any file over ~1.4MB is rejected before reaching the route
app.use('/api/uploads', uploadsRouter);
app.use(express.json({ limit: '2mb' }));

// Lambda: settings can change from another instance — refresh per request
if (IS_LAMBDA) {
  app.use((_req, _res, next) => {
    void refreshSettings().finally(next);
  });
}

// portable folder / Lambda: serve the built client when present (dev uses Vite)
const clientDist = path.join(repoRoot, 'client', 'dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: bedrockSettings().connected,
    backend: 'bedrock',
    lambda: IS_LAMBDA,
    dirs: { dataDir: config.dataDir },
    appVersion: '2.0.0',
  });
});

// EventBridge-invoked internal endpoints (Lambda replaces in-process timers)
app.post('/api/internal/sweep', (req, res) => {
  import('./memory/engine.js')
    .then(({ sweepAllAccounts }) => sweepAllAccounts())
    .then((n) => res.json({ ok: true, processed: n }))
    .catch((err: Error) => res.status(500).json({ error: err.message }));
});
app.post('/api/internal/consolidate', (req, res) => {
  import('./memory/engine.js')
    .then(({ consolidateStaleScopes }) => consolidateStaleScopes())
    .then(() => res.json({ ok: true }))
    .catch((err: Error) => res.status(500).json({ error: err.message }));
});

app.use('/api/auth', authRouter);
app.use('/api/projects', projectsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/conversations', chatRouter); // POST /:id/messages (SSE) — registered first
app.use('/api/conversations', conversationsRouter);
app.use('/api/skills', skillsRouter);
app.use('/api/plugins', pluginsRouter);
app.use('/api/models', modelsRouter);
app.use('/api/artifacts', artifactsRouter);

if (existsSync(clientDist)) {
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

const host = IS_LAMBDA ? '0.0.0.0' : '127.0.0.1'; // LWA proxies from inside the container
const server = app.listen(Number(process.env.PORT ?? config.server.port), host, () => {
  log(`Axiom server listening on http://${host}:${process.env.PORT ?? config.server.port}`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    server.close();
    process.exit(0);
  });
}
