/**
 * Aproduct-* — the tenth kind (TESTPLAN §1.4 discrepancy #5): the product
 * master lives outside the 35-workflow brain (router.ts productRoute) and has
 * no downloadable file — it's a JSON definition with deterministic
 * projections, so it doesn't go through tests/validators/validate.py. Structural
 * assertions read the definition payload straight from the artifact API.
 */
import { test, expect } from '@playwright/test';
import { createConv, cleanupE2E, MARK } from '../../helpers/axiom-api.js';
import { sendAndWait, artifactDetail, lastMessage, routerDecisions } from '../../helpers/artifacts.js';

test.describe.configure({ mode: 'serial' });
test.describe('Aproduct artifact lifecycle', () => {
  test.setTimeout(240_000);
  let convId: string;
  let artifactId: string;

  test.afterAll(async () => {
    await cleanupE2E().catch(() => undefined);
  });

  test('Aproduct-create define → routes to product skill → payload has core fields', async () => {
    const conv = await createConv();
    convId = conv.id;
    const res = await sendAndWait(
      convId,
      `${MARK} Define a product: an auto loan payment calculator for the consumer lending LOB, payments domain.`,
      { timeoutMs: 200_000 },
    );
    expect(res.error, `create errored: ${res.error}`).toBeUndefined();
    expect(res.artifact, 'no artifact event received').toBeTruthy();
    expect(res.artifact!.kind).toBe('product');
    artifactId = res.artifact!.artifactId;

    const decisions = routerDecisions(convId);
    expect(decisions.length, 'no router decision logged for this conversation').toBeGreaterThan(0);
    expect(decisions[0]!.skill).toBe('product');
    expect(decisions[0]!.intent).toBe('create_doc');

    const detail = await artifactDetail(artifactId);
    expect(detail.kind).toBe('product');
    const payload = (detail as unknown as { payload: Record<string, unknown> }).payload;
    expect(payload, 'no definition payload on the artifact').toBeTruthy();
    expect(Object.keys(payload).length).toBeGreaterThan(2);
  });

  test('Aproduct-edit edit-vs-describe: field-scoped edit updates the master (zero tolerance)', async () => {
    const res = await sendAndWait(
      convId,
      `${MARK} Update the product: change the target LOB to Retail Banking and add fraud-prevention as a capability.`,
      { timeoutMs: 200_000 },
    );
    expect(res.error, `edit errored: ${res.error}`).toBeUndefined();

    const last = await lastMessage(convId);
    expect(last?.kind, `expected a product edit, got a "${last?.kind}" message: ${JSON.stringify(last).slice(0, 300)}`).toBe(
      'pipeline',
    );
    expect(last?.artifact?.artifactId).toBe(artifactId);
    expect(last?.artifact?.ver, 'edit must bump the version').toBeGreaterThanOrEqual(2);

    const decisions = routerDecisions(convId);
    const editDecision = decisions[decisions.length - 1];
    expect(editDecision?.intent).toBe('edit_doc');

    const detail = await artifactDetail(artifactId);
    const payload = JSON.stringify((detail as unknown as { payload: Record<string, unknown> }).payload).toLowerCase();
    expect(payload).toContain('retail banking');
  });

  test('Aproduct-version both versions retrievable', async () => {
    const detail = await artifactDetail(artifactId);
    expect(detail.versions.length).toBeGreaterThanOrEqual(2);
    expect(detail.versions.every((v) => v.hasFile)).toBe(true);
  });
});
