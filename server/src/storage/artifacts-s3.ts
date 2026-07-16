/**
 * Artifact file durability (PRD FR-10.2): versions build locally (Lambda /tmp),
 * mirror to s3://atlasv2-artifacts/<project>/<artifact>/v<N>/<rel> on write,
 * and hydrate back on read when the local copy is gone (fresh instance).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { fromIni } from '@aws-sdk/credential-providers';
import { config } from '../config.js';
import { logTo } from '../log.js';

const BUCKET = 'atlasv2-artifacts-683032473658';

let _s3: S3Client | null = null;
function s3(): S3Client {
  if (!_s3) {
    const local = !process.env.AWS_LAMBDA_FUNCTION_NAME;
    _s3 = new S3Client({
      region: config.bedrock.region || 'us-east-1',
      ...(local ? { credentials: fromIni({ profile: config.bedrock.profile || 'default' }) } : {}),
    });
  }
  return _s3;
}

/** s3 prefix for a local artifacts path: everything after .../artifacts/ */
function keyFor(localPath: string): string | null {
  const marker = `${path.sep}artifacts${path.sep}`;
  const i = localPath.indexOf(marker);
  return i === -1 ? null : localPath.slice(i + marker.length).split(path.sep).join('/');
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

/** Mirror a version file (or dir) to S3. Awaited at addVersion for durability. */
export async function mirrorArtifactPath(localPath: string): Promise<void> {
  const files = statSync(localPath).isDirectory() ? walk(localPath) : [localPath];
  for (const f of files) {
    const key = keyFor(f);
    if (!key) continue;
    await s3().send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: readFileSync(f) }));
  }
  logTo('app', `artifact mirrored to s3 (${files.length} file${files.length === 1 ? '' : 's'})`);
}

/**
 * Remove every mirrored object for an artifact — all versions, all files.
 * Callers must pass the project_id off an account-scoped ArtifactRow: S3 keys
 * carry no account prefix, so the DB read is the only ownership check there is.
 */
export async function deleteArtifactObjects(projectId: string, artifactId: string): Promise<number> {
  const prefix = `${projectId}/${artifactId}/`;
  let removed = 0;
  let token: string | undefined;
  do {
    const listed = await s3().send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, ContinuationToken: token }),
    );
    const objs = listed.Contents ?? [];
    if (objs.length > 0) {
      // a list page caps at 1000 keys, which is also DeleteObjects' per-call limit
      const res = await s3().send(
        new DeleteObjectsCommand({ Bucket: BUCKET, Delete: { Objects: objs.map((o) => ({ Key: o.Key! })) } }),
      );
      const errs = res.Errors ?? [];
      const [first] = errs;
      if (first) throw new Error(`s3 delete failed for ${errs.length} key(s): ${first.Key ?? '?'} — ${first.Message ?? 'unknown'}`);
      removed += objs.length;
    }
    token = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (token);
  logTo('app', `artifact s3 objects deleted: ${prefix} (${removed})`);
  return removed;
}

/** Ensure a version path exists locally, hydrating from S3 if needed. */
export async function hydrateArtifactPath(localPath: string): Promise<boolean> {
  if (existsSync(localPath)) return true;
  const key = keyFor(localPath);
  if (!key) return false;
  try {
    const listed = await s3().send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: key }));
    const objs = listed.Contents ?? [];
    if (objs.length === 0) return false;
    for (const o of objs) {
      const rel = o.Key!.slice(key.length).replace(/^\//, '');
      const dest = rel ? path.join(localPath, rel) : localPath;
      mkdirSync(path.dirname(dest), { recursive: true });
      const out = await s3().send(new GetObjectCommand({ Bucket: BUCKET, Key: o.Key! }));
      writeFileSync(dest, Buffer.from(await out.Body!.transformToByteArray()));
    }
    logTo('app', `artifact hydrated from s3: ${key} (${objs.length})`);
    return existsSync(localPath);
  } catch (err) {
    logTo('app', `artifact hydrate failed ${key}: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}
