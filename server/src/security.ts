import crypto from 'node:crypto';
import { IncomingMessage } from 'node:http';

export const SESSION_COOKIE_NAME = 'muse_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

// SHA-256 digest of retired public dev token so no literal leaked token remains in source
const RETIRED_TOKEN_DIGEST = 'd61a19555f747218965afa70363f25aa8fdd4c3755af614300eb80820bf4679e';

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function sha256Buf(value: string): Buffer {
  return crypto.createHash('sha256').update(value, 'utf8').digest();
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  if (!a || !b) return false;
  return crypto.timingSafeEqual(sha256Buf(a), sha256Buf(b));
}

export function isRetiredToken(token: string | undefined): boolean {
  if (!token) return true;
  const trimmed = token.trim();
  if (!trimmed || trimmed.length < 8) return true;
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) return true;
  if (
    trimmed.includes('ganti-dengan') ||
    trimmed === 'changeme' ||
    trimmed === 'your-token-here'
  ) {
    return true;
  }
  return sha256Hex(trimmed) === RETIRED_TOKEN_DIGEST;
}

export function generateSecureToken(prefix: string, byteLength = 24): string {
  return `${prefix}${crypto.randomBytes(byteLength).toString('hex')}`;
}

export function deriveDeterministicKey(material: string): string {
  return crypto.createHash('sha256').update(`musehq-session:${material}`, 'utf8').digest('hex');
}

export interface SessionPayload {
  role: 'owner';
  iat: number;
  exp: number;
}

export function signSessionToken(secret: string, ttlSeconds = SESSION_TTL_SECONDS): string {
  const now = Date.now();
  const payload: SessionPayload = {
    role: 'owner',
    iat: now,
    exp: now + ttlSeconds * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySessionToken(
  token: string | undefined,
  secret: string
): SessionPayload | null {
  if (!token || !secret) return null;
  const dotIdx = token.indexOf('.');
  if (dotIdx <= 0) return null;
  const encoded = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);
  if (!encoded || !sig) return null;

  const expectedSig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  if (!timingSafeEqualStr(sig, expectedSig)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    if (parsed.role !== 'owner' || typeof parsed.exp !== 'number' || parsed.exp <= Date.now()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!cookieHeader) return result;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const rawVal = part.slice(eq + 1).trim();
    try {
      result[key] = decodeURIComponent(rawVal);
    } catch {
      result[key] = rawVal;
    }
  }
  return result;
}

export function isHttpsRequest(req: IncomingMessage): boolean {
  const proto = req.headers['x-forwarded-proto'];
  if (typeof proto === 'string' && proto.split(',')[0].trim() === 'https') {
    return true;
  }
  return Boolean('encrypted' in req.socket && req.socket.encrypted);
}

export function buildSessionCookie(token: string, isSecure: boolean): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ];
  if (isSecure) parts.push('Secure');
  return parts.join('; ');
}

export function buildClearSessionCookie(isSecure: boolean): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (isSecure) parts.push('Secure');
  return parts.join('; ');
}

export function extractBearerOrHeaderToken(req: IncomingMessage): string {
  const direct = req.headers['x-muse-token'];
  if (typeof direct === 'string' && direct.trim()) return direct.trim();
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
    return auth.slice(7).trim();
  }
  return '';
}

export function getAllowedOrigins(): Set<string> {
  const port = Number(process.env.PORT || 3001);
  const origins = new Set<string>([
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    `http://localhost:${port}`,
    `http://127.0.0.1:${port}`,
  ]);

  const rawEnv = process.env.ALLOWED_ORIGINS || '';
  for (const item of rawEnv.split(',')) {
    const clean = item.trim().replace(/\/+$/, '');
    if (clean && clean !== '*') origins.add(clean);
  }

  for (const envHost of [
    process.env.RENDER_EXTERNAL_URL,
    process.env.VERCEL_URL,
    process.env.VERCEL_BRANCH_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL,
  ]) {
    if (envHost) {
      origins.add(`https://${envHost.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`);
    }
  }

  return origins;
}

export function isOriginAllowed(
  origin: string | undefined,
  allowedOrigins: Set<string>,
  requestHost?: string
): boolean {
  // Server-to-server bots, curl, and Node ws clients omit the browser Origin header
  if (!origin) return true;
  const normalized = origin.trim().replace(/\/+$/, '');
  if (allowedOrigins.has(normalized)) return true;

  if (requestHost) {
    try {
      const originUrl = new URL(normalized);
      if (originUrl.host === requestHost) return true;
    } catch {
      return false;
    }
  }
  return false;
}
