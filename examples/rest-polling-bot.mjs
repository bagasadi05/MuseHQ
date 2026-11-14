/**
 * Contoh script Bot Eksternal (REST Polling Mode) untuk lingkungan tanpa WebSocket persisten (mis. Vercel Serverless).
 * Membaca GET /api/state?since=<cursor>, memproses tugas tanpa duplikasi,
 * dan mengirim update ke POST /api/bridge/bots/:id/event.
 *
 * Jalankan: npm run example:rest-bot
 * Env opsional: MUSE_BASE_URL, BOT_BRIDGE_TOKEN, BOT_ID, BOT_NAME, BOT_HOME_ZONE, POLL_MS, VERCEL_BYPASS_SECRET
 */

import { resolveBridgeToken } from './lib/resolve-token.mjs';

const BASE_URL = (process.env.MUSE_BASE_URL || 'http://localhost:3001').replace(/\/+$/, '');
const TOKEN = resolveBridgeToken(BASE_URL);
const VERCEL_BYPASS_SECRET = process.env.VERCEL_BYPASS_SECRET?.trim() || '';
const BOT_ID = process.env.BOT_ID || 'muse-rest-worker';
const BOT_NAME = process.env.BOT_NAME || 'Muse REST Worker';
const BOT_HOME_ZONE = process.env.BOT_HOME_ZONE || 'qa-bench';
const rawPollMs = Number(process.env.POLL_MS);
const POLL_MS = Math.max(1000, Number.isFinite(rawPollMs) && rawPollMs > 0 ? rawPollMs : 2500);

const processedTaskIds = new Set();
const processedCommsIds = new Set();
let stateCursor = 0;
let running = true;
let sleepTimer = null;

async function apiRequest(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-muse-token': TOKEN,
      ...(VERCEL_BYPASS_SECRET ? { 'x-vercel-protection-bypass': VERCEL_BYPASS_SECRET } : {}),
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} pada ${path}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function sendBridgeEvent(event, payload, eventId) {
  return apiRequest(`/api/bridge/bots/${encodeURIComponent(BOT_ID)}/event`, {
    method: 'POST',
    body: JSON.stringify({ event, payload, eventId }),
  });
}

async function registerBot(announce = true) {
  const bootId = Date.now();
  await sendBridgeEvent(
    'bot:hello',
    {
      id: BOT_ID,
      name: BOT_NAME,
      role: 'REST Polling & Serverless Worker',
      description: 'Bot eksternal berbasis REST polling aman-duplikasi untuk MuseHQ.',
      homeZone: BOT_HOME_ZONE,
      color: '#ec4899',
      type: 'external-rest',
      canDelegate: false,
    },
    `hello-${BOT_ID}-${bootId}`
  );

  if (announce) {
    await sendBridgeEvent(
      'bot:speech',
      {
        text: `${BOT_NAME} (${BOT_ID}) terhubung lewat REST Bridge & siap memantau /api/state!`,
      },
      `greet-${BOT_ID}-${bootId}`
    );
  }

  // Seed historical comms once so restarts do not reply to old chat messages,
  // while still picking up any pending tasks already assigned to this bot.
  const initialState = await apiRequest('/api/state');
  for (const msg of initialState.comms || []) {
    processedCommsIds.add(msg.id);
  }
  await processSnapshot(initialState);
  console.log(`[RESTBot] Terdaftar di ${BASE_URL} (initial cursor=${stateCursor}).`);
}

async function handleTask(task) {
  console.log(`[RESTBot] Menerima tugas baru [${task.id}]: ${task.title}`);
  await sendBridgeEvent('task:accept', { taskId: task.id }, `accept-${BOT_ID}-${task.id}`);
  await sendBridgeEvent(
    'bot:status',
    {
      status: 'working',
      zone: BOT_HOME_ZONE,
      speech: `Mengerjakan "${task.title}" via REST Bridge...`,
    },
    `status-work-${BOT_ID}-${task.id}`
  );

  await new Promise((resolve) => setTimeout(resolve, 1200));

  await sendBridgeEvent(
    'task:complete',
    {
      taskId: task.id,
      speech: `Selesai mengerjakan "${task.title}" via REST polling!`,
      result: [
        `#### Laporan ${BOT_NAME} (\`${BOT_ID}\`)`,
        `**Tugas:** ${task.title}`,
        `**Instruksi:** ${String(task.instructions || '').slice(0, 160)}`,
        '',
        '- Dieksekusi melalui mode REST Polling (`GET /api/state` + `POST /api/bridge/bots/:id/event`).',
        '- Dilindungi `eventId` idempotency dan pelacakan cursor agar bebas duplikasi.',
      ].join('\n'),
    },
    `complete-${BOT_ID}-${task.id}`
  );
}

async function processSnapshot(snapshot) {
  if (typeof snapshot.cursor === 'number' && snapshot.cursor > stateCursor) {
    stateCursor = snapshot.cursor;
  }

  for (const task of snapshot.tasks || []) {
    if (
      task.assignedToId === BOT_ID &&
      (task.status === 'assigned' || task.status === 'queued') &&
      !processedTaskIds.has(task.id)
    ) {
      processedTaskIds.add(task.id);
      await handleTask(task);
    }
  }

  for (const msg of snapshot.comms || []) {
    if (processedCommsIds.has(msg.id)) continue;
    processedCommsIds.add(msg.id);
    const contentLower = String(msg.content || '').toLowerCase();
    const isAddressed =
      msg.toId === BOT_ID ||
      contentLower.includes(`@${BOT_ID.toLowerCase()}`) ||
      contentLower.includes(`@${BOT_NAME.toLowerCase()}`);

    if (msg.fromId !== BOT_ID && msg.kind !== 'system' && isAddressed) {
      await sendBridgeEvent(
        'bot:speech',
        {
          text: `Siap ${msg.fromName || msg.fromId}, pesan tercatat oleh ${BOT_NAME} via REST!`,
          toId: msg.fromId,
        },
        `reply-${BOT_ID}-${msg.id}`
      );
    }
  }
}

async function pollOnce() {
  let snapshot = await apiRequest(`/api/state?since=${stateCursor}`);
  const cursorReset = typeof snapshot.cursor === 'number' && snapshot.cursor < stateCursor;
  const botMissing =
    Array.isArray(snapshot.agents) && !snapshot.agents.some((a) => a.id === BOT_ID);

  if (cursorReset || botMissing) {
    if (cursorReset) {
      stateCursor = 0;
    }
    if (botMissing) {
      await registerBot(false);
      snapshot = await apiRequest(`/api/state?since=${stateCursor}`);
    } else if (cursorReset) {
      snapshot = await apiRequest('/api/state');
      for (const msg of snapshot.comms || []) {
        processedCommsIds.add(msg.id);
      }
    }
  }

  await processSnapshot(snapshot);
  try {
    await sendBridgeEvent('bot:heartbeat', {});
  } catch (err) {
    if (String(err?.message || '').includes('HTTP 404')) {
      await registerBot(false);
    } else {
      throw err;
    }
  }
}

async function main() {
  await registerBot();
  console.log(`[RESTBot] Polling ${BASE_URL}/api/state setiap ${POLL_MS}ms...`);
  while (running) {
    try {
      await pollOnce();
    } catch (err) {
      console.error('[RESTBot] Gagal poll:', err?.message || err);
    }
    if (!running) break;
    await new Promise((resolve) => {
      sleepTimer = setTimeout(() => {
        sleepTimer = null;
        resolve();
      }, POLL_MS);
    });
  }
}

function shutdown() {
  running = false;
  if (sleepTimer) {
    clearTimeout(sleepTimer);
    sleepTimer = null;
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((err) => {
  console.error('[RESTBot] Fatal error:', err?.message || err);
  process.exit(1);
});
