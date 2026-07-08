/**
 * Compatibility facade over the DynamoDB app data layer (appdb.ts). SQLite is
 * fully retired (PRD §12.1); anything still importing getDb fails to compile —
 * by design, so no call site can silently keep writing to a dead database.
 */
export { getSetting, setSetting, now, newId } from './appdb.js';
