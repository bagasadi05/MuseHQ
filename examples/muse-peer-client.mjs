/**
 * Template client kotak surat (mailbox REST polling) untuk bot Muse langsung (brainMode: "muse-langsung").
 * Membaca kotak surat GET /api/bridge/bots/:id/events?since=<cursor> dengan backoff 401 (5s -> 60s),
 * agar sesi Muse eksternal (mis. Claude / Codex / agen lokal) dapat mengambil tugas & membalas via Bridge.
 *
 * Contoh jalankan:
 *   BOT_BRIDGE_TOKEN="<token>" node examples/muse-peer-client.mjs --bot=muse-bagas --url=https://musehq.onrender.com
 */

import { pathToFileURL } from 'node:url';
import { createEnvReader } from './lib/env-loader.mjs';
import { resolvePeerPreset } from './lib/peer-presets.mjs';
import {
  AUTH_RETRY_MESSAGE,
  computeAuthBackoffMs,
  resolveBridgeToken,
} from './lib/resolve-token.mjs';
import { parseCliArgs } from './muse-peer-bridge.mjs';

class HttpAuthError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Creates a REST mailbox client reporting `brainMode: "muse-langsung"` with 401 backoff. */
export function createMailboxClient({ baseUrl, botId, token, peer, pollMs = 3000 }) {
  const cleanUrl = baseUrl.replace(/\/+$/, '');
  let cursor = 0;
  let running = false;
  let registered = false;
  let timer = null;
  let resolveSleep = null;

  const requestJson = async (apiPath, options = {}) => {
    const res = await fetch(`${cleanUrl}${apiPath}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'x-muse-token': token,
        ...(options.headers || {}),
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new HttpAuthError(res.status, `HTTP ${res.status} pada ${apiPath}: ${body.slice(0, 180)}`);
    }
    return res.json();
  };

  const sendEvent = (event, payload = {}, eventId) =>
    requestJson(`/api/bridge/bots/${encodeURIComponent(botId)}/event`, {
      method: 'POST',
      body: JSON.stringify({ event, payload, ...(eventId ? { eventId } : {}) }),
    });

  const hello = async () => {
    await sendEvent(
      'bot:hello',
      {
        id: botId,
        name: peer.name,
        role: peer.role,
        description: peer.description,
        homeZone: peer.homeZone,
        color: peer.color,
        type: 'external-rest',
        canDelegate: peer.canDelegate,
        brainMode: 'muse-langsung',
      },
      `mailbox-hello-${botId}-${Date.now()}`
    );
    registered = true;
    console.log(`[${botId}] Kotak surat aktif di ${cleanUrl} (brainMode=muse-langsung).`);
  };

  const pollMailboxOnce = async () => {
    if (!registered) {
      await hello();
    }
    const inbox = await requestJson(
      `/api/bridge/bots/${encodeURIComponent(botId)}/events?since=${cursor}`
    );
    if (typeof inbox.cursor === 'number' && inbox.cursor > cursor) {
      cursor = inbox.cursor;
    }
    for (const evt of inbox.events || []) {
      console.log(`[${botId}] Kotak surat event "${evt.event}":`, JSON.stringify(evt.payload));
    }
    for (const task of inbox.pendingTasks || []) {
      console.log(`[${botId}] Tugas menunggu di kotak surat [${task.id}]: ${task.title}`);
    }
    await sendEvent('bot:heartbeat', {});
    return inbox;
  };

  return {
    sendEvent,
    hello,
    pollMailboxOnce,
    async startLoop() {
      running = true;
      let authAttempt = 0;
      while (running) {
        let waitMs = pollMs;
        try {
          await pollMailboxOnce();
          authAttempt = 0;
        } catch (err) {
          if (err instanceof HttpAuthError && err.status === 401) {
            waitMs = computeAuthBackoffMs(authAttempt);
            authAttempt += 1;
            console.error(`[${botId}] HTTP 401: ${AUTH_RETRY_MESSAGE} (retry ${waitMs}ms)`);
          } else {
            console.error(`[${botId}] Gagal cek kotak surat:`, err?.message || err);
          }
        }
        if (!running) break;
        await new Promise((resolve) => {
          resolveSleep = resolve;
          timer = setTimeout(() => {
            timer = null;
            resolveSleep = null;
            resolve();
          }, waitMs);
        });
      }
    },
    stop() {
      running = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (resolveSleep) {
        const done = resolveSleep;
        resolveSleep = null;
        done();
      }
    },
  };
}

function runCli() {
  const args = parseCliArgs();
  const extraFiles = args.env ? [args.env] : [];
  const env = createEnvReader(extraFiles);
  const baseUrl = (args.url || env.get('MUSE_BASE_URL', 'https://musehq.onrender.com')).replace(/\/+$/, '');
  const peer = resolvePeerPreset(args.bot || env.get('BOT_ID', 'muse-bagas'), env);
  const token = resolveBridgeToken(baseUrl, extraFiles, peer.id);
  const client = createMailboxClient({ baseUrl, botId: peer.id, token, peer });

  const shutdown = () => {
    client.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  void client.startLoop();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
