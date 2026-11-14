/**
 * Contoh script Bot Eksternal (REST Polling Mode) untuk lingkungan tanpa WebSocket persisten (mis. Vercel Serverless).
 * Membaca GET /api/state?since=<cursor>, memproses tugas tanpa duplikasi,
 * dan mengirim update ke POST /api/bridge/bots/:id/event.
 *
 * Jalankan: npm run example:rest-bot
 * Env opsional: MUSE_BASE_URL, BOT_BRIDGE_TOKEN, BOT_ID, BOT_NAME, BOT_HOME_ZONE, POLL_MS, VERCEL_BYPASS_SECRET
 */

import { createEnvReader } from './lib/env-loader.mjs';
import {
  AUTH_RETRY_MESSAGE,
  computeAuthBackoffMs,
  resolveBridgeToken,
} from './lib/resolve-token.mjs';
import {
  NO_BRAIN_FAILURE_MESSAGE,
  describeBrainMode,
  executeForPeer,
  resolveReportedBrainMode,
} from './lib/brain-adapter.mjs';

const env = createEnvReader();
const BASE_URL = (process.env.MUSE_BASE_URL || env.get('MUSE_BASE_URL', 'http://localhost:3001')).replace(/\/+$/, '');
const BOT_ID = (process.env.BOT_ID || env.get('BOT_ID', 'muse-rest-worker')).trim();
const BOT_NAME = (process.env.BOT_NAME || env.get('BOT_NAME', 'Muse REST Worker')).trim();
const BOT_ROLE = (process.env.BOT_ROLE || env.get('BOT_ROLE', 'REST Polling & Serverless Worker')).trim();
const BOT_HOME_ZONE = (process.env.BOT_HOME_ZONE || env.get('BOT_HOME_ZONE', 'qa-bench')).trim();
const BOT_CAN_DELEGATE = String(process.env.BOT_CAN_DELEGATE || env.get('BOT_CAN_DELEGATE', 'false')).toLowerCase() === 'true';
const TOKEN = resolveBridgeToken(BASE_URL, [], BOT_ID);
const VERCEL_BYPASS_SECRET = process.env.VERCEL_BYPASS_SECRET?.trim() || '';
const rawPollMs = Number(process.env.POLL_MS || env.get('POLL_MS'));
const POLL_MS = Math.max(1000, Number.isFinite(rawPollMs) && rawPollMs > 0 ? rawPollMs : 2500);

const peer = {
  id: BOT_ID,
  envPrefix: BOT_ID.toUpperCase().replace(/[^A-Z0-9]+/g, '_'),
  name: BOT_NAME,
  role: BOT_ROLE,
  description: 'Bot eksternal berbasis REST polling aman-duplikasi untuk MuseHQ.',
  homeZone: BOT_HOME_ZONE,
  color: '#ec4899',
  canDelegate: BOT_CAN_DELEGATE,
};

const processedTaskIds = new Set();
const processedCommsIds = new Set();
let stateCursor = 0;
let registered = false;
let running = true;
let sleepTimer = null;

class HttpStatusError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

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
    throw new HttpStatusError(res.status, `HTTP ${res.status} pada ${path}: ${text.slice(0, 200)}`);
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
  const brainMode = resolveReportedBrainMode(peer, env);
  await sendBridgeEvent(
    'bot:hello',
    {
      id: BOT_ID,
      name: BOT_NAME,
      role: BOT_ROLE,
      description: peer.description,
      homeZone: BOT_HOME_ZONE,
      color: peer.color,
      type: 'external-rest',
      canDelegate: BOT_CAN_DELEGATE,
      brainMode,
    },
    `hello-${BOT_ID}-${bootId}`
  );

  if (announce) {
    await sendBridgeEvent(
      'bot:speech',
      {
        text: `${BOT_NAME} (${BOT_ID}) terhubung lewat REST Bridge (${brainMode})!`,
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
  registered = true;
  console.log(`[RESTBot] Terdaftar di ${BASE_URL} (${describeBrainMode(peer, env)}, cursor=${stateCursor}).`);
}

async function handleTask(task) {
  console.log(`[RESTBot] Menerima tugas baru [${task.id}]: ${task.title}`);
  await sendBridgeEvent('task:accept', { taskId: task.id }, `accept-${BOT_ID}-${task.id}`);
  await sendBridgeEvent(
    'bot:status',
    {
      status: 'working',
      zone: BOT_HOME_ZONE,
      taskId: task.id,
      speech: `Mengerjakan "${task.title}" via REST Bridge...`,
    },
    `status-work-${BOT_ID}-${task.id}`
  );

  const outcome = await executeForPeer({
    peer,
    env,
    kind: 'task',
    title: task.title || 'Tugas REST',
    instructions: task.instructions || '',
    context: '',
    fromName: task.assignedById || 'Owner',
  });

  if (outcome.failed) {
    const error = outcome.error || NO_BRAIN_FAILURE_MESSAGE;
    await sendBridgeEvent('task:fail', { taskId: task.id, error }, `fail-${BOT_ID}-${task.id}`);
    console.error(`[RESTBot] Tugas GAGAL (${outcome.modeUsed || 'fallback'}): ${error}`);
    return;
  }

  if (BOT_CAN_DELEGATE && outcome.delegations.length > 0) {
    for (let idx = 0; idx < outcome.delegations.length; idx++) {
      const del = outcome.delegations[idx];
      await sendBridgeEvent(
        'bot:delegate',
        {
          toAgentId: del.toAgentId,
          title: del.title,
          instructions: del.instructions,
          ...(task.missionId ? { missionId: task.missionId } : {}),
          parentTaskId: task.id,
        },
        `delegate-${BOT_ID}-${task.id}-${idx}`
      );
    }
  }

  await sendBridgeEvent(
    'task:complete',
    {
      taskId: task.id,
      speech: outcome.speech,
      result: outcome.result,
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
      const reply = await executeForPeer({
        peer,
        env,
        kind: 'chat',
        title: 'Chat Ruangan',
        instructions: msg.content,
        fromName: msg.fromName || msg.fromId,
      });
      if (!reply.failed) {
        const text = String(reply.result || reply.speech || '').slice(0, 280).trim();
        if (text) {
          await sendBridgeEvent('bot:speech', { text, toId: msg.fromId }, `reply-${BOT_ID}-${msg.id}`);
        }
      }
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
    if (err instanceof HttpStatusError && err.status === 404) {
      await registerBot(false);
    } else {
      throw err;
    }
  }
}

async function main() {
  console.log(`[RESTBot] Memulai polling ${BASE_URL} untuk "${BOT_ID}" (dasar ${POLL_MS}ms)...`);
  let authRetryAttempt = 0;

  while (running) {
    let nextWaitMs = POLL_MS;
    try {
      if (!registered) {
        await registerBot(true);
      } else {
        await pollOnce();
      }
      authRetryAttempt = 0;
    } catch (err) {
      if (err instanceof HttpStatusError && err.status === 401) {
        nextWaitMs = computeAuthBackoffMs(authRetryAttempt);
        authRetryAttempt += 1;
        console.error(`[RESTBot] HTTP 401: ${AUTH_RETRY_MESSAGE} (coba lagi dalam ${nextWaitMs}ms)`);
      } else {
        console.error('[RESTBot] Gagal poll:', err?.message || err);
      }
    }
    if (!running) break;
    await new Promise((resolve) => {
      sleepTimer = setTimeout(() => {
        sleepTimer = null;
        resolve();
      }, nextWaitMs);
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
