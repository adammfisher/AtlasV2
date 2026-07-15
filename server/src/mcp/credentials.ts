/**
 * AES-256-GCM credential store (PRD §6.2). Ciphertext AND key live in DynamoDB
 * settings — in Lambda, dataDir is /tmp, so file-based storage orphaned every
 * credential on cold start (the key regenerated and old ciphertexts became
 * undecryptable; connectors then went tokenless SILENTLY — parity P5).
 *
 * Threat model note: key and ciphertext share a table. This deployment is a
 * single-account workspace with no user auth (mission scope) — the encryption
 * guards against casual table inspection and log leakage, not a DB-level
 * adversary. A KMS envelope is the upgrade path if that changes. Values are
 * never logged, never returned by any API, masked in the UI.
 */
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { getSetting, setSetting } from '../db/appdb.js';

function loadKey(): Buffer {
  const existing = getSetting('credkey');
  if (existing) return Buffer.from(existing, 'base64');
  const key = randomBytes(32);
  setSetting('credkey', key.toString('base64'));
  return key;
}

export function storeCredential(value: string, ref?: string): string {
  const id = ref ?? randomUUID();
  const key = loadKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  setSetting(`cred:${id}`, Buffer.concat([iv, tag, enc]).toString('base64'));
  return id;
}

export function readCredential(ref: string): string | null {
  const raw = getSetting(`cred:${ref}`);
  if (!raw) return null;
  const blob = Buffer.from(raw, 'base64');
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const enc = blob.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', loadKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

export function deleteCredential(ref: string): void {
  setSetting(`cred:${ref}`, '');
}
