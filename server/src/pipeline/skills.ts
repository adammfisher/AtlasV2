import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../config.js';
import { skillEnabledStates } from '../db/appdb.js';

export const JSON_SKILLS = ['pptx', 'docx', 'xlsx', 'pdf', 'react', 'site', 'product'] as const;
export const TEXT_SKILLS = ['md', 'mermaid', 'svg'] as const;
export const ALL_SKILLS = [...JSON_SKILLS, ...TEXT_SKILLS] as const;
export type SkillId = (typeof ALL_SKILLS)[number];

export interface LoadedSkill {
  id: SkillId;
  name: string;
  ext: string;
  helper: string;
  /** design-guidance body of SKILL.md (frontmatter stripped) */
  guidance: string;
  /** parsed schema.json — null for direct-emission skills */
  schema: Record<string, unknown> | null;
}

const cache = new Map<string, LoadedSkill>();

export function isSkillId(value: string): value is SkillId {
  return (ALL_SKILLS as readonly string[]).includes(value);
}

export function loadSkill(id: SkillId): LoadedSkill {
  const hit = cache.get(id);
  if (hit) return hit;
  const dir = path.join(repoRoot, 'skills', id);
  const raw = readFileSync(path.join(dir, 'SKILL.md'), 'utf8');
  const fm = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
  const front = new Map(
    (fm?.[1] ?? '')
      .split('\n')
      .map((line) => line.split(/:\s(.*)/))
      .filter((kv) => kv.length >= 2)
      .map((kv) => [kv[0]?.trim() ?? '', kv[1]?.trim() ?? '']),
  );
  const schemaRaw = JSON.parse(readFileSync(path.join(dir, 'schema.json'), 'utf8')) as Record<
    string,
    unknown
  >;
  const skill: LoadedSkill = {
    id,
    name: front.get('name') ?? id,
    ext: front.get('ext') ?? id,
    helper: front.get('helper') ?? '',
    guidance: (fm?.[2] ?? raw).trim(),
    schema: schemaRaw.emit === 'text' ? null : schemaRaw,
  };
  cache.set(id, skill);
  return skill;
}

export async function skillEnabled(id: SkillId): Promise<boolean> {
  const states = await skillEnabledStates();
  const enabled = states[id];
  return enabled === undefined ? true : enabled === 1;
}

export function templatePath(id: SkillId): string | null {
  // branded templates (e.g. the stripped DFS library) take precedence over the
  // generated Axiom defaults
  const candidates: Record<string, string[]> = {
    pptx: ['skills/pptx/templates/dfs_default.potx', 'skills/pptx/templates/axiom_default.potx'],
    docx: ['skills/docx/templates/axiom_default.dotx'],
  };
  for (const rel of candidates[id] ?? []) {
    const full = path.join(repoRoot, rel);
    if (existsSync(full)) return full;
  }
  return null;
}
