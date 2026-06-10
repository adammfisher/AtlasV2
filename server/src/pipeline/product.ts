import { readFileSync } from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../config.js';
import { getDb, newId, now, getSetting } from '../db/db.js';
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

export function currentState(artifactId: string): ProductState {
  const row = getDb()
    .prepare('SELECT state FROM product_states WHERE artifact_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(artifactId) as { state: ProductState } | undefined;
  return row?.state ?? 'proposed';
}

export function nextState(state: ProductState): ProductState | null {
  const i = PRODUCT_STATES.indexOf(state);
  return i >= 0 && i < PRODUCT_STATES.length - 1 ? PRODUCT_STATES[i + 1] ?? null : null;
}

export function stampState(
  artifactId: string,
  to: ProductState,
  note: string,
  atVersion: number,
  ambers: string[],
): void {
  const fullNote = ambers.length > 0 ? `${note ? `${note} · ` : ''}ambers: ${ambers.join('; ')}` : note;
  getDb()
    .prepare(
      'INSERT INTO product_states (id, artifact_id, state, note, stamped_by, at_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(newId('ps'), artifactId, to, fullNote, getSetting('userName') ?? 'user', atVersion, now());
}

/**
 * A4.3 product validation chain. KC-dependent checks degrade to amber with the
 * exact skip strings (the soffice pattern) — KC connects in Stage 4.
 */
export function productChecks(payloadRaw: unknown, knownState: ProductState = 'proposed'): CheckStep[] {
  const payload = payloadRaw as Payload;
  const checks: CheckStep[] = [{ state: 'ok', label: 'Schema', detail: 'constrained decoding + ajv re-validation' }];

  const targetState = nextState(knownState);
  if (targetState) {
    const missing = transitionRules(payload, hasBundleProjection(payload))[targetState];
    checks.push(
      missing.length === 0
        ? { state: 'ok', label: `Completeness — next gate`, detail: `${targetState} requirements met` }
        : { state: 'warn', label: `Completeness — ${targetState} needs ${missing.join(', ')}` },
    );
  }

  const spine = (payload.spine ?? {}) as Record<string, unknown>;
  checks.push({
    state: 'warn',
    label: SPINE_SKIP,
    detail: `spine: ${String(spine.lob ?? '?')}/${String(spine.domain ?? '?')}`,
  });
  checks.push({ state: 'warn', label: COLLISION_SKIP });
  const deps = arr(payload, 'dependencies');
  if (deps.length > 0) {
    checks.push({ state: 'warn', label: DEPS_SKIP, detail: `${deps.length} declared` });
  }
  return checks;
}

function hasBundleProjection(_payload: Payload): boolean {
  return false; // resolved per-artifact in the state route, where the artifact id is known
}

export function hasBundleRow(artifactId: string): boolean {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM projections WHERE artifact_id = ? AND kind = 'bundle'")
    .get(artifactId) as { n: number };
  return row.n > 0;
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
    { maxTokens: 64, signal },
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
