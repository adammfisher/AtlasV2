import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { config } from '../config.js';

const here = path.dirname(fileURLToPath(import.meta.url));

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  const dataDir = path.join(config.dataDir, 'data');
  mkdirSync(dataDir, { recursive: true });
  db = new Database(path.join(dataDir, 'atlas.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(readFileSync(path.join(here, 'schema.sql'), 'utf8'));
  return db;
}

export function getSetting(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    )
    .run(key, value);
}

export const now = (): number => Date.now();

export const newId = (prefix: string): string =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
