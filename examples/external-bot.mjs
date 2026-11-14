/**
 * Contoh script Bot Eksternal (WebSocket Bridge) yang menyambung ke MuseHQ.
 * Jalankan secara lokal: npm run example:bot
 * Atur override opsional: MUSE_WS_URL, BOT_BRIDGE_TOKEN, BOT_ID, BOT_NAME, BOT_ROLE, BOT_HOME_ZONE, BOT_COLOR
 */

import {
  sanitizeCleanText,
  sanitizeSpeechText,
  sanitizeTitleText,
} from './lib/brain-adapter.mjs';
import {
  AUTH_RETRY_MESSAGE,
  computeAuthBackoffMs,
  resolveBridgeToken,
} from './lib/resolve-token.mjs';

const BASE_WS_URL = process.env.MUSE_WS_URL || 'ws://localhost:3001/ws/bot';
const BOT_ID = process.env.BOT_ID || 'muse-external-ops';
const TOKEN = resolveBridgeToken(BASE_WS_URL, [], BOT_ID);
const BOT_NAME = process.env.BOT_NAME || 'Muse External Ops';
const BOT_ROLE = process.env.BOT_ROLE || 'Automation & Integration Bot';
const BOT_HOME_ZONE = process.env.BOT_HOME_ZONE || 'qa-bench';
const BOT_COLOR = process.env.BOT_COLOR || '#a855f7';

const sep = BASE_WS_URL.includes('?') ? '&' : '?';
const hasTokenQuery = /([?&])token=/.test(BASE_WS_URL);
const WS_CONNECT_URL = hasTokenQuery
  ? BASE_WS_URL
  : `${BASE_WS_URL}${sep}token=${encodeURIComponent(TOKEN)}`;
const WS_SAFE_LOG_URL = (hasTokenQuery ? BASE_WS_URL : `${BASE_WS_URL}${sep}token=<REDACTED>`)
  .replace(/([?&]token=)[^&]*/gi, '$1<REDACTED>');

console.log('[ExternalBot] Menghubungkan Muse External Bot ke:', WS_SAFE_LOG_URL);

let ws = null;
let heartbeatTimer = null;
let reconnectTimer = null;
let authRetryAttempt = 0;
let isShuttingDown = false;
const processedTaskIds = new Set();
const processedCommsIds = new Set();

function send(event, payload, eventId) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ event, payload, eventId }));
}

function connect() {
  if (isShuttingDown) return;
  ws = new WebSocket(WS_CONNECT_URL);

  ws.addEventListener('open', () => {
    console.log(`[ExternalBot] Terhubung ke MuseHQ sebagai ${BOT_ID}!`);
    send('bot:hello', {
      id: BOT_ID,
      name: BOT_NAME,
      role: BOT_ROLE,
      description: 'Bot eksternal yang berjalan di proses terpisah via WebSocket Bridge.',
      homeZone: BOT_HOME_ZONE,
      color: BOT_COLOR,
      canDelegate: true,
      brainMode: 'upstream',
    });

    setTimeout(() => {
      send('bot:speech', {
        text: sanitizeSpeechText(`Halo tim, ${BOT_NAME} (${BOT_ID}) online di ${BOT_HOME_ZONE} via WebSocket.`),
      });
    }, 1200);

    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      send('bot:heartbeat', {});
    }, 20_000);
  });

  ws.addEventListener('message', (evt) => {
    let parsed;
    try {
      parsed = JSON.parse(String(evt.data));
    } catch {
      return;
    }

    const { event, payload } = parsed;
    if (event === 'ping') {
      send('pong', {});
      return;
    }
    if (event === 'bot:registered') {
      authRetryAttempt = 0;
    }
    console.log('[ExternalBot] Event masuk:', event);

    if (event === 'task:assigned' && payload?.taskId) {
      const { taskId, title, instructions } = payload;
      if (processedTaskIds.has(taskId)) return;
      processedTaskIds.add(taskId);

      const cleanTitle = sanitizeTitleText(String(title || 'Tugas Eksternal')) || 'Tugas Eksternal';
      const cleanInstructions = sanitizeCleanText(String(instructions || ''), {
        singleLine: true,
        stripMarkdown: true,
      }).slice(0, 160);
      const cleanBotName =
        sanitizeCleanText(BOT_NAME, { singleLine: true, stripMarkdown: true }) || BOT_ID;

      send('task:accept', { taskId }, `ws-accept-${BOT_ID}-${taskId}`);
      send('bot:status', {
        status: 'working',
        zone: BOT_HOME_ZONE,
        speech: sanitizeSpeechText(`Memproses "${cleanTitle}" melalui WebSocket worker...`),
      });

      setTimeout(() => {
        send(
          'task:complete',
          {
            taskId,
            speech: sanitizeSpeechText(`Tugas "${cleanTitle}" selesai dari proses eksternal.`),
            result: [
              `### Hasil Eksekusi Bot Eksternal (${cleanBotName})`,
              `**ID Agen:** \`${BOT_ID}\``,
              `**Tugas:** ${cleanTitle}`,
              `**Ringkasan Instruksi:** ${cleanInstructions || '-'}`,
              '',
              '- Diproses secara real-time oleh worker eksternal melalui `/ws/bot`.',
              '- Bridge dua arah aktif untuk integrasi layanan eksternal.',
            ].join('\n'),
          },
          `ws-complete-${BOT_ID}-${taskId}`
        );
      }, 1800);
    } else if (event === 'comms:message' && payload?.content && payload?.fromId !== BOT_ID) {
      if (payload.id && processedCommsIds.has(payload.id)) return;
      if (payload.id) processedCommsIds.add(payload.id);

      const content = String(payload.content);
      const contentLower = content.toLowerCase();
      const isAddressed =
        payload.toId === BOT_ID ||
        contentLower.includes(`@${BOT_ID.toLowerCase()}`) ||
        contentLower.includes(`@${BOT_NAME.toLowerCase()}`);

      if (
        isAddressed &&
        payload.fromId !== 'system' &&
        (payload.kind === 'chat' || payload.kind === 'command') &&
        !content.startsWith('Pesan diterima dari ')
      ) {
        const cleanSender = sanitizeCleanText(String(payload.fromName || payload.fromId), { singleLine: true });
        const cleanSnippet = sanitizeCleanText(content, { singleLine: true }).slice(0, 80);
        send(
          'bot:speech',
          {
            text: sanitizeSpeechText(`Pesan diterima dari ${cleanSender}: "${cleanSnippet}"`),
            toId: payload.fromId,
          },
          `ws-reply-${BOT_ID}-${payload.id || Date.now()}`
        );
      }
    }
  });

  ws.addEventListener('close', (evt) => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    const reason = String(evt.reason || '');
    console.log(`[ExternalBot] Koneksi ditutup (code=${evt.code}, reason=${reason || 'none'}).`);
    if (isShuttingDown) return;
    if (evt.code === 4001 || evt.code === 4003 || /token|unauthor/i.test(reason)) {
      const waitMs = computeAuthBackoffMs(authRetryAttempt);
      authRetryAttempt += 1;
      console.error(`[ExternalBot] ${AUTH_RETRY_MESSAGE} Retry dalam ${Math.round(waitMs / 1000)} detik.`);
      reconnectTimer = setTimeout(connect, waitMs);
      return;
    }
    reconnectTimer = setTimeout(connect, 5000);
  });

  ws.addEventListener('error', (err) => {
    console.error('[ExternalBot] WebSocket error:', err?.message || 'WebSocket connection error');
  });
}

connect();

function shutdown() {
  isShuttingDown = true;
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    ws.close(1000, 'Client shutdown');
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
