import express from 'express';
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { config, repoRoot } from './config.js';
import { log } from './log.js';
import { getDb } from './db/db.js';
import { seedIfNeeded, backfillSeedArtifactFiles } from './db/seed.js';
import { stopLlama, llamaState } from './llama/spawn.js';
import { ensureBedrockConnected } from './providers/bedrock.js';
import { scanModels } from './llama/models.js';
import { projectsRouter } from './routes/projects.js';
import { settingsRouter } from './routes/settings.js';
import { conversationsRouter } from './routes/conversations.js';
import { chatRouter } from './routes/chat.js';
import { skillsRouter } from './routes/skills.js';
import { pluginsRouter } from './routes/plugins.js';
import { modelsRouter } from './routes/models.js';
import { artifactsRouter } from './routes/artifacts.js';
import { ensureBundledInstalled, probeKnowledgeCore } from './mcp/manager.js';
import { uploadsRouter } from './routes/uploads.js';

// 1. App data directories (models/ already exists and is never touched)
for (const dir of ['data', 'artifacts', 'credentials', 'logs', 'uploads']) {
  mkdirSync(path.join(config.dataDir, dir), { recursive: true });
}

// 2. Database + first-boot fixtures
getDb();
seedIfNeeded();
backfillSeedArtifactFiles();
ensureBundledInstalled();
void probeKnowledgeCore();

// 3. Bedrock is the inference backend — auto-connect (non-fatal on failure).
// The local llama sidecar is retired; nothing is spawned here anymore.
void ensureBedrockConnected();

// 4. HTTP API
const app = express();
app.use(express.json({ limit: '2mb' }));

// portable folder: serve the built client when it exists (dev uses Vite instead)
const clientDist = path.join(repoRoot, 'client', 'dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
}

app.get('/api/health', (_req, res) => {
  const llama = llamaState();
  res.json({
    ok: llama.status === 'ready',
    llama: {
      status: llama.status,
      modelFile: llama.modelFile,
      port: llama.port,
      pid: llama.pid,
      error: llama.error,
    },
    llamaVersion: llama.version,
    models: scanModels().map((m) => ({ id: m.id, file: m.file, present: m.present })),
    dirs: { dataDir: config.dataDir, modelsDir: config.models.dir },
    appVersion: '0.1.0',
  });
});

app.use('/api/projects', projectsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/conversations', chatRouter); // POST /:id/messages (SSE) — registered first
app.use('/api/conversations', conversationsRouter);
app.use('/api/skills', skillsRouter);
app.use('/api/plugins', pluginsRouter);
app.use('/api/models', modelsRouter);
app.use('/api/uploads', uploadsRouter);
app.use('/api/artifacts', artifactsRouter);

if (existsSync(clientDist)) {
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

const server = app.listen(config.server.port, '127.0.0.1', () => {
  log(`Atlas server listening on http://127.0.0.1:${config.server.port}`);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    stopLlama();
    server.close();
    process.exit(0);
  });
}
