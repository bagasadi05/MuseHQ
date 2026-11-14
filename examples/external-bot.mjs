/**
 * Contoh script Bot Eksternal (WebSocket Bridge) yang menyambung ke MuseHQ.
 * Jalankan secara lokal: npm run example:bot
 * Atur override opsional: MUSE_WS_URL, BOT_BRIDGE_TOKEN, BOT_ID, BOT_NAME, BOT_ROLE, BOT_HOME_ZONE, BOT_COLOR
 */

import { resolveBridgeToken } from './lib/resolve-token.mjs';

const BASE_WS_URL = process.env.MUSE_WS_URL || 'ws://localhost:3001/ws/bot';
const TOKEN = resolveBridgeToken(BASE_WS_URL);
const BOT_ID = process.env.BOT_ID || 'muse-external-ops';
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
const ws = new WebSocket(WS_CONNECT_URL);

let heartbeatTimer = null;
const processedTaskIds = new Set();
const processedCommsIds = new Set();

function send(event, payload, eventId) {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ event, payload, eventId }));
}

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
  });

  setTimeout(() => {
    send('bot:speech', {
      text: `Halo tim! ${BOT_NAME} (${BOT_ID}) online di ${BOT_HOME_ZONE} via WebSocket.`,
    });
  }, 1200);

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
  console.log('[ExternalBot] Event masuk:', event);

  if (event === 'task:assigned' && payload?.taskId) {
    const { taskId, title, instructions } = payload;
    if (processedTaskIds.has(taskId)) return;
    processedTaskIds.add(taskId);

    send('task:accept', { taskId }, `ws-accept-${BOT_ID}-${taskId}`);
    send('bot:status', {
      status: 'working',
      zone: BOT_HOME_ZONE,
      speech: `Memproses "${title}" melalui WebSocket worker...`,
    });

    setTimeout(() => {
      send(
        'task:complete',
        {
          taskId,
          speech: `Tugas "${title}" selesai dari proses eksternal!`,
          result: [
            `#### Hasil Eksekusi Bot Eksternal (${BOT_NAME})`,
            `**ID Agen:** \`${BOT_ID}\``,
            `**Tugas:** ${title}`,
            `**Ringkasan Instruksi:** ${String(instructions || '').slice(0, 160)}`,
            '',
            '- Diproses secara real-time oleh worker eksternal melalui `/ws/bot`.',
            '- Bridge dua arah aktif (siap disambungkan ke Telegram/Discord/n8n/Python).',
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
      send(
        'bot:speech',
        {
          text: `Pesan diterima dari ${payload.fromName || payload.fromId}: "${content.slice(0, 80)}"`,
          toId: payload.fromId,
        },
        `ws-reply-${BOT_ID}-${payload.id || Date.now()}`
      );
    }
  }
});

ws.addEventListener('close', (evt) => {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  console.log(`[ExternalBot] Koneksi ditutup (code=${evt.code}, reason=${evt.reason || 'none'}).`);
});

ws.addEventListener('error', (err) => {
  console.error('[ExternalBot] WebSocket error:', err?.message || 'WebSocket connection error');
});

function shutdown() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
    ws.close(1000, 'Client shutdown');
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
