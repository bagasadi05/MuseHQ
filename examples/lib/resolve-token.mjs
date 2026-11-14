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

export const AUTH_RETRY_MESSAGE =
  'token tidak cocok dengan server — periksa BOT_BRIDGE_TOKEN di dashboard Render';

/** Computes exponential backoff in milliseconds starting at 5s and capping at 60s on auth rejection. */
export function computeAuthBackoffMs(attempt = 0) {
  const safeAttempt = Math.max(0, Math.min(6, Number(attempt) || 0));
  return Math.min(60_000, 5_000 * 2 ** safeAttempt);
}

function parseBotTokenMap(rawMap) {
  const result = {};
  const trimmed = (rawMap || '').trim();
  if (!trimmed) return result;
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === 'string' && isUsableToken(v)) {
            result[k.trim()] = v.trim();
          }
        }
      }
    } catch {
      // Ignore invalid JSON map
    }
    return result;
  }
  for (const part of trimmed.split(/[,;\n]/)) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const id = part.slice(0, eq).trim();
    const tok = part.slice(eq + 1).trim();
    if (id && isUsableToken(tok)) {
      result[id] = tok;
    }
  }
  return result;
}

/**
 * Resolves a bridge token for an optional `botId` (per-bot token env/map first, then shared
 * `BOT_BRIDGE_TOKEN`), falling back to local `server/data/settings.json` only for localhost URLs.
 */
export function resolveBridgeToken(targetUrl, extraEnvFiles = [], botId = '') {
  const env = createEnvReader(extraEnvFiles);
  const cleanBotId = String(botId || '').trim();

  if (cleanBotId) {
    const upperKey = cleanBotId.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
    for (const envName of [`BOT_BRIDGE_TOKEN_${upperKey}`, `${upperKey}_BRIDGE_TOKEN`]) {
      const direct = env.get(envName);
      if (isUsableToken(direct)) return direct;
    }
    const tokenMap = parseBotTokenMap(env.get('BOT_BRIDGE_TOKENS'));
    if (tokenMap[cleanBotId]) {
      return tokenMap[cleanBotId];
    }
  }

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
        const perBotLocal =
          cleanBotId && parsed.botTokens && typeof parsed.botTokens[cleanBotId] === 'string'
            ? parsed.botTokens[cleanBotId].trim()
            : '';
        if (isUsableToken(perBotLocal)) {
          return perBotLocal;
        }
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
      `[MuseBot${cleanBotId ? `:${cleanBotId}` : ''}] Token bridge tidak ditemukan atau masih memakai nilai placeholder.`,
      `Target: ${targetUrl}`,
      'Isi BOT_BRIDGE_TOKENS / BOT_BRIDGE_TOKEN_<BOT> atau BOT_BRIDGE_TOKEN di `.env.bridge` (salin dari `.env.bridge.example`):',
      '  PowerShell: $env:BOT_BRIDGE_TOKEN="<token-anda>"; npm run bridge:team',
      '  Bash:       BOT_BRIDGE_TOKEN="<token-anda>" npm run bridge:team',
    ].join('\n')
  );
  process.exit(1);
}
