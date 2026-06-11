/**
 * AES-256-GCM credential store (PRD §6.2). Values live only in
 * dataDir/credentials/<ref>.enc; the key in dataDir/.atlas-key (chmod 600).
 * Never logged, never in the DB, masked in the UI.
 */
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { dataDir } from '../config.js';

function keyPath(): string {
  return path.join(dataDir, '.atlas-key');
}

function loadKey(): Buffer {
  if (!existsSync(keyPath())) {
    const key = randomBytes(32);
    writeFileSync(keyPath(), key);
    chmodSync(keyPath(), 0o600);
    return key;
  }
  return readFileSync(keyPath());
}

function credFile(ref: string): string {
  return path.join(dataDir, 'credentials', `${ref}.enc`);
}

export function storeCredential(value: string, ref?: string): string {
  const id = ref ?? randomUUID();
  const key = loadKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  mkdirSync(path.dirname(credFile(id)), { recursive: true });
  writeFileSync(credFile(id), Buffer.concat([iv, tag, enc]));
  chmodSync(credFile(id), 0o600);
  return id;
}

export function readCredential(ref: string): string | null {
  if (!existsSync(credFile(ref))) return null;
  const blob = readFileSync(credFile(ref));
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const enc = blob.subarray(28);
  const decipher = createDecipheriv('aes-256-gcm', loadKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

export function deleteCredential(ref: string): void {
  rmSync(credFile(ref), { force: true });
}
