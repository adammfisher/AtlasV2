import { getDb, getSetting, setSetting, now } from './db.js';
import { config } from '../config.js';
import { log } from '../log.js';

/** Mockup-parity first-boot fixtures (PRD §7). */
export function seedIfNeeded(): void {
  if (getSetting('seeded') === '1') return;
  const db = getDb();
  const t = now();

  const seed = db.transaction(() => {
    const insProject = db.prepare(
      'INSERT INTO projects (id, name, instructions, created_at) VALUES (?, ?, ?, ?)',
    );
    insProject.run(
      'p1',
      'Lightspeed Atlas',
      'Core product build. Prefer the Meridian brand templates. Keep all output in outputs/meridian/.',
      t,
    );
    insProject.run(
      'p2',
      'Client Redline',
      'Confidential contract work. Tracked changes only — never accept changes silently.',
      t,
    );
    insProject.run(
      'p3',
      'Org Intel Dev',
      'atlas-org-intel build sessions. Mirror Atlas stack choices: better-sqlite3, sqlite-vec, nomic-embed.',
      t,
    );

    const insConv = db.prepare(
      'INSERT INTO conversations (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    );
    const convs: Array<[string, string, string]> = [
      ['c1', 'p1', 'Q3 QBR deck from pipeline data'],
      ['c2', 'p3', 'Schema alignment — AOI parser'],
      ['c3', 'p1', 'Template Library: Meridian potx audit'],
      ['c4', 'p1', 'xlsx recalc fallback design'],
      ['c5', 'p3', 'Org-intel phase 2 handoff'],
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
        text: 'Build the Q3 QBR deck for Meridian from the pipeline numbers in /reports/q3 — use the client template.',
      }),
      t - 300_000,
    );
    insMsg.run(
      'm2',
      'c1',
      'assistant',
      'pipeline',
      JSON.stringify({
        stage: 3,
        skill: 'pptx',
        modelChip: 'Gemma 4 12B · constrained JSON',
        skillChip: 'Presentations skill · 4.2k tokens',
        extraChip: 'QBR_Master.potx',
        steps: [
          'slides JSON emitted — 9 slides, schema-valid first pass',
          '14 placeholders filled on QBR_Master.potx',
          'wrote outputs/meridian/Q3_QBR_Meridian.pptx',
        ],
        checks: [
          ['OOXML schema', 1],
          ['Round-trip', 1],
          ['Placeholders clean', 1],
          ['Recalc skipped — soffice not found', 0],
        ],
        artifact: {
          artifactId: 'a1',
          name: 'Q3_QBR_Meridian.pptx',
          kind: 'pptx',
          meta: '9 slides · 1.8 MB',
          ver: 1,
        },
        text: 'Built the Q3 QBR from pipeline_summary.xlsx — nine slides on the Meridian master, including the win-rate trend and the pipeline-by-stage waterfall.',
      }),
      t - 290_000,
    );
    insMsg.run(
      'm3',
      'c1',
      'user',
      'text',
      JSON.stringify({ text: 'Make slide 3 punchier and turn the win-rate table into a chart.' }),
      t - 280_000,
    );
    insMsg.run(
      'm4',
      'c1',
      'assistant',
      'pipeline',
      JSON.stringify({
        stage: 3,
        skill: 'pptx',
        edit: true,
        modelChip: 'Gemma 4 12B · constrained JSON',
        skillChip: 'Targeted edit · slides[2] only',
        steps: ['slides[2] regenerated — rest byte-identical'],
        checks: [
          ['OOXML schema', 1],
          ['Chart series bound', 1],
        ],
        artifact: {
          artifactId: 'a1',
          name: 'Q3_QBR_Meridian.pptx',
          kind: 'pptx',
          meta: '9 slides · 1.8 MB',
          ver: 2,
        },
        text: 'Rewrote the headline to lead with the number — “Win rate up 9 points in two quarters” — and swapped the table for a line chart bound to the same series. Only slide 3 was regenerated; the rest of the deck is byte-identical to v1.',
      }),
      t - 270_000,
    );

    const insArtifact = db.prepare(
      'INSERT INTO artifacts (id, project_id, name, kind, current_version, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    );
    const insVersion = db.prepare(
      'INSERT INTO artifact_versions (id, artifact_id, version, file_path, meta, validation, payload, created_at) VALUES (?, ?, ?, NULL, ?, ?, NULL, ?)',
    );
    const validation = JSON.stringify([
      ['Schema valid', 1],
      ['Round-trip', 1],
    ]);
    const artifacts: Array<[string, string, string, string, number, string]> = [
      ['a1', 'p1', 'Q3_QBR_Meridian.pptx', 'pptx', 2, '9 slides · 1.8 MB'],
      ['a2', 'p2', 'MSA_section7_redline.docx', 'docx', 4, 'Tracked changes · 22 pages'],
      ['a3', 'p1', 'pipeline_forecast.xlsx', 'xlsx', 1, '3 sheets · recalc pending'],
      ['a4', 'p3', 'org-intel-landing', 'site', 3, '4 files · bundled offline'],
    ];
    for (const [id, projectId, name, kind, ver, meta] of artifacts) {
      insArtifact.run(id, projectId, name, kind, ver, t);
      for (let v = 1; v <= ver; v++) {
        insVersion.run(`${id}_v${v}`, id, v, meta, validation, t - (ver - v) * 60_000);
      }
    }

    const insSkill = db.prepare('INSERT INTO skills_state (skill_id, enabled) VALUES (?, 1)');
    for (const id of ['pptx', 'docx', 'xlsx', 'pdf', 'md', 'mermaid', 'svg', 'react', 'site']) {
      insSkill.run(id);
    }

    const insPlugin = db.prepare(
      "INSERT INTO plugin_installs (id, connector_id, source, status, enabled_projects, created_at) VALUES (?, ?, 'bundled', 'connected', ?, ?)",
    );
    insPlugin.run('pi_filesystem', 'filesystem', JSON.stringify(['p1', 'p2']), t);
    insPlugin.run('pi_memory', 'memory', JSON.stringify(['p1', 'p2', 'p3']), t);
    insPlugin.run('pi_sqlite', 'sqlite', JSON.stringify(['p3']), t);

    setSetting('activeProjectId', 'p1');
    setSetting('selectedModel', 'e4b');
    setSetting('userName', config.userName);
    setSetting('seeded', '1');
  });
  seed();
  log('seeded first-boot fixtures');
}
