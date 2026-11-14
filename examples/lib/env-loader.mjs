import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..', '..');

const DEFAULT_ENV_FILES = [
  path.join(ROOT_DIR, '.env.bridge'),
  path.join(ROOT_DIR, '.env'),
  path.join(ROOT_DIR, 'server', '.env'),
];

/** Parse KEY=VALUE entries from a dotenv-style file without mutating process.env. */
export function parseEnvFileMap(filePath) {
  const result = {};
  if (!filePath || !fs.existsSync(filePath)) return result;

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key) result[key] = val.trim();
    }
  } catch {
    return {};
  }
  return result;
}

/**
 * Create a read-only config accessor prioritizing explicit process.env,
 * followed by `.env.bridge`, `.env`, and `server/.env`.
 */
export function createEnvReader(extraFiles = []) {
  const files = [...extraFiles, ...DEFAULT_ENV_FILES].filter(Boolean);
  const loadedMaps = files.map((file) => parseEnvFileMap(file));

  return {
    get(key, fallback = '') {
      const fromProcess = process.env[key];
      if (typeof fromProcess === 'string' && fromProcess.trim()) {
        return fromProcess.trim();
      }
      for (const map of loadedMaps) {
        const candidate = map[key];
        if (typeof candidate === 'string' && candidate.trim()) {
          return candidate.trim();
        }
      }
      return fallback;
    },
  };
}

/** Redact query tokens before printing WebSocket URLs in terminal logs. */
export function redactWsUrl(url) {
  return String(url || '').replace(/([?&]token=)[^&]*/gi, '$1<REDACTED>');
}
