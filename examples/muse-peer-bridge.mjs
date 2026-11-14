/**
 * Persistent auto-reconnecting External Bridge client for one Muse peer bot.
 *
 * Usage:
 *   BOT_BRIDGE_TOKEN="..." node examples/muse-peer-bridge.mjs --bot=muse-bagas
 *   npm run bridge:bot -- --bot=arif --url=wss://musehq.onrender.com/ws/bot
 */

import { pathToFileURL } from 'node:url';
import { createEnvReader, redactWsUrl } from './lib/env-loader.mjs';
import { resolveBridgeToken } from './lib/resolve-token.mjs';
import { resolvePeerPreset } from './lib/peer-presets.mjs';
import { describeBrainMode, executeForPeer } from './lib/brain-adapter.mjs';

const HEARTBEAT_MS = 20_000;
const INITIAL_RECONNECT_MS = 1_500;
const MAX_RECONNECT_MS = 30_000;
const CHAT_COOLDOWN_MS = 45_000;

export function parseCliArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const eq = token.indexOf('=');
    if (eq > -1) {
      args[token.slice(2, eq)] = token.slice(eq + 1);
    } else {
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[token.slice(2)] = next;
        i += 1;
      } else {
        args[token.slice(2)] = 'true';
      }
    }
  }
  return args;
}

function buildConnectUrl(baseWsUrl, token, agentId) {
  const cleanBase = baseWsUrl.trim().replace(/\/+$/, '');
  const sep = cleanBase.includes('?') ? '&' : '?';
  const hasToken = /([?&])token=/.test(cleanBase);
  const withToken = hasToken ? cleanBase : `${cleanBase}${sep}token=${encodeURIComponent(token)}`;
  const joiner = withToken.includes('?') ? '&' : '?';
  return /([?&])agentId=/.test(withToken)
    ? withToken
    : `${withToken}${joiner}agentId=${encodeURIComponent(agentId)}`;
}

/** Create a managed auto-reconnecting WebSocket bridge client for a single peer bot. */
export function createPeerBridgeClient({ peer, wsUrl, token, env, announceOnBoot = true }) {
  const connectUrl = buildConnectUrl(wsUrl, token, peer.id);
  const safeLogUrl = redactWsUrl(connectUrl);
  const processedTaskIds = new Set();
  const processedCommsIds = new Set();
  const lastChatReplyBySender = new Map();

  let ws = null;
  let stopped = false;
  let announced = false;
  let reconnectAttempt = 0;
  let heartbeatTimer = null;
  let reconnectTimer = null;
  let greetTimer = null;

  const clearTimers = () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (greetTimer) clearTimeout(greetTimer);
    heartbeatTimer = null;
    reconnectTimer = null;
    greetTimer = null;
  };

  const send = (event, payload, eventId) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify({ event, payload, ...(eventId ? { eventId } : {}) }));
    return true;
  };

  const handleAssignedTask = async (payload) => {
    const { taskId, title, instructions, context, missionId, assignedById } = payload;
    if (!taskId || processedTaskIds.has(taskId)) return;
    processedTaskIds.add(taskId);

    console.log(`[${peer.id}] Tugas masuk (${taskId}): ${title}`);
    send('task:accept', { taskId }, `accept-${peer.id}-${taskId}`);
    send('bot:status', {
      status: 'working',
      zone: peer.homeZone,
      taskId,
      speech: `Mengerjakan: ${String(title || 'tugas').slice(0, 60)}`,
    });

    try {
      const outcome = await executeForPeer({
        peer,
        env,
        kind: 'task',
        title: title || 'Tugas MuseHQ',
        instructions: instructions || '',
        context: context || '',
        fromName: assignedById || 'Owner',
      });

      if (peer.canDelegate && outcome.delegations.length > 0) {
        for (let idx = 0; idx < outcome.delegations.length; idx++) {
          const del = outcome.delegations[idx];
          send(
            'bot:delegate',
            {
              toAgentId: del.toAgentId,
              title: del.title,
              instructions: del.instructions,
              ...(missionId ? { missionId } : {}),
              parentTaskId: taskId,
            },
            `delegate-${peer.id}-${taskId}-${idx}`
          );
        }
        // Ensure child tasks are recorded before completing coordinator task
        await new Promise((r) => setTimeout(r, 150));
      }

      send(
        'task:complete',
        {
          taskId,
          speech: outcome.speech,
          result: outcome.result,
        },
        `complete-${peer.id}-${taskId}`
      );
      console.log(`[${peer.id}] Tugas selesai (${outcome.modeUsed}): ${title}`);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      send('task:fail', { taskId, error: errMsg }, `fail-${peer.id}-${taskId}`);
      console.error(`[${peer.id}] Tugas gagal: ${errMsg}`);
    }
  };

  const handleCommsMessage = async (msg) => {
    if (!msg?.content || msg.fromId === peer.id || msg.fromId === 'system') return;
    if (msg.id && processedCommsIds.has(msg.id)) return;
    if (msg.id) processedCommsIds.add(msg.id);
    if (msg.kind !== 'chat') return;

    const lower = String(msg.content).toLowerCase();
    const isDirect = msg.toId === peer.id;
    const isMentioned =
      lower.includes(`@${peer.id.toLowerCase()}`) ||
      lower.includes(`@${peer.name.toLowerCase()}`) ||
      lower.includes(`@${peer.id.replace(/^muse-/, '').toLowerCase()}`);

    if (!isDirect && !isMentioned) return;

    // Prevent bot-to-bot reply ping-pong loops with a per-sender cooldown
    if (msg.fromId !== 'user') {
      const last = lastChatReplyBySender.get(msg.fromId) || 0;
      if (Date.now() - last < CHAT_COOLDOWN_MS) return;
      lastChatReplyBySender.set(msg.fromId, Date.now());
    }

    const reply = await executeForPeer({
      peer,
      env,
      kind: 'chat',
      title: 'Chat Ruangan',
      instructions: msg.content,
      fromName: msg.fromName || msg.fromId,
    });
    const text = String(reply.result || reply.speech || '').slice(0, 280).trim();
    if (!text) return;

    send(
      'bot:speech',
      {
        text,
        toId: msg.fromId === 'user' ? 'user' : msg.fromId,
      },
      `chat-reply-${peer.id}-${msg.id || Date.now()}`
    );
  };

  const scheduleReconnect = () => {
    if (stopped || reconnectTimer) return;
    const delay = Math.min(MAX_RECONNECT_MS, Math.round(INITIAL_RECONNECT_MS * 1.5 ** reconnectAttempt));
    reconnectAttempt += 1;
    console.log(`[${peer.id}] Menyambung ulang dalam ${delay}ms...`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  const connect = () => {
    if (stopped) return;
    console.log(`[${peer.id}] Menghubungkan (${describeBrainMode(peer, env)}) -> ${safeLogUrl}`);
    const socket = new WebSocket(connectUrl);
    ws = socket;

    socket.addEventListener('open', () => {
      reconnectAttempt = 0;
      send(
        'bot:hello',
        {
          id: peer.id,
          name: peer.name,
          role: peer.role,
          description: peer.description,
          homeZone: peer.homeZone,
          color: peer.color,
          canDelegate: peer.canDelegate,
        },
        `hello-${peer.id}-${Date.now()}`
      );

      if (announceOnBoot && !announced) {
        announced = true;
        greetTimer = setTimeout(() => {
          greetTimer = null;
          send('bot:speech', {
            text: `Halo tim! ${peer.name} siap bekerja di ${peer.homeZone}.`,
          });
        }, 700);
      }

      heartbeatTimer = setInterval(() => {
        send('bot:heartbeat', {});
      }, HEARTBEAT_MS);
    });

    socket.addEventListener('message', (evt) => {
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
        console.log(`[${peer.id}] Aktif di zona "${peer.homeZone}" (${peer.name}).`);
        return;
      }
      if (event === 'error') {
        console.error(`[${peer.id}] Pesan error dari server: ${payload?.message || 'unknown'}`);
        return;
      }
      if (event === 'task:assigned' && payload?.taskId) {
        void handleAssignedTask(payload);
        return;
      }
      if (event === 'comms:message' && payload) {
        void handleCommsMessage(payload);
      }
    });

    socket.addEventListener('close', (evt) => {
      clearTimers();
      if (ws === socket) ws = null;
      if (!stopped) {
        console.warn(`[${peer.id}] Koneksi ditutup (code=${evt.code}, reason=${evt.reason || 'none'}).`);
        scheduleReconnect();
      }
    });

    socket.addEventListener('error', (err) => {
      console.error(`[${peer.id}] WebSocket error: ${err?.message || 'connection error'}`);
    });
  };

  return {
    peer,
    start() {
      stopped = false;
      connect();
    },
    stop() {
      stopped = true;
      clearTimers();
      if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        try {
          ws.close(1000, 'Client shutdown');
        } catch {
          // Ignore close failures during shutdown
        }
      }
      ws = null;
    },
  };
}

function runCli() {
  const args = parseCliArgs();
  const env = createEnvReader(args.env ? [args.env] : []);
  const wsUrl = args.url || env.get('MUSE_WS_URL', 'wss://musehq.onrender.com/ws/bot');
  const token = resolveBridgeToken(wsUrl, args.env ? [args.env] : []);
  const peer = resolvePeerPreset(args.bot || env.get('BOT_ID', 'muse-bagas'), env);

  const client = createPeerBridgeClient({ peer, wsUrl, token, env });
  client.start();

  const shutdown = () => {
    client.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli();
}
