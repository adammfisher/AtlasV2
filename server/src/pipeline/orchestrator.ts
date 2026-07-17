import { execFile } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { repoRoot, config } from '../config.js';
import { logTo } from '../log.js';
import { completeJsonOffice, completeText } from '../llama/json.js';
import { streamChat } from '../llama/client.js';
import { scanModels } from '../llama/models.js';
import { auxState, portForTask, llamaState } from '../llama/spawn.js';
import * as bedrock from '../providers/bedrock.js';

function bedrockModule(): typeof bedrock {
  return bedrock;
}
import { loadSkill, templatePath, type SkillId, type LoadedSkill } from './skills.js';
import { validateJson, validateMermaid, validateSvg, validateFileMap, stripFences, extractSvg, healEntryFile, officeDoctrineCheck, healConstraints, salvageConstraints, healDoctrine, repairOverflow } from './validate.js';
import { retrieveExemplars, formatExemplars } from './exemplars.js';
import { OrchestrationError, injectEditContext, type ArtifactKind, type EditState } from './artifactContext.js';
import {
  createArtifact,
  addVersion,
  versionDir,
  writeVersionFiles,
  latestPayload,
  type CheckStep,
} from './artifacts.js';
import { productChecks, mergeProductEdit } from './product.js';

const execFileAsync = promisify(execFile);

export interface PipelineSend {
  (event: string, data: unknown): void;
}

export interface PipelinePayload {
  skill: SkillId;
  skillBadge: string;
  duration: string;
  edit?: boolean;
  steps: CheckStep[];
  text: string;
  artifact: { artifactId: string; name: string; kind: string; meta: string; ver: number };
}

export class PipelineError extends Error {}

interface Ctx {
  skill: LoadedSkill;
  text: string;
  projectId: string;
  instructions: string;
  context?: string;
  send: PipelineSend;
  signal: AbortSignal;
  steps: CheckStep[];
  started: number;
}

function pushStep(ctx: Ctx, step: CheckStep): void {
  const existing = ctx.steps.findIndex((s) => s.label === step.label);
  if (existing >= 0) ctx.steps[existing] = step;
  else ctx.steps.push(step);
  ctx.send('step', step);
}

/** §8 task routing — office_json runs on the best SERVABLE tier; honest naming.
 * Escalated only when the office call actually runs on a higher tier than the
 * user's selected chat model (the chip rule). */
export function officeModel(): { name: string; tier: string; escalated: boolean; port: number } {
  const { bedrockActive, activeModelDef: activeDef, officeGenerationModel } = bedrockModule();
  if (bedrockActive()) {
    // document generation runs on a Claude model even if the user selected a
    // non-Claude one for chat (Nova/Nemotron can't produce reliable JSON) —
    // name the model that ACTUALLY generates, and flag the substitution
    let gen;
    try {
      gen = officeGenerationModel();
    } catch {
      gen = activeDef();
    }
    const substituted = gen.key !== activeDef().key;
    return { name: gen.name, tier: 'bedrock', escalated: substituted, port: 0 };
  }
  const a = auxState();
  if (a.status === 'ready' && a.tier === '12b') {
    const resident = llamaState().modelFile?.toLowerCase() ?? '';
    return { name: 'Gemma 4 12B', tier: '12b', escalated: !resident.includes('12b'), port: portForTask('office') };
  }
  const resident = llamaState().modelFile?.toLowerCase() ?? '';
  if (resident.includes('12b')) return { name: 'Gemma 4 12B', tier: '12b', escalated: false, port: portForTask('chat') };
  return { name: 'Gemma 4 E4B', tier: 'e4b', escalated: false, port: portForTask('chat') };
}

function slug(value: string): string {
  return (
    value
      .replace(/[^A-Za-z0-9 _-]/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 48) || 'artifact'
  );
}

const UNITS: Record<string, string> = {
  pptx: 'slides',
  docx: 'sections',
  xlsx: 'sheets',
  pdf: 'pages',
  react: 'files',
  site: 'files',
  product: 'fields',
};

function officePrompt(skill: LoadedSkill, instructions: string, text: string, context?: string): string {
  // pptx: inject top-K archetype exemplars matched to the request's content
  // shape (small tiers copy their structure; frontier keeps latitude within
  // the same hard numbers — see the SKILL.md tier phrasing block)
  const exemplarBlock =
    skill.id === 'pptx'
      ? (() => {
          const picked = retrieveExemplars(text, 3);
          return picked.length
            ? `\nEXEMPLARS — schema-valid slides showing the expected quality bar. Match their structure and copy discipline, never their content:\n${formatExemplars(picked)}`
            : '';
        })()
      : '';
  return `You are a document-generation backend. You produce ONLY a raw JSON object conforming exactly
to the schema described below. No markdown, no code fences, no prose, no extra keys.
SCHEMA (described): ${JSON.stringify(skill.schema)}
DESIGN GUIDANCE: ${skill.guidance}${exemplarBlock}
PROJECT INSTRUCTIONS: ${instructions || '(none)'}${
    context
      ? `\n\nCONVERSATION CONTEXT — the request refers to this discussion; use its specifics (names, numbers, structure, any content already drafted) to fill the document. Do NOT ignore it and do NOT emit a generic placeholder document:\n${context}`
      : ''
  }
USER REQUEST: ${text}`;
}

/**
 * Constrained generation with the §4.3.3 repair loop: one repair retry, then
 * tier escalation if a higher tier exists, else an honest failure. Returns the
 * validated payload plus whether it was valid first pass (for the 90% gate log).
 */
async function generateJson(
  ctx: Ctx,
  systemPrompt: string,
  /** undefined = no caller budget; ask the model for its own ceiling */
  maxTokens: number | undefined,
  extraValidate?: (payload: unknown) => { ok: true } | { ok: false; error: string },
): Promise<{ payload: unknown; firstPass: boolean }> {
  const schema = ctx.skill.schema as Record<string, unknown>;
  let lastError = '';
  let lastRaw = '';
  // Deterministic doctrine heal: trim over-budget copy (e.g. a content slide
  // over the 40-word cap) so an over-written slide is tightened in place rather
  // than burning a retry or hard-failing. Returns a fully schema-AND-doctrine
  // valid payload, or null when there was nothing trim-able to fix.
  const tryDoctrineHeal = (value: unknown): unknown | null => {
    const { value: trimmed, fixes } = healDoctrine(ctx.skill.id, value);
    if (fixes === 0) return null;
    const rv = validateJson(ctx.skill.id, schema, JSON.stringify(trimmed));
    if (!rv.ok) return null;
    const extra = extraValidate?.(rv.value);
    if (extra && !extra.ok) return null;
    return rv.value;
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const messages =
      attempt === 0
        ? [{ role: 'system' as const, content: systemPrompt }, { role: 'user' as const, content: ctx.text }]
        : [
            { role: 'system' as const, content: systemPrompt },
            { role: 'user' as const, content: ctx.text },
            {
              role: 'user' as const,
              content: `Your previous output failed validation: ${lastError}. Output ONLY corrected raw JSON matching the schema.`,
            },
          ];
    ctx.send('gen', { reset: true, label: ctx.skill.id });
    // completeJson routes to Bedrock (Claude) when connected; the local port is
    // ignored there. onDelta drives the live-write indicator.
    let raw: string;
    try {
      raw = await completeJsonOffice(messages, schema, {
        maxTokens,
        signal: ctx.signal,
        temperature: 0.2,
        port: portForTask('office'),
        onDelta: (delta) => ctx.send('gen', { delta }),
      });
    } catch (err) {
      // A budget stop is not a model mistake and re-asking cannot fix it — the
      // retry would run into the same ceiling. Surface it as itself instead of
      // burning the repair budget and reporting a parse error.
      if (err instanceof bedrock.TruncatedOutputError) {
        throw new PipelineError(`${ctx.skill.id}: ${err.message}`);
      }
      throw err;
    }
    lastRaw = raw;
    const result = validateJson(ctx.skill.id, schema, raw);
    if (result.ok) {
      const extra = extraValidate?.(result.value);
      if (!extra || extra.ok) {
        logTo('pipeline', `${ctx.skill.id} json valid attempt=${attempt + 1} hash=${raw.length}`);
        return { payload: result.value, firstPass: attempt === 0 };
      }
      const healedDoc = tryDoctrineHeal(result.value);
      if (healedDoc !== null) {
        logTo('pipeline', `${ctx.skill.id} doctrine-trimmed to budget attempt=${attempt + 1}`);
        return { payload: healedDoc, firstPass: false };
      }
      lastError = extra.error;
      logTo('pipeline', `${ctx.skill.id} extra-validation attempt=${attempt + 1}: ${lastError}`);
      continue;
    }
    // Deterministic constraint healing: the model over-generated (too many
    // items, too-long strings, stray keys). Trim to the schema's own limits and
    // re-validate — enforces the design ceilings without a hard fail, so a
    // 30-slide deck can't die on one over-full column when the cloud path has no
    // higher tier to escalate to.
    try {
      const { value: healed, fixes } = healConstraints(ctx.skill.id, schema, JSON.parse(raw));
      if (fixes > 0) {
        const rv = validateJson(ctx.skill.id, schema, JSON.stringify(healed));
        if (rv.ok) {
          const extra = extraValidate?.(rv.value);
          if (!extra || extra.ok) {
            logTo('pipeline', `${ctx.skill.id} healed ${fixes} constraint violation(s) attempt=${attempt + 1}`);
            return { payload: rv.value, firstPass: false };
          }
          const healedDoc = tryDoctrineHeal(rv.value);
          if (healedDoc !== null) {
            logTo('pipeline', `${ctx.skill.id} healed ${fixes} constraint(s) + trimmed to budget attempt=${attempt + 1}`);
            return { payload: healedDoc, firstPass: false };
          }
          lastError = extra.error;
          logTo('pipeline', `${ctx.skill.id} healed schema but doctrine failed attempt=${attempt + 1}: ${lastError}`);
          continue;
        }
      }
    } catch {
      /* JSON.parse failed — not a constraint issue; fall through to repair */
    }
    lastError = result.error;
    logTo('pipeline', `${ctx.skill.id} repair attempt=${attempt + 1}: ${lastError}`);
  }
  // Final salvage: heal what's healable, then DROP the individual slides/
  // sections that stay structurally invalid — a 30-slide deck with one bad slide
  // becomes a valid 29-slide deck instead of a hard failure. This replaces the
  // legacy local-"12b" escalation, which is dead on the cloud path (the office
  // JSON already runs on the strongest available Claude model).
  if (lastRaw) {
    try {
      const { value: salvaged, ok, dropped } = salvageConstraints(ctx.skill.id, schema, JSON.parse(lastRaw));
      if (ok) {
        // if the design-doctrine gate rejects a specific unit, drop it and re-check
        let payload = salvaged;
        for (let i = 0; i < 6; i++) {
          const extra = extraValidate?.(payload);
          if (!extra || extra.ok) {
            logTo('pipeline', `${ctx.skill.id} salvaged after repair: dropped ${dropped} invalid element(s)`);
            return { payload, firstPass: false };
          }
          // trim the over-budget copy before resorting to dropping the whole unit
          const healedDoc = tryDoctrineHeal(payload);
          if (healedDoc !== null) {
            logTo('pipeline', `${ctx.skill.id} salvaged: dropped ${dropped} + trimmed to budget`);
            return { payload: healedDoc, firstPass: false };
          }
          const dropIdx = /\b(?:slide|section|page|sheet)\s+(\d+)\b/i.exec(extra.error);
          const arrKey = ['slides', 'sections', 'pages', 'sheets'].find(
            (k) => Array.isArray((payload as Record<string, unknown>)[k]),
          );
          if (!dropIdx || !arrKey) {
            lastError = extra.error;
            break;
          }
          const arr = (payload as Record<string, unknown>)[arrKey] as unknown[];
          arr.splice(Number(dropIdx[1]) - 1, 1); // doctrine messages are 1-based
          payload = salvageConstraints(ctx.skill.id, schema, payload).value;
        }
      } else {
        lastError = `unsalvageable after dropping ${dropped} element(s)`;
      }
    } catch {
      /* last output wasn't parseable JSON (e.g. truncated) — fail honestly below */
    }
  }
  throw new PipelineError(`Generation failed after repair and salvage: ${lastError}`);
}

interface HelperResult {
  ok: boolean;
  file: string;
  // `findings` is a string[] the fix-and-rerender loop reads; other keys are scalars
  meta: Record<string, number | string | string[]>;
  checks: Array<{ label: string; ok: boolean }>;
}

/** Fixed rubric for the ADVISORY vision-critique pass (AXIOM_VISION_CRITIQUE=1,
 * default OFF). Deterministic checks are the gate; this only logs and annotates. */
const VISION_RUBRIC = `You are a strict presentation-design reviewer. Score each slide thumbnail
against exactly these dimensions: overlap (shapes/text colliding), overflow (text touching or
escaping its frame), contrast (text hard to read on its background), alignment (elements off any
common grid line), whitespace (under ~15% empty area, crowded), palette (more than one dominant
color family, or equal-weight colors), one_idea (slide argues more than one message), accent_line
(a decorative line/underline directly beneath the title — an AI-generated tell). Report ONLY real
issues you can point at; an empty issues array is the correct output for a clean slide.`;

const VISION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['slides'],
  properties: {
    slides: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['slide_index', 'pass', 'issues'],
        properties: {
          slide_index: { type: 'integer' },
          pass: { type: 'boolean' },
          issues: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['type', 'severity', 'fix'],
              properties: {
                type: {
                  type: 'string',
                  enum: ['overlap', 'overflow', 'contrast', 'alignment', 'whitespace', 'palette', 'one_idea', 'accent_line'],
                },
                severity: { type: 'string', enum: ['low', 'medium', 'high'] },
                fix: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
};

/** ADVISORY vision critique: thumbnail grid → active multimodal model → strict
 * JSON, logged with cost/latency. Never gates — deterministic checks decide. */
async function visionCritique(ctx: Ctx, skillId: string, helper: HelperResult): Promise<void> {
  if (process.env.AXIOM_VISION_CRITIQUE !== '1') return;
  const thumbs = (helper.meta.thumbs_b64 as unknown as string[] | undefined) ?? [];
  if (!thumbs.length) {
    pushStep(ctx, { state: 'warn', label: 'Vision critique skipped — no thumbnails (soffice absent?)' });
    return;
  }
  if (!bedrock.bedrockSettings().connected || !activeModelDefHasVision()) {
    pushStep(ctx, { state: 'warn', label: 'Vision critique skipped — no multimodal model available' });
    return;
  }
  const started = Date.now();
  try {
    const raw = await bedrock.bedrockCompleteJson(
      [
        { role: 'system', content: VISION_RUBRIC },
        {
          role: 'user',
          content: [
            { type: 'text' as const, text: `Critique these ${thumbs.length} ${skillId} slides in order (slide_index is 1-based).` },
            ...thumbs.map((b64) => ({ type: 'image_url' as const, image_url: { url: `data:image/jpeg;base64,${b64}` } })),
          ],
        },
      ],
      VISION_SCHEMA,
      { maxTokens: 3000 },
    );
    const parsed = JSON.parse(raw) as { slides: Array<{ slide_index: number; pass: boolean; issues: Array<{ type: string; severity: string; fix: string }> }> };
    const issues = parsed.slides.flatMap((s) => s.issues.map((i) => ({ ...i, slide: s.slide_index })));
    const latencyMs = Date.now() - started;
    // cost proxy: ~1.3k tokens per thumbnail image + text; logged for tracking
    logTo(
      'pipeline',
      `vision-critique ${skillId}: ${parsed.slides.length} slides, ${issues.length} issues, ${latencyMs}ms, ~${thumbs.length * 1300 + Math.ceil(raw.length / 4)} tokens`,
    );
    pushStep(ctx, {
      state: issues.some((i) => i.severity === 'high') ? 'warn' : 'ok',
      label: `Vision critique (advisory): ${issues.length} issue${issues.length === 1 ? '' : 's'}`,
      detail: issues.slice(0, 3).map((i) => `s${i.slide} ${i.type}: ${i.fix}`).join(' · ') || 'all slides pass',
    });
  } catch (err) {
    pushStep(ctx, { state: 'warn', label: `Vision critique skipped — ${err instanceof Error ? err.message.slice(0, 80) : 'error'}` });
  }
}

function activeModelDefHasVision(): boolean {
  try {
    return !!bedrock.activeModelDef().vision;
  } catch {
    return false;
  }
}

/** Cloud: invoke the atlasv2-office Python Lambda (no python in the app Lambda).
 * Returns the built file as base64 which we write to outFile. */
async function runHelperLambda(skillId: string, payload: unknown, outFile: string): Promise<HelperResult> {
  const { LambdaClient, InvokeCommand } = await import('@aws-sdk/client-lambda');
  const client = new LambdaClient({ region: config.bedrock.region || 'us-east-1' });
  const out = await client.send(
    new InvokeCommand({
      FunctionName: 'atlasv2-office',
      Payload: Buffer.from(JSON.stringify({ skill: skillId, payload })),
    }),
  );
  const rawResp = Buffer.from(out.Payload ?? new Uint8Array()).toString('utf8');
  let res: HelperResult & { file_b64?: string; error?: string; errorMessage?: string };
  try {
    res = JSON.parse(rawResp) as typeof res;
  } catch {
    throw new PipelineError(`office lambda (${skillId}) returned no parseable response`);
  }
  if (res.ok && res.file_b64) {
    mkdirSync(path.dirname(outFile), { recursive: true });
    writeFileSync(outFile, Buffer.from(res.file_b64, 'base64'));
    return { ok: true, file: outFile, meta: res.meta, checks: res.checks };
  }
  // A build rejection (spec-validation failure, or a builder exception) is
  // RECOVERABLE: return it as a failing result so the fix-and-rerender loop can
  // feed the reason back and regenerate, instead of hard-throwing on the first
  // try. res.error is our own {ok:false,error}; errorMessage is a Lambda-level
  // unhandled exception.
  const reason = res.error ?? res.errorMessage ?? 'no file returned';
  return { ok: false, file: outFile, meta: { findings: [reason] }, checks: [{ label: `build rejected: ${reason}`, ok: false }] };
}

async function runHelper(
  skillId: string,
  payload: unknown,
  outFile: string,
): Promise<HelperResult> {
  if (process.env.AWS_LAMBDA_FUNCTION_NAME) return runHelperLambda(skillId, payload, outFile);
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'axiom-'));
  const payloadFile = path.join(tmp, 'payload.json');
  writeFileSync(payloadFile, JSON.stringify(payload));
  const args = [
    path.join(repoRoot, `scripts/office/build_${skillId}.py`),
    '--payload',
    payloadFile,
    '--out',
    outFile,
  ];
  const template = templatePath(skillId as SkillId);
  if (template) args.push('--template', template);
  try {
    const { stdout } = await execFileAsync(
      path.join(repoRoot, 'runtimes/python/venv/bin/python'),
      args,
      { cwd: repoRoot, timeout: 180_000 },
    );
    const result = JSON.parse(stdout.trim().split('\n').pop() ?? '{}') as HelperResult & { error?: string };
    if (result.ok) return result;
    // build rejected (spec validation, etc.) — recoverable, see runHelperLambda
    const reason = result.error ?? 'build produced no output';
    return { ok: false, file: outFile, meta: { findings: [reason] }, checks: [{ label: `build rejected: ${reason}`, ok: false }] };
  } catch (err) {
    // non-zero exit (builder raised) — surface the reason as a recoverable
    // finding so the fix-and-rerender loop can retry before hard-failing
    const stderr = (err as { stderr?: string }).stderr ?? (err as Error).message ?? '';
    const detail = stderr.trim().split('\n').slice(-3).join(' | ') || 'unknown build error';
    return { ok: false, file: outFile, meta: { findings: [detail] }, checks: [{ label: `build_${skillId}.py error: ${detail}`, ok: false }] };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function helperChecksToSteps(ctx: Ctx, checks: Array<{ label: string; ok: boolean }>): boolean {
  let blockingFailure = false;
  for (const check of checks) {
    const skip = /skip/i.test(check.label);
    pushStep(ctx, {
      state: check.ok ? 'ok' : 'warn',
      label: check.label,
      detail: check.ok ? undefined : skip ? undefined : 'failed',
    });
    if (!check.ok && !skip) blockingFailure = true;
  }
  return blockingFailure;
}

async function summarize(ctx: Ctx, digest: string): Promise<string> {
  try {
    const text = await completeText(
      [
        {
          role: 'system',
          content:
            'You write one short confirmation paragraph (under 60 words, plain prose, no markdown) describing a document that was just generated for the user. Concrete and specific; no preamble.',
        },
        { role: 'user', content: `Request: ${ctx.text}\nGenerated: ${digest}` },
      ],
      { maxTokens: 120, signal: ctx.signal },
    );
    return text.trim();
  } catch {
    return `Generated ${digest}.`;
  }
}

function finishPayload(
  ctx: Ctx,
  badge: string,
  edit: boolean,
  text: string,
  artifact: PipelinePayload['artifact'],
): PipelinePayload {
  const duration = `${((Date.now() - ctx.started) / 1000).toFixed(1)}s`;
  return { skill: ctx.skill.id, skillBadge: badge, duration, edit: edit || undefined, steps: ctx.steps, text, artifact };
}

export async function runCreateDoc(opts: {
  skillId: SkillId;
  text: string;
  projectId: string;
  convId?: string;
  instructions: string;
  context?: string;
  routerMs: number;
  routerModel: string;
  send: PipelineSend;
  signal: AbortSignal;
}): Promise<PipelinePayload> {
  const skill = loadSkill(opts.skillId);
  const ctx: Ctx = { skill, ...opts, steps: [], started: Date.now() };
  const model = officeModel();
  ctx.send('pipeline', { phase: 'start', skillBadge: `${skill.id} skill` });

  pushStep(ctx, {
    state: 'ok',
    label: `Router · ${opts.routerModel}`,
    detail: `intent: create_doc · skill: ${skill.id} · ${opts.routerMs} ms`,
  });
  const tokens = Math.round(skill.guidance.length / 4 / 100) / 10;
  pushStep(ctx, { state: 'ok', label: 'Skill loaded', detail: `${skill.id} playbook · ${tokens}k tokens` });

  const unit = UNITS[skill.id] ?? 'items';
  const genLabel = `${model.name} · ${unit} JSON`;
  if (model.escalated) {
    pushStep(ctx, { state: 'ok', label: 'Escalated to 12B — office JSON', detail: 'higher tier than the selected chat model' });
  }

  let artifactId: string;
  let name: string;
  let meta: string;
  let digest: string;

  if (skill.schema) {
    const template = templatePath(skill.id);
    if (template) {
      pushStep(ctx, { state: 'ok', label: 'Template', detail: path.basename(template) });
    }
    pushStep(ctx, { state: 'pending', label: genLabel, detail: 'streaming json' });
    // One budget for every document skill, replacing the old per-skill caps
    // (3072, 4096 for product) that were sized for a weaker model and bound a
    // "react" artifact to ~150 lines — JSON-escaped JSX spends a token on every
    // newline and quote. 24k fits a multi-file artifact with headroom; a request
    // past it truncates honestly (TruncatedOutputError) rather than silently.
    // Clamped to the model's own ceiling so Nova/Nemotron never over-request.
    const maxTokens = bedrock.officeMaxTokens();
    const fileMapCheck =
      skill.id === 'react' || skill.id === 'site'
        ? (payload: unknown) =>
            validateFileMap(((payload as Record<string, unknown>).files ?? {}) as Record<string, string>)
        : undefined;
    // design-doctrine feedback inside the repair loop (word caps, hierarchy,
    // frontier-only position_overrides); the Python builder re-audits as the gate
    const doctrineCheck = ['pptx', 'docx', 'xlsx', 'pdf'].includes(skill.id)
      ? (payload: unknown) => officeDoctrineCheck(skill.id, payload, officeModel().tier === 'bedrock')
      : undefined;
    const { payload, firstPass } = await generateJson(ctx, officePrompt(skill, opts.instructions, opts.text, opts.context), maxTokens, fileMapCheck ?? doctrineCheck);
    pushStep(ctx, {
      state: 'ok',
      label: genLabel,
      detail: `streaming json · ${firstPass ? 'valid first pass' : 'valid after repair'}`,
    });

    const p = payload as Record<string, unknown>;
    if (skill.id === 'product') {
      name = `${slug(String(p.name ?? 'product'))}.product.json`;
      ({ id: artifactId } = await createArtifact(opts.projectId, name, 'product', opts.convId));
      const dir = versionDir(opts.projectId, artifactId, 1);
      const file = path.join(dir, 'definition.json');
      writeFileSync(file, JSON.stringify(payload, null, 2));
      const checks = await productChecks(payload, 'proposed', ctx.projectId);
      for (const step of checks) pushStep(ctx, step);
      meta = `product master · ${Object.keys(p).length} fields`;
      const ver = await addVersion(artifactId, { payload, meta, validation: checks, filePath: file });
      digest = `product definition "${String(p.name)}" (${meta})`;
      const summaryText = await summarize(ctx, digest);
      const artifact = { artifactId, name, kind: 'product', meta, ver };
      ctx.send('artifact', artifact);
      ctx.send('assistant_text', { text: summaryText });
      return finishPayload(ctx, 'product skill', false, summaryText, artifact);
    }

    if (skill.id === 'react' || skill.id === 'site') {
      const entry = skill.id === 'react' ? String(p.entry ?? '/App.jsx') : '/index.html';
      // heal BEFORE persisting: the client bundler consumes p.files (the
      // payload), so the healed map must land there, not just on disk
      const files = healEntryFile((p.files ?? {}) as Record<string, string>, entry);
      p.files = files;
      name = skill.id === 'react' ? 'component' : 'preview-site';
      ({ id: artifactId } = await createArtifact(opts.projectId, name, skill.id, opts.convId));
      const dir = versionDir(opts.projectId, artifactId, 1);
      writeVersionFiles(dir, files);
      if (!files[entry]) throw new PipelineError(`entry file ${entry} missing from emitted files`);
      pushStep(ctx, { state: 'ok', label: 'Files persisted', detail: `${Object.keys(files).length} files · entry ${entry}` });
      pushStep(ctx, { state: 'ok', label: 'Sandbox', detail: 'bundles client-side · CSP locked · offline' });
      meta = `${Object.keys(files).length} files · bundled offline`;
      const ver = await addVersion(artifactId, { payload, meta, validation: ctx.steps.slice(-2), filePath: dir });
      digest = `${skill.id} project with ${Object.keys(files).length} files`;
      const summaryText = await summarize(ctx, digest);
      const artifact = { artifactId, name, kind: skill.id, meta, ver };
      ctx.send('artifact', artifact);
      ctx.send('assistant_text', { text: summaryText });
      return finishPayload(ctx, `${skill.id} skill`, false, summaryText, artifact);
    }

    // office four: helper compile + validation chain (with one rebuild-repair on blocking check failure)
    const title = String(
      (p.title as string) ??
        ((p.metadata as Record<string, unknown>)?.title as string) ??
        `${skill.id}-document`,
    );
    name = `${slug(title)}.${skill.id}`;
    ({ id: artifactId } = await createArtifact(opts.projectId, name, skill.id, opts.convId));
    const dir = versionDir(opts.projectId, artifactId, 1);
    const outFile = path.join(dir, name);
    pushStep(ctx, { state: 'pending', label: `build_${skill.id}.py`, detail: 'compiling' });
    // Bounded fix-and-REBUILD loop: the validator's per-slide findings drive a
    // DETERMINISTIC trim of exactly the flagged slides, then rebuild → re-check.
    // No LLM regeneration — the deck stays the SAME deck, just progressively
    // tightened where a frame overflows, so successive passes can't drift into a
    // different deck (the "generating twice/thrice, and they don't match" bug).
    // Rebuilds are cheap (no model call), so we allow a few more passes.
    let currentPayload = payload;
    let helper = await runHelper(skill.id, currentPayload, outFile);
    // a hard build rejection (helper.ok === false) has no file — it must count
    // as blocked so the loop repairs, even if its synthetic check list is thin
    let blocked = !helper.ok || helperChecksToSteps(ctx, helper.checks);
    for (let retry = 1; blocked && retry <= 4; retry++) {
      const findings = [
        ...helper.checks.filter((c) => !c.ok && !/skip/i.test(c.label)).map((c) => c.label),
        ...(((helper.meta.findings as unknown) as string[] | undefined) ?? []),
      ];
      const { value: trimmed, fixes } = repairOverflow(skill.id, currentPayload, findings);
      // nothing deterministic left to trim (e.g. contrast/collision findings, or
      // slides already at their floor) — stop retrying and fall to slide-drop salvage
      if (fixes === 0) break;
      pushStep(ctx, { state: 'pending', label: `fix-and-rebuild ${retry}/4`, detail: findings.slice(0, 3).join(' · ') });
      currentPayload = trimmed;
      helper = await runHelper(skill.id, currentPayload, outFile);
      blocked = !helper.ok || helperChecksToSteps(ctx, helper.checks);
    }
    if (blocked) {
      // Large-deck salvage: the validator couldn't fix specific slides after the
      // retries. Rather than discard the whole deck, DROP the offending
      // slides/sections and rebuild once — the shipped deck then contains ONLY
      // units that pass the design gate (honoring "never ship a failing slide")
      // while a 30-slide request still succeeds. Surfaced as a visible warn.
      const arrKey = ['slides', 'sections', 'pages'].find(
        (k) => Array.isArray((currentPayload as Record<string, unknown>)[k]),
      );
      const findings = [
        ...helper.checks.filter((c) => !c.ok && !/skip/i.test(c.label)).map((c) => c.label),
        ...(((helper.meta.findings as unknown) as string[] | undefined) ?? []),
      ];
      const badIdx = [
        ...new Set(
          findings.flatMap((f) => {
            const m = /\b(?:slide|section|page)\s+(\d+)\b/i.exec(f);
            return m ? [Number(m[1]) - 1] : [];
          }),
        ),
      ].sort((a, b) => b - a); // descending so each splice keeps earlier indices valid
      if (arrKey && badIdx.length) {
        const arr = (currentPayload as Record<string, unknown>)[arrKey] as unknown[];
        if (arr.length - badIdx.length >= 1) {
          for (const idx of badIdx) if (idx >= 0 && idx < arr.length) arr.splice(idx, 1);
          pushStep(ctx, {
            state: 'warn',
            label: `Dropped ${badIdx.length} unfixable ${arrKey.replace(/s$/, '')}${badIdx.length === 1 ? '' : 's'}`,
            detail: `kept ${arr.length} that pass the design gate`,
          });
          helper = await runHelper(skill.id, currentPayload, outFile);
          blocked = !helper.ok || helperChecksToSteps(ctx, helper.checks);
        }
      }
    }
    if (blocked) {
      const failing = helper.checks.filter((c) => !c.ok).map((c) => c.label);
      const details = (((helper.meta.findings as unknown) as string[] | undefined) ?? []).slice(0, 6);
      throw new PipelineError(
        `design gate failed after 2 fix retries: ${failing.join(', ')}${details.length ? ` — ${details.join(' | ')}` : ''}`,
      );
    }
    const metaParts = Object.entries(helper.meta)
      .filter(([k]) => !['bytes', 'findings', 'thumbs_b64'].includes(k))
      .map(([k, v]) => `${v} ${k}`)
      .join(' · ');
    pushStep(ctx, { state: 'ok', label: `build_${skill.id}.py`, detail: metaParts });
    await visionCritique(ctx, skill.id, helper);
    meta = metaParts;
    const checkSteps: CheckStep[] = helper.checks.map((c) => ({
      state: c.ok ? 'ok' : 'warn',
      label: c.label,
    }));
    const ver = await addVersion(artifactId, { payload: currentPayload, meta, validation: checkSteps, filePath: outFile });
    digest = `${name} (${metaParts})`;
    const summaryText = await summarize(ctx, digest);
    const artifact = { artifactId, name, kind: skill.id, meta, ver };
    ctx.send('artifact', artifact);
    ctx.send('assistant_text', { text: summaryText });
    return finishPayload(ctx, `${skill.id} skill`, false, summaryText, artifact);
  }

  // direct-emission skills: md, mermaid, svg
  pushStep(ctx, { state: 'pending', label: genLabel, detail: 'direct emission' });
  let emitted = '';
  let lastError = '';
  let okEmit = false;
  for (let attempt = 0; attempt < 2 && !okEmit; attempt++) {
    const messages = [
      {
        role: 'system' as const,
        content: `${skill.guidance}\n\nPROJECT INSTRUCTIONS: ${opts.instructions || '(none)'}${
          opts.context
            ? `\n\nCONVERSATION CONTEXT — build the output from this discussion (names, numbers, any drafted content); do not emit a generic placeholder:\n${opts.context}`
            : ''
        }`,
      },
      { role: 'user' as const, content: opts.text },
      ...(attempt > 0
        ? [{ role: 'user' as const, content: `Your previous output failed validation: ${lastError}. Output ONLY the corrected ${skill.id} source.` }]
        : []),
    ];
    ctx.send('gen', { reset: true, label: ctx.skill.id });
    emitted = stripFences(
      await completeText(messages, {
        maxTokens: 2048,
        signal: ctx.signal,
        temperature: 0.4,
        onDelta: (delta) => ctx.send('gen', { delta }),
      }),
    );
    if (skill.id === 'mermaid') {
      const v = validateMermaid(emitted);
      okEmit = v.ok;
      lastError = v.ok ? '' : v.error;
    } else if (skill.id === 'svg') {
      emitted = extractSvg(emitted); // models wrap the element in prose; cut it out
      const v = validateSvg(emitted);
      okEmit = v.ok;
      lastError = v.ok ? '' : v.error;
    } else {
      okEmit = emitted.length > 0;
      lastError = 'empty output';
    }
    if (!okEmit) logTo('pipeline', `${skill.id} repair attempt=${attempt + 1}: ${lastError}`);
  }
  if (!okEmit) throw new PipelineError(`${skill.id} emission failed validation twice: ${lastError}`);
  pushStep(ctx, { state: 'ok', label: genLabel, detail: 'emitted · validated' });

  const firstLine = emitted.split('\n')[0] ?? '';
  name =
    skill.id === 'md'
      ? `${slug(firstLine.replace(/^#+\s*/, '') || 'notes')}.md`
      : skill.id === 'mermaid'
        ? 'diagram.mmd'
        : 'graphic.svg';
  ({ id: artifactId } = await createArtifact(opts.projectId, name, skill.id, opts.convId));
  const dir = versionDir(opts.projectId, artifactId, 1);
  const outFile = path.join(dir, name);
  writeFileSync(outFile, emitted);
  const checkLabel = skill.id === 'md' ? 'marked render (client)' : skill.id === 'mermaid' ? 'Syntax check' : 'XML + viewBox';
  pushStep(ctx, { state: 'ok', label: checkLabel });
  meta =
    skill.id === 'md'
      ? `${emitted.split('\n').length} lines`
      : skill.id === 'mermaid'
        ? `${firstLine.split(/\s/)[0]}`
        : 'validated SVG';
  const ver = await addVersion(artifactId, {
    payload: { source: emitted },
    meta,
    validation: [{ state: 'ok', label: checkLabel }],
    filePath: outFile,
  });
  const summaryText = await summarize(ctx, `${name} (${meta})`);
  const artifact = { artifactId, name, kind: skill.id, meta, ver };
  ctx.send('artifact', artifact);
  ctx.send('assistant_text', { text: summaryText });
  return finishPayload(ctx, `${skill.id} skill`, false, summaryText, artifact);
}

export async function runEditDoc(opts: {
  skillId: SkillId;
  artifactId: string;
  artifactName: string;
  text: string;
  projectId: string;
  instructions: string;
  routerMs: number;
  routerModel: string;
  send: PipelineSend;
  signal: AbortSignal;
}): Promise<PipelinePayload> {
  const skill = loadSkill(opts.skillId);
  const ctx: Ctx = { skill, ...opts, steps: [], started: Date.now() };
  ctx.send('pipeline', { phase: 'start', skillBadge: 'targeted edit' });
  pushStep(ctx, {
    state: 'ok',
    label: `Router · ${opts.routerModel}`,
    detail: `intent: edit_doc · skill: ${skill.id} · ${opts.routerMs} ms`,
  });

  // HARD SAFETY INVARIANT: state MUST load before any model dispatch. If it
  // cannot, fail loudly (never describe) — the chat route turns this into a
  // clarifying question.
  const current = await latestPayload(opts.artifactId);
  if (!current) throw new OrchestrationError('EDIT_STATE_UNAVAILABLE', `no editable state for artifact ${opts.artifactId}`);
  const editKind = opts.skillId as ArtifactKind;

  if (skill.id === 'product') {
    const { merged, fields } = await mergeProductEdit(
      skill,
      current.payload as Record<string, unknown>,
      opts.text,
      ctx.signal,
      (step) => pushStep(ctx, step),
      (event) => ctx.send('gen', event),
    );
    const dir = versionDir(opts.projectId, opts.artifactId, current.version + 1);
    const file = path.join(dir, 'definition.json');
    writeFileSync(file, JSON.stringify(merged, null, 2));
    const checks = await productChecks(merged, 'proposed', ctx.projectId);
    for (const step of checks) pushStep(ctx, step);
    const meta = `product master · ${Object.keys(merged).length} fields`;
    const ver = await addVersion(opts.artifactId, { payload: merged, meta, validation: checks, filePath: file });
    const summaryText = await summarize(ctx, `field-scoped edit of ${opts.artifactName}: ${fields.join(', ')}`);
    const artifact = { artifactId: opts.artifactId, name: opts.artifactName, kind: 'product', meta, ver };
    ctx.send('artifact', artifact);
    ctx.send('assistant_text', { text: summaryText });
    return finishPayload(ctx, `Targeted edit · ${fields.join(', ')}`, true, summaryText, artifact);
  }

  if (!skill.schema) {
    // text-emission skills (md/mermaid/svg): re-emit with the current source as
    // context, through the same validation + repair loop as generation
    const model = officeModel();
    const currentSource = String((current.payload as { source?: string }).source ?? '');
    pushStep(ctx, { state: 'pending', label: `${model.name} · edit`, detail: 're-emission with current source' });
    let emitted = '';
    let lastError = '';
    let okEmit = false;
    for (let attempt = 0; attempt < 2 && !okEmit; attempt++) {
      ctx.send('gen', { reset: true, label: skill.id });
      emitted = stripFences(
        await completeText(
          [
            {
              role: 'system' as const,
              content: `${skill.guidance}\n\nYou are EDITING an existing ${skill.id} document. Output ONLY the full corrected source.`,
            },
            {
              role: 'user' as const,
              content: injectEditContext(
                `Apply this change: "${opts.text}"`,
                { kind: editKind, id: opts.artifactId, version: current.version, state: currentSource } satisfies EditState,
                'structured-diff',
              ),
            },
            ...(attempt > 0
              ? [{ role: 'user' as const, content: `Your previous output failed validation: ${lastError}. Output ONLY the corrected ${skill.id} source.` }]
              : []),
          ],
          {
            maxTokens: 2048,
            signal: ctx.signal,
            temperature: 0.4,
            onDelta: (delta) => ctx.send('gen', { delta }),
          },
        ),
      );
      if (skill.id === 'mermaid') {
        const v = validateMermaid(emitted);
        okEmit = v.ok;
        lastError = v.ok ? '' : v.error;
      } else if (skill.id === 'svg') {
        emitted = extractSvg(emitted);
        const v = validateSvg(emitted);
        okEmit = v.ok;
        lastError = v.ok ? '' : v.error;
      } else {
        okEmit = emitted.length > 0;
        lastError = 'empty output';
      }
      if (!okEmit) logTo('pipeline', `${skill.id} edit repair attempt=${attempt + 1}: ${lastError}`);
    }
    if (!okEmit) throw new PipelineError(`${skill.id} edit failed validation twice: ${lastError}`);
    pushStep(ctx, { state: 'ok', label: `${model.name} · edit`, detail: 're-emitted · validated' });
    const checkLabel =
      skill.id === 'md' ? 'marked render (client)' : skill.id === 'mermaid' ? 'Syntax check' : 'XML + viewBox';
    pushStep(ctx, { state: 'ok', label: checkLabel });
    const newVer = current.version + 1;
    const dir = versionDir(opts.projectId, opts.artifactId, newVer);
    const outFile = path.join(dir, opts.artifactName);
    writeFileSync(outFile, emitted);
    const meta =
      skill.id === 'md'
        ? `${emitted.split('\n').length} lines`
        : skill.id === 'mermaid'
          ? `${emitted.split('\n')[0]?.split(/\s/)[0] ?? 'diagram'}`
          : 'validated SVG';
    const ver = await addVersion(opts.artifactId, {
      payload: { source: emitted },
      meta,
      validation: [{ state: 'ok', label: checkLabel }],
      filePath: outFile,
    });
    const summaryText = await summarize(ctx, `edited ${opts.artifactName} (${meta})`);
    const artifact = { artifactId: opts.artifactId, name: opts.artifactName, kind: skill.id, meta, ver };
    ctx.send('artifact', artifact);
    ctx.send('assistant_text', { text: summaryText });
    return finishPayload(ctx, 'Targeted edit · re-emitted', true, summaryText, artifact);
  }

  const model = officeModel();
  pushStep(ctx, { state: 'pending', label: `${model.name} · edit`, detail: 'constrained json_schema' });
  const system = `You are a document-editing backend. You produce ONLY a raw JSON object conforming exactly to the schema. No markdown, no prose.
SCHEMA (described): ${JSON.stringify(skill.schema)}
DESIGN GUIDANCE: ${skill.guidance}`;
  const user = injectEditContext(
    `Apply this change: "${opts.text}".`,
    { kind: editKind, id: opts.artifactId, version: current.version, state: current.payload } satisfies EditState,
    'full-state',
  );

  let edited: unknown;
  let lastError = '';
  let okEdit = false;
  for (let attempt = 0; attempt < 2 && !okEdit; attempt++) {
    const messages = [
      { role: 'system' as const, content: system },
      { role: 'user' as const, content: user },
      ...(attempt > 0
        ? [{ role: 'user' as const, content: `Your previous output failed validation: ${lastError}. Output ONLY corrected raw JSON matching the schema.` }]
        : []),
    ];
    ctx.send('gen', { reset: true, label: skill.id });
    // office path: Claude-gated + plain streaming, and the same 24k budget as
    // create — the edit path carried its own stale 3072 cap
    const raw = await completeJsonOffice(messages, skill.schema, {
      maxTokens: bedrock.officeMaxTokens(),
      signal: ctx.signal,
      onDelta: (delta) => ctx.send('gen', { delta }),
    });
    const result = validateJson(skill.id, skill.schema, raw);
    if (result.ok) {
      const extra =
        skill.id === 'react' || skill.id === 'site'
          ? validateFileMap(((result.value as Record<string, unknown>).files ?? {}) as Record<string, string>)
          : ({ ok: true } as const);
      if (extra.ok) {
        edited = result.value;
        okEdit = true;
      } else {
        lastError = extra.error;
        logTo('pipeline', `edit extra-validation attempt=${attempt + 1}: ${lastError}`);
      }
    } else {
      lastError = result.error;
      logTo('pipeline', `edit repair attempt=${attempt + 1}: ${lastError}`);
    }
  }
  if (!okEdit) throw new PipelineError(`edit failed schema validation twice: ${lastError}`);

  // §4.4 diff at top-level array-item granularity
  const arrayKey = ['slides', 'sections', 'sheets', 'pages', 'files'].find(
    (k) => Array.isArray((current.payload as Record<string, unknown>)[k]),
  );
  const changed: number[] = [];
  if (arrayKey) {
    const before = (current.payload as Record<string, unknown>)[arrayKey] as unknown[];
    const after = ((edited as Record<string, unknown>)[arrayKey] ?? []) as unknown[];
    const max = Math.max(before.length, after.length);
    for (let i = 0; i < max; i++) {
      if (JSON.stringify(before[i]) !== JSON.stringify(after[i])) changed.push(i);
    }
  }
  const unit = UNITS[skill.id] ?? 'items';
  pushStep(ctx, {
    state: 'ok',
    label: `${model.name} · edit`,
    detail: `constrained json_schema · ${changed.length} ${unit} changed`,
  });
  pushStep(ctx, {
    state: 'ok',
    label: 'Targeted edit',
    detail: `${unit}[${changed.join(',')}] regenerated · rest unchanged from v${current.version}`,
  });

  const newVer = current.version + 1;
  const dir = versionDir(opts.projectId, opts.artifactId, newVer);

  // file-map skills have no Python helper — persist files and re-check the entry
  if (skill.id === 'react' || skill.id === 'site') {
    const files = ((edited as Record<string, unknown>).files ?? {}) as Record<string, string>;
    const beforeFiles = ((current.payload as Record<string, unknown>).files ?? {}) as Record<string, string>;
    const changedFiles = [...new Set([...Object.keys(files), ...Object.keys(beforeFiles)])].filter(
      (k) => files[k] !== beforeFiles[k],
    );
    changed.length = 0;
    changed.push(...changedFiles.map((_, i) => i));
    writeVersionFiles(dir, files);
    const entry = skill.id === 'react' ? String((edited as Record<string, unknown>).entry ?? '/App.jsx') : '/index.html';
    const healedEdit = healEntryFile(files, entry);
    if (!healedEdit[entry]) throw new PipelineError(`entry file ${entry} missing from emitted files`);
    Object.assign(files, healedEdit);
    pushStep(ctx, { state: 'ok', label: 'Files persisted', detail: `${Object.keys(files).length} files · entry ${entry}` });
    const meta = `${Object.keys(files).length} files · bundled offline`;
    const ver = await addVersion(opts.artifactId, {
      payload: edited,
      meta,
      validation: [{ state: 'ok', label: 'Files persisted' }],
      filePath: dir,
    });
    const summaryText = await summarize(ctx, `targeted edit of ${opts.artifactName} — ${changed.length} files changed`);
    const artifact = { artifactId: opts.artifactId, name: opts.artifactName, kind: skill.id, meta, ver };
    ctx.send('artifact', artifact);
    ctx.send('assistant_text', { text: summaryText });
    return finishPayload(ctx, `Targeted edit · ${changed.length} files changed`, true, summaryText, artifact);
  }

  const outFile = path.join(dir, opts.artifactName);
  const helper = await runHelper(skill.id, edited, outFile);
  const blocked = helperChecksToSteps(ctx, helper.checks);
  if (blocked) {
    throw new PipelineError(
      `validation chain failed after edit: ${helper.checks.filter((c) => !c.ok).map((c) => c.label).join(', ')}`,
    );
  }
  const metaParts = Object.entries(helper.meta)
    .filter(([k]) => k !== 'bytes')
    .map(([k, v]) => `${v} ${k}`)
    .join(' · ');
  const checkSteps: CheckStep[] = helper.checks.map((c) => ({ state: c.ok ? 'ok' : 'warn', label: c.label }));
  const ver = await addVersion(opts.artifactId, { payload: edited, meta: metaParts, validation: checkSteps, filePath: outFile });
  const summaryText = await summarize(ctx, `targeted edit of ${opts.artifactName} — ${changed.length} ${unit} changed`);
  const artifact = { artifactId: opts.artifactId, name: opts.artifactName, kind: skill.id, meta: metaParts, ver };
  ctx.send('artifact', artifact);
  ctx.send('assistant_text', { text: summaryText });
  return finishPayload(ctx, `Targeted edit · ${changed.length} ${unit} changed`, true, summaryText, artifact);
}

/** §4.2 plain chat streaming (extracted from the route so pipeline and chat share). */
export async function* streamPlainChat(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  instructions: string,
  signal: AbortSignal,
): AsyncGenerator<string> {
  const PERSONA =
    'You are Axiom, a fully on-device AI assistant. You run entirely on this machine — nothing the user shares ever leaves it. ' +
    'You help with conversation, analysis, and (via your document pipeline) generating decks, documents, spreadsheets, PDFs, diagrams, and small app prototypes. ' +
    'Be direct, concise, and concrete.';
  const system = [PERSONA, instructions ? `Project instructions: ${instructions}` : '']
    .filter(Boolean)
    .join('\n\n');
  yield* streamChat([{ role: 'system', content: system }, ...history], { signal });
}
