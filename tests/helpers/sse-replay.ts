/**
 * SSE stream replayer (TESTPLAN.md §4). Patches window.fetch inside the page
 * so POST /api/conversations/:id/messages returns the recorded transcript as a
 * genuinely paced ReadableStream — the app's real SSE consumer runs unchanged.
 *
 * Modes:
 *   normal — recorded pacing, long gaps compressed to maxGapMs (default 800)
 *   slow   — recorded pacing stretched by slowFactor (A0-2: 3-minute streams)
 *   cut    — stream closes cleanly BEFORE the `done` event (reproduces the
 *            Priority-Zero drop class: close-without-done)
 *   error  — injects a mid-stream `error` event then closes without `done`
 *
 * Install BEFORE page.goto(). Replays every matching POST in the page.
 */
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

export interface ReplayOpts {
  mode?: 'normal' | 'slow' | 'cut' | 'error';
  /** multiply recorded inter-chunk gaps (slow mode). */
  slowFactor?: number;
  /** cap on any single gap in normal mode, ms. */
  maxGapMs?: number;
  /** cut/error: drop everything from the first frame containing this event on. */
  cutBeforeEvent?: string;
  /** error mode: the injected error message. */
  errorMessage?: string;
}

export interface ReplayFixture {
  meta: { name: string; prompt: string; events: Record<string, number> };
  frames: Array<{ t: number; chunk: string }>;
}

export function loadFixture(file: string): ReplayFixture {
  const lines = readFileSync(file, 'utf8').split('\n').filter(Boolean);
  const meta = (JSON.parse(lines[0]!) as { meta: ReplayFixture['meta'] }).meta;
  const frames = lines.slice(1).map((l) => JSON.parse(l) as { t: number; chunk: string });
  return { meta, frames };
}

export async function installSseReplay(page: Page, fixtureFile: string, opts: ReplayOpts = {}): Promise<ReplayFixture> {
  const fixture = loadFixture(fixtureFile);
  const { mode = 'normal', slowFactor = 1, maxGapMs = 800, cutBeforeEvent = 'done', errorMessage = 'mock stream failure' } = opts;

  let frames = fixture.frames;
  if (mode === 'cut' || mode === 'error') {
    const cutIdx = frames.findIndex((f) => f.chunk.includes(`event: ${cutBeforeEvent}`));
    frames = cutIdx >= 0 ? frames.slice(0, cutIdx) : frames;
  }

  await page.addInitScript(
    (cfg: { frames: Array<{ t: number; chunk: string }>; mode: string; slowFactor: number; maxGapMs: number; errorMessage: string }) => {
      const orig = window.fetch.bind(window);
      (window as unknown as { __sseReplayCount: number }).__sseReplayCount = 0;
      window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
        if (!(/\/api\/conversations\/[^/]+\/messages$/.test(url) && method === 'POST')) return orig(input, init);
        (window as unknown as { __sseReplayCount: number }).__sseReplayCount += 1;
        const enc = new TextEncoder();
        const signal = init?.signal ?? null;
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            let prev = 0;
            for (const f of cfg.frames) {
              if (signal?.aborted) break;
              let gap = (f.t - prev) * (cfg.mode === 'slow' ? cfg.slowFactor : 1);
              if (cfg.mode === 'normal') gap = Math.min(gap, cfg.maxGapMs);
              prev = f.t;
              if (gap > 0) await new Promise((r) => setTimeout(r, gap));
              if (signal?.aborted) break;
              try {
                controller.enqueue(enc.encode(f.chunk));
              } catch {
                return; // consumer cancelled
              }
            }
            if (cfg.mode === 'error' && !signal?.aborted) {
              try {
                controller.enqueue(enc.encode(`event: error\ndata: ${JSON.stringify({ message: cfg.errorMessage, retryable: true })}\n\n`));
              } catch {
                return;
              }
            }
            try {
              controller.close();
            } catch {
              /* already closed */
            }
          },
        });
        return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
      };
    },
    { frames, mode, slowFactor, maxGapMs, errorMessage },
  );
  return fixture;
}
