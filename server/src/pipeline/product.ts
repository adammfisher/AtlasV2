import { readFileSync } from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../config.js';
import { newId, now, getSetting } from '../db/db.js';
import { listProductStates, addProductState, listProjectionsFor } from '../db/appdb.js';
import { completeJson } from '../llama/json.js';
import { logTo } from '../log.js';
import { validateJson } from './validate.js';
import type { CheckStep } from './artifacts.js';
import type { LoadedSkill } from './skills.js';

export const PRODUCT_STATES = ['proposed', 'endorsed', 'specified', 'built', 'operating'] as const;
export type ProductState = (typeof PRODUCT_STATES)[number];

const SPINE_SKIP = 'Spine check skipped — Knowledge Core not connected';
const COLLISION_SKIP = 'Collision check skipped — Knowledge Core not connected';
const DEPS_SKIP = 'Dependency check skipped — Knowledge Core not connected';

type Payload = Record<string, unknown>;

function arr(payload: Payload, key: string): unknown[] {
  const v = payload[key];
  return Array.isArray(v) ? v : [];
}

function str(payload: Payload, key: string): string {
  return typeof payload[key] === 'string' ? (payload[key] as string) : '';
}

/** A5 transition requirements, deterministic from the current payload. */
export function transitionRules(payload: Payload, hasBundle: boolean): Record<ProductState, string[]> {
  const unmet = (cond: boolean, label: string): string[] => (cond ? [] : [label]);
  return {
    proposed: [],
    endorsed: unmet(str(payload, 'benefit_hypothesis').length > 0, 'benefit_hypothesis non-empty'),
    specified: [
      ...unmet(arr(payload, 'capabilities').length >= 1, 'capabilities ≥1'),
      ...unmet(arr(payload, 'acceptance_criteria').length >= 1, 'acceptance_criteria ≥1'),
      ...unmet(arr(payload, 'kpis').length >= 1, 'kpis ≥1'),
    ],
    built: [
      ...unmet(
        arr(payload, 'decisions').length >= 1 || arr(payload, 'as_built').length >= 1,
        'decisions ≥1 or as_built ≥1',
      ),
      ...unmet(hasBundle, 'a bundle projection exists'),
    ],
    operating: [], // manual stamp; note required (enforced in route)
  };
}

export async function currentState(artifactId: string): Promise<ProductState> {
  const rows = await listProductStates(artifactId); // sk-ordered by created_at ascending
  const last = rows[rows.length - 1];
  return (last?.state as ProductState | undefined) ?? 'proposed';
}

export function nextState(state: ProductState): ProductState | null {
  const i = PRODUCT_STATES.indexOf(state);
  return i >= 0 && i < PRODUCT_STATES.length - 1 ? PRODUCT_STATES[i + 1] ?? null : null;
}

export async function stampState(
  artifactId: string,
  to: ProductState,
  note: string,
  atVersion: number,
  ambers: string[],
): Promise<void> {
  const fullNote = ambers.length > 0 ? `${note ? `${note} · ` : ''}ambers: ${ambers.join('; ')}` : note;
  await addProductState({
    id: newId('ps'),
    artifact_id: artifactId,
    state: to,
    note: fullNote,
    stamped_by: getSetting('userName') ?? 'user',
    at_version: atVersion,
    created_at: now(),
  });
}

/**
 * A4.3 product validation chain. KC-dependent checks degrade to amber with the
 * exact skip strings (the soffice pattern) — KC connects in Stage 4.
 */
/**
 * Amendment §A4.3/Stage-4: when Knowledge Core is connected the spine ref is
 * resolved live via org_get_entity; collisions checked via org_search; deps
 * traversed. KC absent keeps the exact skip-amber strings.
 */
export async function productChecks(
  payloadRaw: unknown,
  knownState: ProductState = 'proposed',
  projectId?: string,
): Promise<CheckStep[]> {
  const payload = payloadRaw as Payload;
  const checks: CheckStep[] = [{ state: 'ok', label: 'Schema', detail: 'constrained decoding + ajv re-validation' }];

  const targetState = nextState(knownState);
  if (targetState) {
    const missing = transitionRules(payload, false)[targetState]; // bundle existence resolved per-artifact in the state route
    checks.push(
      missing.length === 0
        ? { state: 'ok', label: `Completeness — next gate`, detail: `${targetState} requirements met` }
        : { state: 'warn', label: `Completeness — ${targetState} needs ${missing.join(', ')}` },
    );
  }

  const spine = (payload.spine ?? {}) as Record<string, unknown>;
  const ref = `${String(spine.lob ?? '?')}/${String(spine.domain ?? '?')}`;
  const deps = arr(payload, 'dependencies');

  const kc = projectId ? await kcClient(projectId) : null;
  if (!kc) {
    checks.push({ state: 'warn', label: SPINE_SKIP, detail: `spine: ${ref}` });
    checks.push({ state: 'warn', label: COLLISION_SKIP });
    if (deps.length > 0) checks.push({ state: 'warn', label: DEPS_SKIP, detail: `${deps.length} declared` });
    return checks;
  }

  try {
    const spineResult = await kc('org_get_entity', { ref });
    const found = /"found":\s*true/.test(spineResult);
    checks.push(
      found
        ? { state: 'ok', label: `Spine — ${ref}`, detail: 'resolved in Knowledge Core' }
        : { state: 'warn', label: `Spine — ${ref} not found` },
    );
  } catch {
    checks.push({ state: 'warn', label: SPINE_SKIP, detail: `spine: ${ref}` });
  }

  try {
    const name = String((payload as Record<string, unknown>).name ?? '');
    const collision = await kc('org_search', { query: name });
    checks.push({
      state: 'ok',
      label: 'Collision check',
      detail: collision.includes('[') ? 'similar items reviewed' : 'no overlaps found',
    });
  } catch {
    checks.push({ state: 'warn', label: COLLISION_SKIP });
  }

  if (deps.length > 0) {
    try {
      await kc('org_traverse', { from: ref });
      checks.push({ state: 'ok', label: 'Dependencies', detail: `${deps.length} declared · traversed` });
    } catch {
      checks.push({ state: 'warn', label: DEPS_SKIP, detail: `${deps.length} declared` });
    }
  }
  return checks;
}

/** Returns a call helper when the knowledge-core connector is connected + enabled in the project. */
async function kcClient(projectId: string): Promise<((tool: string, args: Record<string, unknown>) => Promise<string>) | null> {
  const { installFor, callTool } = await import('../mcp/manager.js');
  const install = await installFor('knowledge-core');
  if (!install || install.status !== 'connected') return null;
  const enabled = JSON.parse(install.enabled_projects) as string[];
  if (!enabled.includes(projectId)) return null;
  return (tool, args) => callTool('knowledge-core', projectId, tool, args);
}


export async function hasBundleRow(artifactId: string): Promise<boolean> {
  const rows = await listProjectionsFor(artifactId);
  return rows.some((r) => r.kind === 'bundle');
}

/** Top-level property names of the product schema, for the A4.2 field router. */
function productFieldNames(): string[] {
  const schema = JSON.parse(
    readFileSync(path.join(repoRoot, 'skills/product/schema.json'), 'utf8'),
  ) as { properties: Record<string, unknown> };
  return Object.keys(schema.properties);
}

const APPEND_FIELDS = new Set(['decisions', 'as_built']);

/**
 * A4.2 field-scoped product edit: field router names ≤3 touched fields, then a
 * per-field constrained call edits each. The server merges — untouched fields
 * are byte-identical by construction.
 */
export async function mergeProductEdit(
  skill: LoadedSkill,
  current: Record<string, unknown>,
  instruction: string,
  signal: AbortSignal,
  onStep: (step: CheckStep) => void,
): Promise<{ merged: Record<string, unknown>; fields: string[] }> {
  const names = productFieldNames();
  const routerSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['fields'],
    properties: {
      fields: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'string', enum: names } },
    },
  };
  onStep({ state: 'pending', label: 'Field router', detail: 'naming touched fields' });
  const rawRoute = await completeJson(
    [
      {
        role: 'system',
        content:
          'You are a field router for product-definition edits. Output ONLY raw JSON naming which top-level fields the edit instruction touches (1-3 fields).',
      },
      { role: 'user', content: `Fields: ${names.join(', ')}\nEdit instruction: ${instruction}` },
    ],
    routerSchema,
    { maxTokens: 192, signal }, // headroom for stray reasoning tokens (same as §4.1 router)
  );
  let fields: string[];
  try {
    fields = (JSON.parse(rawRoute) as { fields: string[] }).fields.filter((f) => names.includes(f));
  } catch {
    throw new Error('field router emitted invalid JSON');
  }
  if (fields.length === 0) throw new Error('field router named no editable fields');
  onStep({ state: 'ok', label: 'Field router', detail: fields.join(', ') });

  const fullSchema = skill.schema as { properties: Record<string, unknown> };
  const merged: Record<string, unknown> = { ...current };

  for (const field of fields) {
    const slice = {
      type: 'object',
      additionalProperties: false,
      required: [field],
      properties: { [field]: fullSchema.properties[field] },
    };
    onStep({ state: 'pending', label: `Edit · ${field}`, detail: 'constrained to field slice' });
    const isAppend = APPEND_FIELDS.has(field);
    const raw = await completeJson(
      [
        {
          role: 'system',
          content: `You edit ONE field of a product definition. Output ONLY raw JSON of shape {"${field}": …} conforming to the schema.${
            isAppend
              ? ` ${field} is append-only: output ONLY the NEW entries to append, never existing ones, and never invent entries the user did not supply.`
              : ''
          }`,
        },
        {
          role: 'user',
          content: `Current value of ${field}: ${JSON.stringify(current[field] ?? null)}\nEdit instruction: ${instruction}`,
        },
      ],
      slice,
      { maxTokens: 2048, signal },
    );
    const result = validateJson(`product:${field}`, slice, raw);
    if (!result.ok) {
      logTo('pipeline', `product field edit ${field} invalid: ${result.error}`);
      throw new Error(`field edit for ${field} failed validation: ${result.error}`);
    }
    const value = (result.value as Record<string, unknown>)[field];
    if (isAppend) {
      const existing = Array.isArray(current[field]) ? (current[field] as unknown[]) : [];
      merged[field] = [...existing, ...(Array.isArray(value) ? value : [])];
    } else {
      merged[field] = value;
    }
    onStep({ state: 'ok', label: `Edit · ${field}`, detail: isAppend ? 'appended' : 'replaced' });
  }

  // merge assertion (Amendment §A4.2): untouched fields byte-identical by construction
  for (const key of Object.keys(merged)) {
    if (!fields.includes(key) && JSON.stringify(merged[key]) !== JSON.stringify(current[key])) {
      throw new Error(`merge assertion failed: untouched field ${key} changed`);
    }
  }
  onStep({ state: 'ok', label: 'Merge assertion', detail: 'untouched fields byte-identical' });
  return { merged, fields };
}
