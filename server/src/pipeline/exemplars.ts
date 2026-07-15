/**
 * Archetype exemplar retrieval — TypeScript mirror of
 * scripts/office/exemplar_engine.py over the same dfs_exemplars.json.
 * The app server assembles generation prompts (and ships no Python), so
 * retrieval runs here; the Python module stays canonical for tests/tooling.
 * Scoring must stay in lockstep: tag-token overlap ×2 + shape-hint hits,
 * archetype-diverse pick, deterministic tiebreak by id.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../config.js';

interface Exemplar {
  id: string;
  archetype: string;
  tags: string[];
  why_good: string;
  spec: Record<string, unknown>;
}

const STOP = new Set(
  'a an and are as at be by for from has have how in is it of on or our the this that to was we what which with your make makes made get give show me my'.split(' '),
);

const SHAPE_HINTS: Record<string, string[]> = {
  content_chart: ['chart', 'graph', 'trend', 'over time', 'monthly', 'quarterly', 'growth', 'revenue', 'funnel', 'metrics'],
  big_stat: ['metric', 'kpi', 'number', 'record', 'milestone', 'headline', 'roi', 'savings'],
  comparison: ['versus', 'vs', 'compare', 'comparison', 'competitor', 'options', 'pros', 'cons', 'before', 'after'],
  timeline_process: ['timeline', 'roadmap', 'phases', 'steps', 'plan', 'rollout', 'launch', 'process', 'sequence'],
  table: ['table', 'dashboard', 'exact', 'targets', 'actuals', 'breakdown'],
  quote: ['quote', 'testimonial', 'customer said', 'voice', 'feedback'],
  two_column: ['screenshot', 'feature', 'side by side', 'narrative'],
  content_bullets: ['points', 'reasons', 'findings', 'drivers', 'risks', 'summary'],
  section_divider: ['sections', 'parts', 'chapters'],
  agenda: ['agenda', 'overview'],
  title: ['deck', 'presentation', 'review', 'pitch'],
  closing_cta: ['ask', 'decision', 'next steps', 'closing'],
};

let cached: Exemplar[] | null = null;

function loadExemplars(): Exemplar[] {
  if (cached) return cached;
  const manifest = JSON.parse(
    readFileSync(path.join(repoRoot, 'skills/pptx/templates/dfs_exemplars.json'), 'utf8'),
  ) as { exemplars: Exemplar[] };
  cached = manifest.exemplars;
  return cached;
}

function tokens(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-z0-9%$]+/g) ?? []).filter((t) => !STOP.has(t)));
}

export function retrieveExemplars(requestText: string, k = 3): Exemplar[] {
  const reqTokens = tokens(requestText);
  const low = requestText.toLowerCase();
  const scored = loadExemplars()
    .map((exemplar) => {
      const tagHits = exemplar.tags.filter((tag) => [...tokens(tag)].some((t) => reqTokens.has(t))).length;
      const hintHits = (SHAPE_HINTS[exemplar.archetype] ?? []).filter((hint) => low.includes(hint)).length;
      return { score: tagHits * 2 + hintHits, exemplar };
    })
    .sort((a, b) => b.score - a.score || a.exemplar.id.localeCompare(b.exemplar.id));

  const picked: Exemplar[] = [];
  const seen = new Set<string>();
  for (const { score, exemplar } of scored) {
    if (score > 0 && !seen.has(exemplar.archetype)) {
      picked.push(exemplar);
      seen.add(exemplar.archetype);
    }
    if (picked.length === k) return picked;
  }
  for (const { exemplar } of scored) {
    if (!picked.includes(exemplar)) picked.push(exemplar);
    if (picked.length === k) break;
  }
  return picked;
}

/** Prompt block: archetype + the why + the compact spec, per exemplar. */
export function formatExemplars(exemplars: Exemplar[]): string {
  return exemplars
    .map((e) => `### ${e.archetype} — ${e.why_good}\n${JSON.stringify(e.spec)}`)
    .join('\n');
}
