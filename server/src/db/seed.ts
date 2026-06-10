import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { getDb, getSetting, setSetting, now } from './db.js';
import { config, repoRoot } from '../config.js';
import { log } from '../log.js';

/** Mockup-parity first-boot fixtures (reference/atlas-v2-ui.jsx). */
export function seedIfNeeded(): void {
  if (getSetting('seeded') === '2') return;
  const db = getDb();
  const t = now();

  const seed = db.transaction(() => {
    const insProject = db.prepare(
      'INSERT INTO projects (id, name, instructions, created_at, settings) VALUES (?, ?, ?, ?, ?)',
    );
    insProject.run(
      'p1',
      'Lightspeed Atlas',
      'Enterprise rollout workspace. Prefer Lightspeed deck template; cite Jira keys.',
      t,
      '{}',
    );
    insProject.run(
      'p2',
      'Client Alpha — QBR',
      'Confidential. Hard isolation; never reference other client work.',
      t,
      '{}',
    );
    insProject.run(
      'p3',
      'Internal Ops',
      'Ops runbooks and weekly reporting.',
      t,
      JSON.stringify({ shared: true }),
    );

    const insConv = db.prepare(
      'INSERT INTO conversations (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    );
    const convs: Array<[string, string, string]> = [
      ['c1', 'p1', 'Q3 business review deck'],
      ['c2', 'p1', 'Office pipeline validation gates'],
      ['c3', 'p1', 'Knowledge Core connector spec'],
      ['c4', 'p2', 'Budget model — FY27 scenarios'],
      ['c5', 'p2', 'Redline: MSA section 4.2'],
      ['c6', 'p3', 'Onboarding site preview build'],
      ['c7', 'p3', 'Org chart traversal queries'],
    ];
    convs.forEach(([id, projectId, title], i) => {
      insConv.run(id, projectId, title, t - (i + 1) * 60_000, t - (i + 1) * 60_000);
    });

    const insMsg = db.prepare(
      'INSERT INTO messages (id, conversation_id, role, kind, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    insMsg.run(
      'm1',
      'c1',
      'user',
      'text',
      JSON.stringify({
        text: 'Create a Q3 business review deck from the project metrics — use the Lightspeed template.',
      }),
      t - 300_000,
    );
    insMsg.run(
      'm2',
      'c1',
      'assistant',
      'pipeline',
      JSON.stringify({
        skill: 'pptx',
        skillBadge: 'pptx skill',
        duration: '11.8s',
        steps: [
          { state: 'ok', label: 'Router · Gemma 4 E2B', detail: 'intent: create_doc · skill: pptx · 12 ms' },
          { state: 'ok', label: 'Skill loaded', detail: 'pptx playbook · 4.2k tokens' },
          { state: 'ok', label: 'Template', detail: 'Lightspeed — Client Deck.potx · 14 placeholders' },
          { state: 'ok', label: 'Gemma 4 12B · slide JSON', detail: 'constrained json_schema · valid first pass' },
          { state: 'ok', label: 'build_pptx.py', detail: '12 slides filled' },
          { state: 'ok', label: 'openxml-audit · round-trip · placeholder grep', detail: 'all clean' },
          { state: 'warn', label: 'soffice recalc', detail: 'skipped — LibreOffice not present on this machine' },
        ],
        text: "Here's the Q3 review deck — 12 slides on the Lightspeed template, with the revenue and pipeline charts built from the project metrics file. Formatting, theme colors, and the master come straight from the template; I only filled placeholders.",
        artifact: {
          artifactId: 'a1',
          name: 'Q3-Business-Review.pptx',
          kind: 'pptx',
          meta: '12 slides · Lightspeed template · v1',
          ver: 1,
        },
      }),
      t - 290_000,
    );
    insMsg.run(
      'm3',
      'c1',
      'user',
      'text',
      JSON.stringify({ text: 'Make the win-rate slide punchier.' }),
      t - 280_000,
    );
    insMsg.run(
      'm4',
      'c1',
      'assistant',
      'pipeline',
      JSON.stringify({
        skill: 'pptx',
        edit: true,
        steps: [
          { state: 'ok', label: 'Targeted edit', detail: 'slides[4] regenerated only · re-validated · v2' },
        ],
        text: 'Tightened it to one headline stat — win rate up 9 points — with a single supporting bar pair and a one-line takeaway. The rest of the deck is untouched.',
        artifact: {
          artifactId: 'a1',
          name: 'Q3-Business-Review.pptx',
          kind: 'pptx',
          meta: '12 slides · Lightspeed template · v2',
          ver: 2,
        },
      }),
      t - 270_000,
    );

    db.prepare(
      'INSERT INTO artifacts (id, project_id, name, kind, current_version, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('a1', 'p1', 'Q3-Business-Review.pptx', 'pptx', 2, t);
    const insVersion = db.prepare(
      'INSERT INTO artifact_versions (id, artifact_id, version, file_path, meta, validation, payload, created_at) VALUES (?, ?, ?, NULL, ?, ?, NULL, ?)',
    );
    const validation = JSON.stringify([
      { state: 'ok', label: 'openxml-audit', detail: 'schema-valid' },
      { state: 'ok', label: 'python-pptx round-trip', detail: '12 slides · text intact' },
      { state: 'ok', label: 'Placeholder grep', detail: 'no leftover {{ }} tags' },
      { state: 'warn', label: 'soffice recalc / thumbnails', detail: 'skipped — not installed' },
    ]);
    insVersion.run('a1_v1', 'a1', 1, '12 slides · Lightspeed template · v1', validation, t - 290_000);
    insVersion.run('a1_v2', 'a1', 2, '12 slides · Lightspeed template · v2', validation, t - 270_000);

    const insSkill = db.prepare(
      'INSERT OR REPLACE INTO skills_state (skill_id, enabled) VALUES (?, 1)',
    );
    for (const id of ['pptx', 'docx', 'xlsx', 'pdf', 'md', 'mermaid', 'svg', 'react', 'site']) {
      insSkill.run(id);
    }

    const insPlugin = db.prepare(
      "INSERT INTO plugin_installs (id, connector_id, source, status, enabled_projects, created_at) VALUES (?, ?, ?, 'installed', ?, ?)",
    );
    insPlugin.run('pi_filesystem', 'filesystem', 'bundled', JSON.stringify(['p1', 'p2', 'p3']), t);
    insPlugin.run('pi_atlas-memory', 'atlas-memory', 'bundled', JSON.stringify(['p1', 'p2', 'p3']), t);
    insPlugin.run('pi_github', 'github', 'directory', JSON.stringify([]), t);

    setSetting('activeProjectId', 'p1');
    setSetting('selectedModel', 'auto');
    setSetting('userName', config.userName);
    setSetting('seeded', '2');
  });
  seed();
  log('seeded first-boot fixtures (atlas-v2-ui)');
}

/**
 * PRD §7: the QBR seed artifact gets a real generated file at seed time so
 * downloads work. Runs at boot whenever a1's file is missing and the Python
 * toolchain exists (i.e. after bootstrap-python.sh); logged honestly when
 * skipped.
 */
export function backfillSeedArtifactFiles(): void {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT a.project_id, v.file_path FROM artifacts a JOIN artifact_versions v ON v.artifact_id = a.id WHERE a.id = 'a1' AND v.version = 1",
    )
    .get() as { project_id: string; file_path: string | null } | undefined;
  if (!row || (row.file_path && existsSync(row.file_path))) return;
  const python = path.join(repoRoot, 'runtimes/python/venv/bin/python');
  if (!existsSync(python)) {
    log('seed artifact backfill skipped — run scripts/dev/bootstrap-python.sh first');
    return;
  }
  try {
    execFileSync('npx', ['tsx', 'scripts/dev/backfill-seed-artifact.ts'], {
      cwd: repoRoot,
      timeout: 300_000,
      stdio: 'ignore',
    });
    log('seed artifact files backfilled (Q3-Business-Review.pptx v1+v2)');
  } catch (err) {
    log(`seed artifact backfill failed: ${err instanceof Error ? err.message : err}`);
  }
}
