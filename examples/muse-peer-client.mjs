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

/** Creates a REST mailbox client reporting `brainMode: "muse-langsung"` with long-poll & 401 backoff. */
export function createMailboxClient({
  baseUrl,
  botId,
  token,
  peer,
  pollMs = 3000,
  waitMs = 18_000,
}) {
  const cleanUrl = baseUrl.replace(/\/+$/, '');
  const rawWait = Number(waitMs);
  const defaultWaitMs = Number.isFinite(rawWait)
    ? Math.min(20_000, Math.max(0, Math.floor(rawWait)))
    : 18_000;
  const idlePollMs = Math.max(50, Number(pollMs) || 3000);
  let cursor = 0;
  let running = false;
  let stopped = false;
  let registered = false;
  let timer = null;
  let resolveSleep = null;
  let activeController = null;

  const requestJson = async (apiPath, options = {}) => {
    const controller = new AbortController();
    activeController = controller;
    try {
      const res = await fetch(`${cleanUrl}${apiPath}`, {
        ...options,
        signal: controller.signal,
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
    } finally {
      if (activeController === controller) {
        activeController = null;
      }
    }
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

  const pollMailboxOnce = async (overrideWaitMs) => {
    if (!registered) {
      await hello();
    }
    const reqWaitMs =
      overrideWaitMs !== undefined && Number.isFinite(Number(overrideWaitMs))
        ? Math.min(20_000, Math.max(0, Math.floor(Number(overrideWaitMs))))
        : defaultWaitMs;
    const query = `since=${cursor}${reqWaitMs > 0 ? `&waitMs=${reqWaitMs}` : ''}`;
    let inbox;
    try {
      inbox = await requestJson(`/api/bridge/bots/${encodeURIComponent(botId)}/events?${query}`);
    } catch (err) {
      if (err instanceof HttpAuthError && err.status === 404 && !stopped) {
        registered = false;
        await hello();
        inbox = await requestJson(`/api/bridge/bots/${encodeURIComponent(botId)}/events?${query}`);
      } else {
        throw err;
      }
    }
    if (typeof inbox.cursor === 'number' && inbox.cursor > cursor) {
      cursor = inbox.cursor;
    }
    for (const evt of inbox.events || []) {
      console.log(`[${botId}] Kotak surat event "${evt.event}":`, JSON.stringify(evt.payload));
    }
    for (const task of inbox.pendingTasks || []) {
      console.log(`[${botId}] Tugas menunggu di kotak surat [${task.id}]: ${task.title}`);
    }
    if (!stopped) {
      try {
        await sendEvent('bot:heartbeat', {});
      } catch (err) {
        if (err instanceof HttpAuthError && err.status === 404) {
          registered = false;
        } else {
          throw err;
        }
      }
    }
    return inbox;
  };

  return {
    sendEvent,
    hello,
    pollMailboxOnce,
    async startLoop() {
      running = true;
      stopped = false;
      let authAttempt = 0;
      while (running && !stopped) {
        let nextSleepMs = idlePollMs;
        const startedAt = Date.now();
        try {
          const inbox = await pollMailboxOnce();
          authAttempt = 0;
          const elapsedMs = Date.now() - startedAt;
          const hasEvents = Boolean(inbox?.events?.length);
          if (hasEvents || (defaultWaitMs > 0 && elapsedMs >= Math.min(1000, defaultWaitMs))) {
            nextSleepMs = 40;
          }
        } catch (err) {
          if (stopped || !running || err?.name === 'AbortError') {
            break;
          }
          if (err instanceof HttpAuthError && err.status === 401) {
            nextSleepMs = computeAuthBackoffMs(authAttempt);
            authAttempt += 1;
            console.error(`[${botId}] HTTP 401: ${AUTH_RETRY_MESSAGE} (retry ${nextSleepMs}ms)`);
          } else {
            console.error(`[${botId}] Gagal cek kotak surat:`, err?.message || err);
          }
        }
        if (!running || stopped) break;
        await new Promise((resolve) => {
          resolveSleep = resolve;
          timer = setTimeout(() => {
            timer = null;
            resolveSleep = null;
            resolve();
          }, nextSleepMs);
        });
      }
    },
    stop() {
      stopped = true;
      running = false;
      if (activeController) {
        activeController.abort();
        activeController = null;
      }
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
