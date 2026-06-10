import { spawn, spawnSync, execFileSync, type ChildProcess } from 'node:child_process';
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

/** Pick the chat model to serve: the selected one if present, else E4B (the guaranteed file). */
export function pickChatModel(selected: string | null): ModelEntry | null {
  const models = scanModels();
  const want = models.find((m) => m.id === selected && m.present && m.selectable);
  return want ?? models.find((m) => m.id === 'e4b' && m.present) ?? null;
}

/**
 * Warm the fresh llama-server process with a request shaped like real chat traffic
 * (≈120-token prompt, streaming, same sampling params). The first sizeable prompt
 * batch pays one-time Metal pipeline compilation (~5 s) — pay it here, not on the
 * user's first message.
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
}

export function llamaState(): Readonly<LlamaState> {
  return state;
}
