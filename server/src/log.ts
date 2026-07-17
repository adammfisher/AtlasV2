import { appendFileSync, existsSync, statSync, renameSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const MAX_BYTES = 5 * 1024 * 1024;

function logPath(name: string): string {
  const dir = path.join(config.dataDir, 'logs');
  mkdirSync(dir, { recursive: true });
  return path.join(dir, `${name}.log`);
}

export function logTo(name: string, message: string): void {
  const file = logPath(name);
  try {
    if (existsSync(file) && statSync(file).size > MAX_BYTES) {
      renameSync(file, `${file}.1`);
    }
    appendFileSync(file, `${new Date().toISOString()} ${message}\n`);
  } catch {
    // logging must never crash the app
  }
}

export const log = (msg: string): void => {
  console.log(`[axiom] ${msg}`);
  logTo('app', msg);
};
