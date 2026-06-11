import { spawn, spawnSync, execFileSync, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import { config } from '../config.js';
import { log, logTo } from '../log.js';
import { scanModels, modelPath, type ModelEntry } from './models.js';

export type LlamaStatus = 'starting' | 'ready' | 'restarting' | 'error' | 'stopped';

interface LlamaState {
  status: LlamaStatus;
  modelFile: string | null;
  port: number;
  pid: number | null;
  version: string | null;
  error: string | null;
}

const state: LlamaState = {
  status: 'stopped',
  modelFile: null,
  port: config.llamaServer.chatPort,
  pid: null,
  version: null,
  error: null,
};

let child: ChildProcess | null = null;
let restartCount = 0;
let stopping = false;

/* ---------- §8 second-process topology ----------
 * E2B + larger model present → router pinned to its own process.
 * 12B present while a smaller chat model is selected → office runs on a 12B
 * process (the drop-a-12B gate: office routes to it, chat stays selected).
 * One aux process in v1; 12B-office wins when both would apply. */
export const AUX_PORT = 8082;

interface AuxState {
  status: 'stopped' | 'starting' | 'ready' | 'error';
  tier: 'e2b' | '12b' | null;
  pid: number | null;
}

const aux: AuxState = { status: 'stopped', tier: null, pid: null };
let auxChild: ChildProcess | null = null;

function pickAuxModel(selectedTier: string): ModelEntry | null {
  if (Math.round(os.totalmem() / 1024 ** 3) < 16) return null;
  const models = scanModels();
  const tierRank: Record<string, number> = { e2b: 0, e4b: 1, '12b': 2 };
  const twelve = models.find((m) => m.id === '12b' && m.present);
  if (twelve && (tierRank[selectedTier] ?? 1) < 2) return twelve;
  const e2b = models.find((m) => m.id === 'e2b' && m.present);
  if (e2b && selectedTier !== 'e2b') return e2b;
  return null;
}

async function startAux(selectedTier: string): Promise<void> {
  const entry = pickAuxModel(selectedTier);
  if (!entry) return;
  const file = modelPath(entry);
  if (!file) return;
  const binary = resolveBinary();
  aux.status = 'starting';
  aux.tier = entry.id as 'e2b' | '12b';
  const args = [
    '-m', file,
    '--host', '127.0.0.1',
    '--port', String(AUX_PORT),
    '-c', String(config.llamaServer.ctx),
    '-np', '1',
    ...config.llamaServer.extraFlags,
  ];
  log(`spawning aux llama-server (${entry.file}, ${aux.tier}) on :${AUX_PORT}`);
  auxChild = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  aux.pid = auxChild.pid ?? null;
  auxChild.stdout?.on('data', (d: Buffer) => logTo('llama', `[aux] ${d.toString().trimEnd()}`));
  auxChild.stderr?.on('data', (d: Buffer) => logTo('llama', `[aux] ${d.toString().trimEnd()}`));
  auxChild.on('exit', (code) => {
    aux.pid = null;
    if (!stopping) log(`aux llama-server exited (code=${code}) — aux features fall back to the chat process`);
    aux.status = 'stopped';
    aux.tier = null;
  });
  try {
    const deadline = Date.now() + 180_000;
    for (;;) {
      if (Date.now() > deadline) throw new Error('aux llama-server health timeout');
      try {
        const res = await fetch(`http://127.0.0.1:${AUX_PORT}/health`);
        if (res.ok) break;
      } catch {
        // not up yet
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    aux.status = 'ready';
    log(`aux llama-server ready (${entry.file})`);
  } catch (err) {
    aux.status = 'error';
    log(`aux llama-server failed: ${err instanceof Error ? err.message : err}`);
  }
}

/** Re-evaluate the aux topology (called by /models/refresh after a drop-in). */
export function ensureAux(): void {
  if (aux.status !== 'stopped' || state.status !== 'ready') return;
  const resident = state.modelFile?.toLowerCase() ?? '';
  const tier = resident.includes('12b') ? '12b' : resident.includes('e2b') ? 'e2b' : 'e4b';
  void startAux(tier);
}

export function auxState(): AuxState {
  return { ...aux };
}

/** Port for a task class — aux process when it serves that tier, else the chat process. */
export function portForTask(task: 'router' | 'office' | 'chat'): number {
  if (task === 'router' && aux.status === 'ready' && aux.tier === 'e2b') return AUX_PORT;
  if (task === 'office' && aux.status === 'ready' && aux.tier === '12b') return AUX_PORT;
  return config.llamaServer.chatPort;
}

function resolveBinary(): string {
  if (config.llamaServer.binary !== 'auto') return config.llamaServer.binary;
  try {
    return execFileSync('which', ['llama-server'], { encoding: 'utf8' }).trim();
  } catch {
    throw new Error('llama-server not found on PATH — run `brew install llama.cpp`');
  }
}

function readVersion(binary: string): string {
  // llama-server prints --version to stderr with exit 0
  const out = spawnSync(binary, ['--version'], { encoding: 'utf8' });
  const text = `${out.stdout ?? ''}\n${out.stderr ?? ''}`;
  const line = text.split('\n').find((l) => l.startsWith('version:'));
  return line?.trim() ?? 'unknown';
}

/**
 * Pick the chat model to serve: the selected one if present, else E4B (the
 * guaranteed file). 'auto' routes by task from Stage 3; with E4B alone it
 * resolves to E4B.
 */
export function pickChatModel(selected: string | null): ModelEntry | null {
  const models = scanModels();
  const want =
    selected && selected !== 'auto'
      ? models.find((m) => m.id === selected && m.present && m.selectable)
      : undefined;
  return want ?? models.find((m) => m.id === 'e4b' && m.present) ?? null;
}

/** Resident set size of the llama-server process, in GB (0 when not running). */
export function llamaRssGB(): number {
  if (!state.pid) return 0;
  try {
    const out = execFileSync('ps', ['-o', 'rss=', '-p', String(state.pid)], { encoding: 'utf8' });
    return Math.round((parseInt(out.trim(), 10) / 1024 / 1024) * 10) / 10;
  } catch {
    return 0;
  }
}

/**
 * Warm the fresh llama-server process with a chat-shaped request so first-message
 * latency excludes weight paging and graph setup. Thinking is disabled to match
 * real chat requests.
 */
async function warmup(): Promise<void> {
  try {
    const filler = Array.from({ length: 110 }, (_, i) => `token${i}`).join(' ');
    const res = await fetch(`http://127.0.0.1:${config.llamaServer.chatPort}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: `You are a warmup probe. Ignore this: ${filler}` },
          { role: 'user', content: 'Reply with the single word: ok' },
        ],
        max_tokens: 4,
        stream: true,
        temperature: 1.0,
        top_p: 0.95,
        top_k: 64,
        chat_template_kwargs: { enable_thinking: false },
      }),
    });
    await res.text();
    log('llama-server warmed up');
  } catch {
    // warmup is best-effort
  }
}

async function waitHealthy(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (state.status === 'error') throw new Error(state.error ?? 'llama-server exited');
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('llama-server did not become healthy in time');
}

export async function startLlama(selectedModel: string | null): Promise<void> {
  const entry = pickChatModel(selectedModel);
  if (!entry) {
    state.status = 'error';
    state.error = `No chat-capable GGUF found in ${config.models.dir}`;
    log(state.error);
    return;
  }
  const binary = resolveBinary();
  if (!state.version) state.version = readVersion(binary);
  const file = modelPath(entry);
  if (!file) return;

  state.status = restartCount > 0 ? 'restarting' : 'starting';
  state.modelFile = entry.file;
  state.error = null;

  const args = [
    '-m', file,
    '--host', '127.0.0.1',
    '--port', String(config.llamaServer.chatPort),
    '-c', String(config.llamaServer.ctx),
    '-np', String(config.llamaServer.parallel),
    ...config.llamaServer.extraFlags,
  ];
  log(`spawning llama-server (${entry.file}) on :${config.llamaServer.chatPort}`);
  child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  state.pid = child.pid ?? null;
  child.stdout?.on('data', (d: Buffer) => logTo('llama', d.toString().trimEnd()));
  child.stderr?.on('data', (d: Buffer) => logTo('llama', d.toString().trimEnd()));

  child.on('exit', (code, signal) => {
    state.pid = null;
    if (stopping) {
      state.status = 'stopped';
      return;
    }
    log(`llama-server exited (code=${code} signal=${signal})`);
    if (restartCount < 1) {
      restartCount += 1;
      state.status = 'restarting';
      void startLlama(selectedModel).then(() => {
        // successful restart resets the budget so a later crash can recover once too
        if (state.status === 'ready') restartCount = 0;
      });
    } else {
      state.status = 'error';
      state.error = `llama-server crashed twice (last exit code=${code}); check ${config.dataDir}/logs/llama.log`;
    }
  });

  try {
    await waitHealthy(config.llamaServer.chatPort, 120_000);
    await warmup();
    state.status = 'ready';
    log(`llama-server ready (${entry.file})`);
    if (aux.status === 'stopped') void startAux(entry.id);
  } catch (err) {
    if (state.status !== 'restarting') {
      state.status = 'error';
      state.error = err instanceof Error ? err.message : String(err);
      log(`llama-server failed to start: ${state.error}`);
    }
  }
}

export function stopLlama(): void {
  stopping = true;
  child?.kill();
  auxChild?.kill();
}

export function llamaState(): Readonly<LlamaState> {
  return state;
}
