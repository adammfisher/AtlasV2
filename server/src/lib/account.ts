/**
 * Account context (simple multi-user, no Cognito): three trusted accounts from
 * users.config.json, each a fully separate workspace. The context rides
 * AsyncLocalStorage so the data layer partitions WITHOUT threading a user
 * argument through every call site.
 *
 * Partitioning: every DynamoDB pk (and memory scope / vector index) gets an
 * account prefix. The PRIMARY account maps to the empty prefix, so all data
 * created before accounts existed belongs to it — zero migration.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../config.js';

export interface AccountDef {
  username: string;
  password: string;
  models: string[];
}

const PRIMARY = 'adammfisher';

let cached: AccountDef[] | null = null;
const FALLBACK: AccountDef[] = [{ username: 'adammfisher', password: 'buster11', models: ['haiku', 'sonnet', 'nova'] }];
export function accounts(): AccountDef[] {
  if (!cached) {
    try {
      const raw = JSON.parse(readFileSync(path.join(repoRoot, 'users.config.json'), 'utf8')) as { users: AccountDef[] };
      cached = raw.users?.length ? raw.users : FALLBACK;
    } catch {
      // never let a missing/broken config crash the runtime — degrade to the
      // primary account only (it owns all existing data)
      cached = FALLBACK;
    }
  }
  return cached;
}

const als = new AsyncLocalStorage<{ user: string }>();

/** Current account; background work outside a request runs as the primary. */
export function currentAccount(): string {
  return als.getStore()?.user ?? PRIMARY;
}

/** DynamoDB pk / memory-scope prefix: primary = '' (legacy data is his). */
export function accountPrefix(): string {
  const u = currentAccount();
  return u === PRIMARY ? '' : `A#${u}|`;
}

export function runAsAccount<T>(user: string, fn: () => T): T {
  return als.run({ user }, fn);
}

export function modelAllowed(key: string): boolean {
  const acct = accounts().find((a) => a.username === currentAccount());
  return acct ? acct.models.includes(key) : false;
}

export function allowedModels(): string[] {
  return accounts().find((a) => a.username === currentAccount())?.models ?? [];
}

/* ---- stateless token: <user>.<hmac(user)> — the signing secret is derived
 * from the primary partition's credkey so it survives Lambda cold starts ---- */

let secret: Buffer | null = null;
async function signingSecret(): Promise<Buffer> {
  if (secret) return secret;
  const { getSetting, setSetting } = await import('../db/appdb.js');
  // system home = primary (unprefixed) partition
  return runAsAccount(PRIMARY, () => {
    let raw = getSetting('authsecret');
    if (!raw) {
      raw = createHmac('sha256', String(Date.now() + Math.random())).digest('base64');
      setSetting('authsecret', raw);
    }
    secret = Buffer.from(raw, 'base64');
    return secret;
  });
}

/** Tokens expire 12h after issue: the issued-at is inside the signed payload,
 * so it can't be tampered without breaking the HMAC. Token = <user>.<iat>.<mac>. */
export const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

export async function issueToken(user: string, iat = Date.now()): Promise<string> {
  const payload = `${user}.${iat}`;
  const mac = createHmac('sha256', await signingSecret()).update(payload).digest('base64url');
  return `${Buffer.from(user).toString('base64url')}.${iat}.${mac}`;
}

export async function verifyToken(token: string): Promise<string | null> {
  const [u64, iatStr, mac] = token.split('.');
  if (!u64 || !iatStr || !mac) return null;
  const user = Buffer.from(u64, 'base64url').toString('utf8');
  if (!accounts().some((a) => a.username === user)) return null;
  const iat = Number(iatStr);
  if (!Number.isFinite(iat) || Date.now() - iat > TOKEN_TTL_MS) return null; // expired
  const expect = createHmac('sha256', await signingSecret()).update(`${user}.${iat}`).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expect);
  return a.length === b.length && timingSafeEqual(a, b) ? user : null;
}

export function checkLogin(username: string, password: string): AccountDef | null {
  const acct = accounts().find((a) => a.username === username);
  if (!acct) return null;
  const a = Buffer.from(password);
  const b = Buffer.from(acct.password);
  return a.length === b.length && timingSafeEqual(a, b) ? acct : null;
}
