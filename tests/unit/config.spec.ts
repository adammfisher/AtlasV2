/**
 * U-CONF-1 — config files must be strictly valid and internally consistent.
 * Regression lock for FX-1 (users.config.json carried a stray token that
 * silently disabled every non-primary account via the accounts() fallback).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');
const read = (f: string) => JSON.parse(readFileSync(path.join(root, f), 'utf8')) as Record<string, unknown>;

describe('U-CONF-1 config validity', () => {
  it('users.config.json parses and has well-formed accounts', () => {
    const cfg = read('users.config.json') as { users: Array<{ username: string; password: string; models: string[] }> };
    expect(Array.isArray(cfg.users)).toBe(true);
    expect(cfg.users.length).toBeGreaterThanOrEqual(1);
    for (const u of cfg.users) {
      expect(u.username).toMatch(/^[a-z0-9_-]+$/i);
      expect(typeof u.password).toBe('string');
      expect(u.password.length).toBeGreaterThan(0);
      expect(Array.isArray(u.models)).toBe(true);
      expect(u.models.length).toBeGreaterThan(0);
    }
    // the primary account must exist — all pre-accounts data belongs to it
    expect(cfg.users.some((u) => u.username === 'adammfisher')).toBe(true);
  });

  it('every account model key resolves against models.config.json', () => {
    const users = (read('users.config.json') as { users: Array<{ username: string; models: string[] }> }).users;
    const models = read('models.config.json') as { models: Array<{ key: string }> };
    const known = new Set(models.models.map((m) => m.key));
    for (const u of users) {
      for (const m of u.models) {
        expect(known.has(m), `account ${u.username} references unknown model '${m}'`).toBe(true);
      }
    }
  });

  it('models.config.json default model exists and atlas.config.json parses', () => {
    const models = read('models.config.json') as { default: string; models: Array<{ key: string }> };
    expect(models.models.map((m) => m.key)).toContain(models.default);
    const atlas = read('atlas.config.json') as { server?: { port?: number } };
    expect(atlas.server?.port).toBe(5175);
  });
});
