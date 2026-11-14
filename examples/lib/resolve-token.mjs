import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createEnvReader, ROOT_DIR } from './env-loader.mjs';

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
  '<BOT_BRIDGE_TOKEN_DARI_RENDER>',
]);

export function isUsableToken(token) {
  if (!token) return false;
  const trimmed = token.trim();
  if (trimmed.length < 8) return false;
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) return false;
  if (RETIRED_PLACEHOLDERS.has(trimmed) || trimmed.includes('ganti-dengan')) return false;
  const hash = crypto.createHash('sha256').update(trimmed, 'utf8').digest('hex');
  return !RETIRED_TOKEN_HASHES.has(hash);
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
 * `.env.bridge` / `.env` / `server/.env` files, or local dev settings.json.
 */
export function resolveBridgeToken(targetUrl, extraEnvFiles = []) {
  const env = createEnvReader(extraEnvFiles);
  const candidate = env.get('BOT_BRIDGE_TOKEN');
  if (isUsableToken(candidate)) {
    return candidate;
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
      'Isi di `.env.bridge` (salin dari `.env.bridge.example`) atau set env var BOT_BRIDGE_TOKEN:',
      '  PowerShell: $env:BOT_BRIDGE_TOKEN="<token-anda>"; npm run bridge:team',
      '  Bash:       BOT_BRIDGE_TOKEN="<token-anda>" npm run bridge:team',
    ].join('\n')
  );
  process.exit(1);
}
