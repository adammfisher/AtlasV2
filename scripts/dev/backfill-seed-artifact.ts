/**
 * Build real files for the seeded Q3-Business-Review.pptx artifact (PRD §7:
 * "the QBR pptx seed artifact gets a real generated file at seed time").
 * Deterministic payloads — v1 and the targeted-edit v2.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getDb } from '../../server/src/db/db.js';
import { config, repoRoot } from '../../server/src/config.js';

export const QBR_V1 = {
  title: 'Q3 Business Review',
  slides: [
    { layout: 'title', heading: 'Q3 Business Review', bullets: ['Lightspeed Axiom · enterprise rollout'] },
    { layout: 'bullets', heading: 'Executive summary', bullets: ['Revenue 4.2M vs 3.8M plan', 'Win rate up 9 points to 31%', 'Pipeline coverage 2.8x', '12 enterprise teams onboarded'] },
    {
      layout: 'chart', heading: 'Revenue vs plan',
      chart: { kind: 'bar', labels: ['Q1', 'Q2', 'Q3'], series: [{ name: 'Plan', values: [3.2, 3.5, 3.8] }, { name: 'Actual', values: [3.1, 3.7, 4.2] }] },
    },
    { layout: 'two_col', heading: 'Pipeline by segment', col_left: ['Enterprise: 14 deals · 6.1M', 'Mid-market: 22 deals · 3.4M'], col_right: ['SMB: 31 deals · 1.2M', 'Partner-sourced: 9 deals · 2.0M'] },
    { layout: 'bullets', heading: 'Win rate', bullets: ['31% trailing quarter', 'Up 9 points in two quarters', 'Driven by faster security review'] },
    { layout: 'summary', heading: 'Risks & asks', bullets: ['Renewal concentration in top 3 accounts', 'Ask: budget for 2 SEs in Q4'] },
  ],
};

export const QBR_V2 = {
  ...QBR_V1,
  slides: QBR_V1.slides.map((s, i) =>
    i === 4
      ? { layout: 'chart' as const, heading: 'Win rate up 9 points in two quarters', chart: { kind: 'line' as const, labels: ['Q1', 'Q2', 'Q3'], series: [{ name: 'Win rate %', values: [22, 27, 31] }] } }
      : s,
  ),
};

function build(payload: unknown, outFile: string): void {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'axiom-seed-'));
  const payloadFile = path.join(tmp, 'payload.json');
  writeFileSync(payloadFile, JSON.stringify(payload));
  mkdirSync(path.dirname(outFile), { recursive: true });
  const out = execFileSync(
    path.join(repoRoot, 'runtimes/python/venv/bin/python'),
    [
      path.join(repoRoot, 'scripts/office/build_pptx.py'),
      '--payload', payloadFile,
      '--out', outFile,
      '--template', path.join(repoRoot, 'skills/pptx/templates/axiom_default.potx'),
    ],
    { cwd: repoRoot, encoding: 'utf8', timeout: 180_000 },
  );
  const result = JSON.parse(out.trim().split('\n').pop() ?? '{}') as { ok?: boolean };
  if (!result.ok) throw new Error(`seed build failed: ${out}`);
  rmSync(tmp, { recursive: true, force: true });
}

function main(): void {
  const db = getDb();
  const art = db.prepare("SELECT id, project_id FROM artifacts WHERE id = 'a1'").get() as
    | { id: string; project_id: string }
    | undefined;
  if (!art) {
    console.log('seed artifact a1 not present — nothing to backfill');
    return;
  }
  for (const [version, payload] of [[1, QBR_V1], [2, QBR_V2]] as const) {
    const dir = path.join(config.dataDir, 'artifacts', art.project_id, art.id, `v${version}`);
    const file = path.join(dir, 'Q3-Business-Review.pptx');
    build(payload, file);
    db.prepare('UPDATE artifact_versions SET file_path = ?, payload = ? WHERE artifact_id = ? AND version = ?').run(
      file,
      JSON.stringify(payload),
      art.id,
      version,
    );
    console.log(`backfilled a1 v${version}: ${file}`);
  }
}

main();
