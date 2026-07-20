/**
 * Stable, version-independent location for server-side runtime state (auth
 * config, session tokens, remote connections, cron jobs, metrics DB, logs).
 *
 * This must NOT live inside the installed package directory. `npm install -g`
 * fully re-extracts the package's published `dist/` on every (re)install or
 * update — including the app's own in-app "Update" button, which literally
 * runs `npm install -g ezpm2gui@npm:...@latest` — wiping anything written
 * there at runtime (password/PIN, remote server credentials, cron jobs...).
 * Everything instead lives under the user's home directory, so it survives
 * updates/reinstalls, mirroring how PM2 itself keeps its state in `~/.pm2`.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const DATA_DIR = process.env.EZPM2GUI_DATA_DIR || path.join(os.homedir(), '.ezpm2gui');

// Legacy location used before this fix — inside the installed package's own
// dist/ tree. Kept around only so a one-time best-effort migration can pick
// up existing state on upgrade paths npm doesn't wipe (local dev, linked
// global installs). For a plain `npm install -g` update this will already be
// gone by the time the new code runs, which is exactly the bug being fixed.
const LEGACY_CONFIG_DIR = path.join(__dirname, '../config');

// @group DataDir : Ensure the stable data directory exists and return it
export function getDataDir(): string {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  return DATA_DIR;
}

// @group DataDir : One-time best-effort copy of a legacy file/dir into its new
// location. No-op once the new path already exists or there's nothing to migrate.
export function migrateLegacyPath(newPath: string, legacyPath: string): void {
  try {
    if (fs.existsSync(newPath) || !fs.existsSync(legacyPath)) return;
    const dir = path.dirname(newPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.cpSync(legacyPath, newPath, { recursive: true });
  } catch {
    // Best-effort only — worst case the user reconfigures whatever didn't migrate.
  }
}

// @group DataDir : Resolve a path under the stable data directory, migrating
// the equivalent legacy in-package file/dir the first time it's requested.
export function resolveDataPath(...segments: string[]): string {
  const target = path.join(getDataDir(), ...segments);
  migrateLegacyPath(target, path.join(LEGACY_CONFIG_DIR, ...segments));
  return target;
}
