import { test, expect } from '@playwright/test';
import { writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { api } from './helpers';
import { runAsAccount } from '../../server/src/lib/account.js';
import { putArtifact, putVersion, getArtifactRow, deleteArtifact } from '../../server/src/db/appdb.js';
import { versionDir } from '../../server/src/pipeline/artifacts.js';
import { mirrorArtifactPath, deleteArtifactObjects } from '../../server/src/storage/artifacts-s3.js';
import { newId, now } from '../../server/src/db/db.js';

/**
 * Gallery multi-select bulk delete (Edit → select → Delete), asserting the DB +
 * S3 both empty and — critically — that select-all is scoped to the active
 * filter so it can never sweep the account's real artifacts.
 *
 * Fixtures are seeded straight into DynamoDB + S3 under a throwaway kind (no
 * generation pipeline, so the test stays fast and deterministic) and torn down
 * in afterAll even if the body fails.
 */
const KIND = 'e2ebulk';
const PROJECT = 'p-e2e-bulk';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const primaryUser = (
  JSON.parse(readFileSync(path.join(repoRoot, 'users.config.json'), 'utf8')) as { users: Array<{ username: string }> }
).users[0]!.username;

const asPrimary = <T>(fn: () => Promise<T>): Promise<T> =>
  new Promise((resolve, reject) => runAsAccount(primaryUser, () => void fn().then(resolve, reject)));

const seededIds: string[] = [];

async function seed(name: string, versions: number): Promise<string> {
  return asPrimary(async () => {
    const id = newId('a');
    await putArtifact({ id, project_id: PROJECT, name, kind: KIND, current_version: versions, created_at: now() });
    for (let v = 1; v <= versions; v++) {
      const file = path.join(versionDir(PROJECT, id, v), `${name}.md`);
      writeFileSync(file, `# ${name} v${v}\n`);
      await putVersion({ id: newId('av'), artifact_id: id, version: v, file_path: file, meta: 'e2e fixture', validation: '[]', payload: '{}', created_at: now() });
      await mirrorArtifactPath(file);
    }
    seededIds.push(id);
    return id;
  });
}

test.describe('artifacts bulk delete @fast', () => {
  test.beforeAll(async () => {
    // one multi-version artifact proves every version's S3 objects are swept
    await seed('e2e-bulk-alpha', 2);
    await seed('e2e-bulk-beta', 1);
    await seed('e2e-bulk-gamma', 1);
  });

  test.afterAll(async () => {
    // safety net: purge anything the UI didn't (a failed run leaves fixtures)
    await asPrimary(async () => {
      for (const id of seededIds) {
        const row = await getArtifactRow(id);
        if (!row) continue;
        await deleteArtifactObjects(row.project_id, id);
        await deleteArtifact(id);
      }
    });
  });

  test('Edit → Select all (filtered) → Delete removes rows, versions, and S3 — nothing else', async ({ page }) => {
    const before = await api<Array<{ id: string; kind: string }>>('/artifacts');
    const fixtures = before.filter((a) => a.kind === KIND);
    const others = before.filter((a) => a.kind !== KIND);
    expect(fixtures.length).toBe(3);

    await page.goto('/');
    await page.getByText('Artifacts', { exact: true }).first().click();
    await expect(page.getByRole('heading', { name: 'Artifacts' })).toBeVisible({ timeout: 15_000 });

    // filter to the fixture kind so select-all cannot reach real artifacts
    await page.getByRole('button', { name: KIND, exact: true }).click();
    await expect(page.getByText('e2e-bulk-alpha')).toBeVisible();
    expect(await page.locator('div[role="button"][title^="Open "]').count()).toBe(3);

    // enter Edit mode — scoped to the gallery header; the Sidebar has its own Edit
    await page
      .getByRole('heading', { name: 'Artifacts' })
      .locator('..')
      .getByRole('button', { name: 'Edit', exact: true })
      .click();

    // rows become selectable, not openable
    expect(await page.locator('div[role="button"][title^="Select "]').count()).toBe(3);

    // a single row toggles the count
    await page.locator('div[role="button"][title="Select e2e-bulk-alpha"]').click();
    await expect(page.getByRole('button', { name: /Delete \(1\)/ })).toBeVisible();

    // select-all covers the filtered view only
    await page.getByRole('button', { name: 'Select all' }).click();
    await expect(page.getByRole('button', { name: /Delete \(3\)/ })).toBeVisible();

    // destructive action must confirm and name the count
    let dialogMsg = '';
    page.once('dialog', (d) => {
      dialogMsg = d.message();
      void d.accept();
    });
    await page.getByRole('button', { name: /Delete \(3\)/ }).click();
    await expect.poll(() => dialogMsg, { timeout: 10_000 }).toContain('3 artifacts');

    await expect(page.getByText('No artifacts match this filter.')).toBeVisible({ timeout: 20_000 });

    // server truth: fixtures gone from the DB, real artifacts untouched
    const after = await api<Array<{ id: string; kind: string }>>('/artifacts');
    expect(after.filter((a) => a.kind === KIND).length).toBe(0);
    expect(after.length).toBe(others.length);

    // and the S3 objects for every version are gone
    await asPrimary(async () => {
      for (const id of seededIds) {
        const remaining = await deleteArtifactObjects(PROJECT, id);
        expect(remaining).toBe(0);
      }
    });
  });
});
