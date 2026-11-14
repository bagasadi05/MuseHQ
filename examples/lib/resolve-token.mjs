import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');

// Hash of the retired legacy dev token + literal placeholders (never stored in plaintext)
const RETIRED_TOKEN_HASHES = new Set([
  'd61a19555f747218965afa70363f25aa8fdd4c3755af614300eb80820bf4679e',
]);

const RETIRED_PLACEHOLDERS = new Set([
  'your-secret-token',
  'your-token-here',
  'changeme',
  '<token-rahasia>',
  '<BOT_BRIDGE_TOKEN>',
]);

function isUsableToken(token) {
  if (!token) return false;
  const trimmed = token.trim();
  if (trimmed.length < 8) return false;
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) return false;
  if (RETIRED_PLACEHOLDERS.has(trimmed) || trimmed.includes('ganti-dengan')) return false;
  const hash = crypto.createHash('sha256').update(trimmed, 'utf8').digest('hex');
  return !RETIRED_TOKEN_HASHES.has(hash);
}

function parseEnvFile(filePath, key) {
  if (!fs.existsSync(filePath)) return '';
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const k = trimmed.slice(0, eq).trim();
      if (k !== key) continue;
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      return val.trim();
    }
  } catch {
    return '';
  }
  return '';
}

function isLocalTarget(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    return (
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '::1' ||
      parsed.hostname === '[::1]'
    );
  } catch {
    return false;
  }
}

/**
 * Resolves BOT_BRIDGE_TOKEN strictly from environment variables, untracked local
 * .env files, or local dev settings.json (for localhost development only).
 */
export function resolveBridgeToken(targetUrl) {
  const candidates = [
    process.env.BOT_BRIDGE_TOKEN?.trim() || '',
    parseEnvFile(path.join(ROOT_DIR, 'server', '.env'), 'BOT_BRIDGE_TOKEN'),
    parseEnvFile(path.join(ROOT_DIR, '.env'), 'BOT_BRIDGE_TOKEN'),
  ];

  for (const token of candidates) {
    if (isUsableToken(token)) {
      return token;
    }
  }

  // Developer convenience when running locally after `npm run dev` generated random settings.json
  if (isLocalTarget(targetUrl)) {
    const settingsPath = path.join(ROOT_DIR, 'server', 'data', 'settings.json');
    if (fs.existsSync(settingsPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        const localToken = typeof parsed.bridgeToken === 'string' ? parsed.bridgeToken.trim() : '';
        if (isUsableToken(localToken)) {
          return localToken;
        }
      } catch {
        // Fall through to explicit instruction below
      }
    }
  }

  console.error(
    [
      '[MuseBot] BOT_BRIDGE_TOKEN tidak ditemukan atau masih memakai nilai placeholder.',
      `Target: ${targetUrl}`,
      'Atur env var BOT_BRIDGE_TOKEN (atau isi di server/.env) sebelum menjalankan script ini:',
      '  PowerShell: $env:BOT_BRIDGE_TOKEN="<token-anda>"; npm run example:bot',
      '  Bash:       BOT_BRIDGE_TOKEN="<token-anda>" npm run example:bot',
    ].join('\n')
  );
  process.exit(1);
}
