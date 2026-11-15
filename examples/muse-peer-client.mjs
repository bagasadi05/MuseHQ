/**
 * TEMPLATE client kotak surat (mailbox REST Bridge) untuk peer MuseHQ — TANPA API key LLM.
 *
 * Berbeda dari `examples/muse-peer-bridge.mjs` (worker otonom berbasis LLM/upstream),
 * client ini bertindak sebagai KOTAK SURAT persisten untuk sesi Muse langsung (`brainMode: "muse-langsung"`):
 *  - Long-poll instan `GET /api/bridge/bots/:id/events?since=<cursor>&waitMs=18000`
 *    disertai sinkronisasi state `/api/state` yang tahan server restart.
 *  - Tugas baru untuk bot ini -> `task:accept`, pindah zona otomatis (`ZONE_BY_KEYWORD`),
 *    status `working`, dan tulis antrean ke `inbox/tasks/<taskId>.json`.
 *  - Pesan chat / sebutan `@<BOT_ID>` -> tulis ke `inbox/comms/<id>.json` (tanpa ack loop antar-bot).
 *  - Hasil kerja dari Muse: tulis `outbox/<taskId>.json` berisi `{ result, speech? }`
 *    (atau `{ failed: true, error }` untuk gagal jujur `task:fail`) -> otomatis terkirim,
 *    lalu file dipindah ke `outbox/done/` (atau `outbox/failed/` bila ditolak permanen).
 *  - Memberi delegasi ke peer lain: tulis `outbox/delegate/<nama>.json` berisi
 *    `{ toAgentId, title, instructions, missionId?, parentTaskId? }` -> dikirim via `bot:delegate`,
 *    lalu dipindah ke `outbox/delegate/sent/` atau `outbox/delegate/failed/`.
 *  - Hasil peer lain yang selesai -> ditulis ke `inbox/results/<taskId>.json`.
 *  - Menjaga tugas panjang agar tidak ditandai `stuck` lewat `progressPing` tiap 5 menit,
 *    mendukung obrolan kantor hemat (`AMBIENT_CHAT`), dan backoff 401 (5 detik -> 60 detik).
 *
 * Contoh jalankan:
 *   BOT_BRIDGE_TOKEN="<token>" node examples/muse-peer-client.mjs --bot=muse-arif --url=https://musehq.onrender.com
 *   MUSE_MAILBOX_DIR=./mailbox-arif BOT_BRIDGE_TOKEN="<token>" node examples/muse-peer-client.mjs --bot=muse-arif
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sanitizeCleanText, sanitizeSpeechText, sanitizeTitleText } from './lib/brain-adapter.mjs';
import { createEnvReader } from './lib/env-loader.mjs';
import { resolvePeerPreset } from './lib/peer-presets.mjs';
import {
  AUTH_RETRY_MESSAGE,
  computeAuthBackoffMs,
  resolveBridgeToken,
} from './lib/resolve-token.mjs';
import { parseCliArgs } from './muse-peer-bridge.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class HttpBridgeError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const BOT_DISPLAY_NAMES = {
  'muse-bagas': 'Muse Bagas',
  'muse-arif': 'Muse Arif',
  'muse-niro': 'Muse Niro',
  'muse-joni': 'Muse Joni',
};

const ZONE_BY_KEYWORD = [
  [/\b(?:riset|research|analisis|analisa|strategi|data|survei|pesaing)\b/i, 'research-library'],
  [/\b(?:desain|design|gambar|svg|ilustrasi|video|foto|kreatif|konten|poster|logo|pantun|puisi|cerita)\b/i, 'creative-studio'],
  [/\b(?:kode|code|script|server|deploy|debug|bot|api|website|web|webhook|aplikasi|database)\b/i, 'engineering-bay'],
  [/\b(?:rencana|koordinasi|misi|mission|rapat|evaluasi|review|uji|test|qa|rangkum|laporan)\b/i, 'war-room'],
];

const PROGRESS_NOTES = [
  (t) => `Masih mengerjakan "${t}"...`,
  (t) => `"${t}" sedang diproses — mohon tunggu sebentar.`,
  (t) => `Progres terus berjalan, "${t}" belum selesai.`,
];

const AMBIENT_LINES = {
  'muse-bagas': [
    'Ruangan lagi tenang, enak buat fokus.',
    'Ada yang butuh bantuan, panggil saja.',
    'Istirahat kopi sebentar di lounge.',
  ],
  'muse-arif': [
    'Sedang membaca referensi, menemukan beberapa poin menarik.',
    'Riset berjalan lancar, sebentar lagi hasilnya siap.',
  ],
  'muse-niro': [
    'Sedang menyusun sketsa ide dan copywriting baru.',
    'Review visual hari ini cukup rapi, tinggal sentuhan akhir.',
  ],
  'muse-joni': [
    'Server aman dan seluruh layanan terpantau stabil.',
    'Sedang memeriksa metrik sistem, sejauh ini lancar.',
  ],
};
const AMBIENT_DEFAULT = ['Sedang standby di ruangan, panggil saja jika diperlukan.'];

const AMBIENT_PER_BOT_MS = 45 * 60 * 1000;
const AMBIENT_ROOM_GAP_MS = 15 * 60 * 1000;
const PROGRESS_PING_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_BASE_MS = 20_000;

function zoneForTask(task, fallbackZone) {
  const hay = `${task.title || ''} ${task.instructions || ''}`;
  for (const [re, zone] of ZONE_BY_KEYWORD) {
    if (re.test(hay)) return zone;
  }
  return fallbackZone || 'qa-bench';
}

function isUnregisteredError(err) {
  return (
    err instanceof HttpBridgeError &&
    err.status === 404 &&
    /belum terdaftar|Bot\s+["']?[^"'\s]+["']?\s+tidak ditemukan/i.test(String(err.message || ''))
  );
}

function ensureMailboxLayout(mailboxDir) {
  const paths = {
    root: mailboxDir,
    inboxTasks: path.join(mailboxDir, 'inbox', 'tasks'),
    inboxComms: path.join(mailboxDir, 'inbox', 'comms'),
    inboxResults: path.join(mailboxDir, 'inbox', 'results'),
    outbox: path.join(mailboxDir, 'outbox'),
    outboxDone: path.join(mailboxDir, 'outbox', 'done'),
    outboxFailed: path.join(mailboxDir, 'outbox', 'failed'),
    delegateDir: path.join(mailboxDir, 'outbox', 'delegate'),
    delegateSent: path.join(mailboxDir, 'outbox', 'delegate', 'sent'),
    delegateFailed: path.join(mailboxDir, 'outbox', 'delegate', 'failed'),
    stateFile: path.join(mailboxDir, 'state.json'),
    logFile: path.join(mailboxDir, 'bridge.log'),
  };

  for (const dir of [
    paths.inboxTasks,
    paths.inboxComms,
    paths.inboxResults,
    paths.outbox,
    paths.outboxDone,
    paths.outboxFailed,
    paths.delegateDir,
    paths.delegateSent,
    paths.delegateFailed,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  return paths;
}

function moveFileSafe(src, dest) {
  try {
    fs.renameSync(src, dest);
  } catch {
    fs.copyFileSync(src, dest);
    fs.unlinkSync(src);
  }
}

function moveToFailed(srcFile, failedDir, fileName, baseRecord, errorMsg) {
  const failedRecord = {
    ...baseRecord,
    error: String(errorMsg || 'unknown error'),
    failedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(failedDir, fileName), JSON.stringify(failedRecord, null, 2));
  try {
    fs.unlinkSync(srcFile);
  } catch {
    // ignore
  }
}

/**
 * Creates a REST mailbox client reporting `brainMode: "muse-langsung"` with long-poll,
 * optional filesystem `inbox/`/`outbox/` queue support, and 401 exponential backoff.
 */
export function createMailboxClient({
  baseUrl,
  botId,
  token,
  peer,
  pollMs = 3000,
  waitMs = 18_000,
  mailboxDir,
  ambientChat = false,
  announceOnBoot,
}) {
  const cleanUrl = baseUrl.replace(/\/+$/, '');
  const rawWait = Number(waitMs);
  const defaultWaitMs = Number.isFinite(rawWait)
    ? Math.min(20_000, Math.max(0, Math.floor(rawWait)))
    : 18_000;
  const idlePollMs = Math.max(50, Number(pollMs) || 3000);
  const hasMailbox = Boolean(mailboxDir && String(mailboxDir).trim());
  const paths = hasMailbox ? ensureMailboxLayout(path.resolve(String(mailboxDir))) : null;
  const shouldGreetOnBoot = announceOnBoot ?? hasMailbox;

  let eventsCursor = 0;
  let stateCursor = 0;
  let running = false;
  let stopped = false;
  let registered = false;
  let lastPollHadFreshWork = false;
  let timer = null;
  let outboxTimer = null;
  let watchers = [];
  let outboxDebounce = null;
  let flushingOutbox = false;
  let resolveSleep = null;
  const activeControllers = new Set();

  let lastProgressPingAt = 0;
  let progressPingCount = 0;
  let lastAmbientAt = Date.now();
  let ambientCount = 0;

  // Persistent dedup state when `mailboxDir` is enabled (in-memory bounded set otherwise)
  const hadSavedState = Boolean(paths && fs.existsSync(paths.stateFile));
  let persisted = { cursor: 0, seenTaskIds: [], seenCommsIds: [], seenResultTaskIds: [] };
  if (hadSavedState) {
    try {
      const parsed = JSON.parse(fs.readFileSync(paths.stateFile, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        persisted = { ...persisted, ...parsed };
      }
    } catch {
      // start with fresh state if state.json is corrupt
    }
  }
  const seenTasks = new Set(persisted.seenTaskIds || []);
  const seenComms = new Set(persisted.seenCommsIds || []);
  const seenResults = new Set(persisted.seenResultTaskIds || []);
  const knownBotIds = new Set([botId, ...Object.keys(BOT_DISPLAY_NAMES)]);
  if (typeof persisted.cursor === 'number' && persisted.cursor >= 0) {
    stateCursor = persisted.cursor;
  }

  const log = (msg, isError = false) => {
    const line = `[${botId}] ${msg}`;
    if (isError) {
      console.error(line);
    } else {
      console.log(line);
    }
    if (paths) {
      try {
        fs.appendFileSync(paths.logFile, `[${new Date().toISOString()}] ${line}\n`);
      } catch {
        // ignore disk log errors
      }
    }
  };

  const saveState = () => {
    if (!paths) return;
    const data = {
      cursor: stateCursor,
      seenTaskIds: [...seenTasks].slice(-500),
      seenCommsIds: [...seenComms].slice(-500),
      seenResultTaskIds: [...seenResults].slice(-500),
    };
    fs.writeFileSync(paths.stateFile, JSON.stringify(data, null, 2));
  };

  const formatBotName = (id) => BOT_DISPLAY_NAMES[id] || id;

  const requestJson = async (apiPath, options = {}, timeoutMs = REQUEST_TIMEOUT_BASE_MS) => {
    const controller = new AbortController();
    activeControllers.add(controller);
    const timeoutHandle = setTimeout(() => {
      // Pass explicit Error so timeouts retry instead of triggering `err.name === 'AbortError'` loop shutdown
      controller.abort(new Error(`Request timeout (${timeoutMs}ms) pada ${apiPath}`));
    }, timeoutMs);

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
        throw new HttpBridgeError(res.status, `HTTP ${res.status} pada ${apiPath}: ${body.slice(0, 180)}`);
      }
      return res.json();
    } finally {
      clearTimeout(timeoutHandle);
      activeControllers.delete(controller);
    }
  };

  const sendEvent = (event, payload = {}, eventId) =>
    requestJson(`/api/bridge/bots/${encodeURIComponent(botId)}/event`, {
      method: 'POST',
      body: JSON.stringify({ event, payload, ...(eventId ? { eventId } : {}) }),
    });

  const handleTaskFromSnapshot = async (task) => {
    if (!paths) return;
    const cleanTitle = sanitizeTitleText(task.title || 'Tugas Baru', 'Tugas Baru');
    log(`Tugas baru [${task.id}]: ${cleanTitle}`);

    await sendEvent('task:accept', { taskId: task.id }, `accept-${botId}-${task.id}`);
    const zone = zoneForTask(task, peer.homeZone);
    await sendEvent(
      'bot:status',
      {
        status: 'working',
        taskId: task.id,
        zone,
        speech: sanitizeSpeechText(`Mengerjakan "${cleanTitle}"...`),
      },
      `status-work-${botId}-${task.id}`
    );
    lastProgressPingAt = Date.now();

    const record = {
      taskId: task.id,
      missionId: task.missionId || null,
      parentTaskId: task.parentTaskId || null,
      title: cleanTitle,
      instructions: sanitizeCleanText(task.instructions || ''),
      context: task.context || null,
      assignedById: task.assignedById || null,
      receivedAt: new Date().toISOString(),
      status: 'queued',
    };
    fs.writeFileSync(path.join(paths.inboxTasks, `${task.id}.json`), JSON.stringify(record, null, 2));
    saveState();
  };

  const handleCommsFromSnapshot = async (msg) => {
    if (!paths) return;
    const record = {
      id: msg.id,
      missionId: msg.missionId || null,
      fromId: msg.fromId || null,
      fromName: msg.fromName || null,
      toId: msg.toId || null,
      kind: msg.kind || 'chat',
      content: sanitizeCleanText(msg.content || ''),
      receivedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(paths.inboxComms, `${msg.id}.json`), JSON.stringify(record, null, 2));

    // Never auto-ack messages from bots or ack strings to avoid ping-pong loops
    const fromId = String(msg.fromId || '');
    const content = String(msg.content || '');
    const isAck = /^Siap .*, pesannya kuterima/.test(content);
    const isBot = fromId === botId || fromId.startsWith('muse-') || knownBotIds.has(fromId);
    if (isAck || isBot || msg.kind === 'delegation' || msg.kind === 'command') {
      saveState();
      return;
    }

    const senderLabel = sanitizeTitleText(msg.fromName || msg.fromId || 'Owner', 'Owner');
    await sendEvent(
      'bot:speech',
      {
        text: sanitizeSpeechText(`Siap ${senderLabel}, pesannya kuterima — aku proses dulu ya.`),
        toId: msg.fromId,
      },
      `reply-${botId}-${msg.id}`
    );
    saveState();
  };

  const processSnapshot = async (snapshot) => {
    for (const agent of snapshot.agents || []) {
      if (agent?.id) knownBotIds.add(agent.id);
    }
    if (typeof snapshot.cursor === 'number' && snapshot.cursor > stateCursor) {
      stateCursor = snapshot.cursor;
    }

    for (const task of snapshot.tasks || []) {
      if (
        task.assignedToId === botId &&
        (task.status === 'assigned' || task.status === 'queued') &&
        !seenTasks.has(task.id)
      ) {
        seenTasks.add(task.id);
        await handleTaskFromSnapshot(task);
      }
    }

    for (const msg of snapshot.comms || []) {
      if (seenComms.has(msg.id)) continue;
      seenComms.add(msg.id);
      if (
        msg.fromId !== botId &&
        msg.kind !== 'system' &&
        (msg.toId === botId || String(msg.content || '').toLowerCase().includes(`@${botId}`))
      ) {
        await handleCommsFromSnapshot(msg);
      }
    }
  };

  const collectResults = async (snapshot, { announce = true } = {}) => {
    if (!paths) return;
    const arrived = [];
    for (const task of snapshot.tasks || []) {
      if (task.assignedToId === botId) continue;
      if (task.status !== 'completed') continue;
      if (!task.result || seenResults.has(task.id)) continue;
      seenResults.add(task.id);

      const cleanTitle = sanitizeTitleText(task.title || 'Tugas Selesai', 'Tugas Selesai');
      const record = {
        taskId: task.id,
        missionId: task.missionId || null,
        parentTaskId: task.parentTaskId || null,
        assignedById: task.assignedById || null,
        assignedToId: task.assignedToId,
        title: cleanTitle,
        result: sanitizeCleanText(task.result),
        completedAt: task.completedAt || new Date().toISOString(),
        receivedAt: new Date().toISOString(),
      };
      fs.writeFileSync(path.join(paths.inboxResults, `${task.id}.json`), JSON.stringify(record, null, 2));
      log(`Hasil diterima dari ${task.assignedToId} [${task.id}]: ${cleanTitle}`);
      arrived.push({ name: formatBotName(task.assignedToId), title: cleanTitle });
    }

    if (announce && arrived.length > 0) {
      const ringkas = arrived.map((a) => `${a.name}: "${a.title}"`).join('; ');
      await sendEvent(
        'bot:speech',
        { text: sanitizeSpeechText(`Hasil masuk — ${ringkas}`) },
        `result-speech-${botId}-${Date.now()}`
      );
    }
  };

  const flushOutbox = async () => {
    if (!paths || stopped) return;
    for (const file of fs.readdirSync(paths.outbox)) {
      if (!file.endsWith('.json')) continue;
      const full = path.join(paths.outbox, file);
      let payload;
      try {
        payload = JSON.parse(fs.readFileSync(full, 'utf8'));
      } catch (err) {
        moveToFailed(full, paths.outboxFailed, file, { file }, `bukan JSON valid: ${err?.message || err}`);
        log(`Outbox ${file} bukan JSON valid, dipindah ke outbox/failed/.`, true);
        continue;
      }

      const taskId = String(payload.taskId || file.replace(/\.json$/, '')).trim();
      const isFailure =
        payload.failed === true ||
        payload.status === 'failed' ||
        (typeof payload.error === 'string' && payload.error.trim().length > 0 && !payload.result);

      try {
        if (isFailure) {
          const errorMsg = sanitizeCleanText(
            String(payload.error || payload.reason || 'Tugas tidak dapat diselesaikan.'),
            { singleLine: true }
          );
          await sendEvent(
            'task:fail',
            { taskId, error: errorMsg },
            `fail-${botId}-${taskId}-${Date.now()}`
          );
          log(`task:fail terkirim untuk ${taskId}.`);
        } else {
          const result = sanitizeCleanText(String(payload.result || 'Selesai.'));
          const speech = sanitizeSpeechText(String(payload.speech || `Selesai: ${taskId}`));
          await sendEvent(
            'task:complete',
            { taskId, speech, result },
            `complete-${botId}-${taskId}-${Date.now()}`
          );
          log(`task:complete terkirim untuk ${taskId}.`);
        }

        await sendEvent(
          'bot:status',
          { status: 'idle', zone: 'coffee-lounge' },
          `status-idle-${botId}-${taskId}-${Date.now()}`
        );
        moveFileSafe(full, path.join(paths.outboxDone, file));
      } catch (err) {
        if (err instanceof HttpBridgeError && err.status === 401) {
          throw err;
        }
        if (isUnregisteredError(err)) {
          registered = false;
          throw err;
        }
        if (err instanceof HttpBridgeError && (err.status === 400 || err.status === 404)) {
          moveToFailed(full, paths.outboxFailed, file, payload, err.message);
          log(`Outbox ${file} ditolak server (${err.status}), dipindah ke outbox/failed/: ${err.message}`, true);
        } else {
          log(`Gagal kirim outbox ${taskId}: ${err?.message || err}`, true);
        }
      }
    }
  };

  const flushDelegations = async () => {
    if (!paths || stopped) return;
    const delegated = [];

    for (const file of fs.readdirSync(paths.delegateDir)) {
      if (!file.endsWith('.json')) continue;
      const full = path.join(paths.delegateDir, file);
      let order;
      try {
        order = JSON.parse(fs.readFileSync(full, 'utf8'));
      } catch (err) {
        moveToFailed(full, paths.delegateFailed, file, { file }, `bukan JSON valid: ${err?.message || err}`);
        log(`Delegasi ${file} bukan JSON valid, dipindah ke delegate/failed/.`, true);
        continue;
      }

      const toAgentId = String(order.toAgentId || '').trim();
      const title = sanitizeTitleText(String(order.title || 'Tugas Delegasi'), 'Tugas Delegasi');
      const instructions = sanitizeCleanText(String(order.instructions || ''));
      const missionId = order.missionId ? String(order.missionId).trim() : undefined;
      const parentTaskId = order.parentTaskId ? String(order.parentTaskId).trim() : undefined;

      if (!toAgentId || !instructions) {
        moveToFailed(
          full,
          paths.delegateFailed,
          file,
          order,
          'Field toAgentId dan instructions wajib diisi'
        );
        log(`Delegasi ${file} tidak lengkap, dipindah ke delegate/failed/.`, true);
        continue;
      }

      try {
        const res = await sendEvent(
          'bot:delegate',
          {
            toAgentId,
            title,
            instructions,
            ...(missionId ? { missionId } : {}),
            ...(parentTaskId ? { parentTaskId } : {}),
          },
          `delegate-${botId}-${toAgentId}-${Date.now()}`
        );
        if (res?.failed) {
          moveToFailed(
            full,
            paths.delegateFailed,
            file,
            { ...order, serverResponse: res },
            res.error || 'Delegasi ditolak target'
          );
          log(`Delegasi ke ${toAgentId} gagal: ${res.error || 'ditolak'}`, true);
          continue;
        }
        const sent = { ...order, sentAt: new Date().toISOString(), serverResponse: res || null };
        fs.writeFileSync(path.join(paths.delegateSent, file), JSON.stringify(sent, null, 2));
        fs.unlinkSync(full);
        delegated.push({ toAgentId, title });
        log(`Delegasi terkirim ke ${toAgentId}: "${title}".`);
      } catch (err) {
        if (err instanceof HttpBridgeError && err.status === 401) {
          throw err;
        }
        if (isUnregisteredError(err)) {
          registered = false;
          throw err;
        }
        moveToFailed(full, paths.delegateFailed, file, order, err?.message || String(err));
        log(`Gagal delegasi ke ${toAgentId}: ${err?.message || err}`, true);
      }
    }

    if (delegated.length > 0) {
      const ringkas = delegated.map((d) => `${formatBotName(d.toAgentId)}: "${d.title}"`).join('; ');
      await sendEvent(
        'bot:speech',
        { text: sanitizeSpeechText(`Delegasi berjalan: ${ringkas}`) },
        `delegate-speech-${botId}-${Date.now()}`
      );
    }
  };

  const flushLocalQueues = async () => {
    if (!paths || stopped || flushingOutbox) return;
    flushingOutbox = true;
    try {
      await flushOutbox();
      await flushDelegations();
    } finally {
      flushingOutbox = false;
    }
  };

  const progressPing = async (snapshot) => {
    if (!paths) return;
    const open = (snapshot.tasks || []).filter(
      (t) => t.assignedToId === botId && ['assigned', 'queued', 'working'].includes(t.status)
    );
    if (open.length === 0) return;
    const now = Date.now();
    if (now - lastProgressPingAt < PROGRESS_PING_MS) return;

    const task = open[0];
    const title = sanitizeTitleText(task.title || 'tugas', 'tugas');
    const note = PROGRESS_NOTES[progressPingCount % PROGRESS_NOTES.length](title);
    progressPingCount += 1;
    lastProgressPingAt = now;

    try {
      await sendEvent(
        'bot:status',
        { status: 'thinking', taskId: task.id, speech: sanitizeSpeechText(note) },
        `progress-${botId}-${task.id}-${now}`
      );
    } catch (err) {
      if (err instanceof HttpBridgeError && err.status === 401) throw err;
      log(`Gagal kirim kabar progres: ${err?.message || err}`, true);
    }
  };

  const maybeAmbientChat = async (snapshot) => {
    if (!paths || !ambientChat) return;
    const now = Date.now();
    if (now - lastAmbientAt < AMBIENT_PER_BOT_MS) return;

    const hasOpenTask = (snapshot.tasks || []).some(
      (t) => t.assignedToId === botId && ['assigned', 'queued', 'working'].includes(t.status)
    );
    if (hasOpenTask) return;

    const hasRecentRoomComms = (snapshot.comms || []).some((m) => {
      const ts = Date.parse(m.createdAt || m.timestamp || '');
      return Number.isFinite(ts) && now - ts < AMBIENT_ROOM_GAP_MS;
    });
    if (hasRecentRoomComms) return;

    const lines = AMBIENT_LINES[botId] || AMBIENT_DEFAULT;
    const text = lines[ambientCount % lines.length];
    ambientCount += 1;
    lastAmbientAt = now;

    try {
      await sendEvent('bot:move', { zone: 'coffee-lounge' }, `amb-move-${botId}-${now}`);
      await sendEvent('bot:speech', { text: sanitizeSpeechText(text) }, `amb-${botId}-${now}`);
    } catch (err) {
      if (err instanceof HttpBridgeError && err.status === 401) throw err;
      log(`Gagal kirim obrolan ambient: ${err?.message || err}`, true);
    }
  };

  const syncMailboxSnapshot = async () => {
    if (!paths) return;
    let snapshot = await requestJson(`/api/state?since=${stateCursor}`);
    if (typeof snapshot.cursor === 'number' && snapshot.cursor < stateCursor) {
      log(`Server restart terdeteksi (cursor ${stateCursor} -> ${snapshot.cursor}) — baca ulang state penuh.`);
      stateCursor = 0;
      eventsCursor = 0;
      snapshot = await requestJson('/api/state');
    }
    await processSnapshot(snapshot);
    await collectResults(snapshot);
    await flushLocalQueues();
    await progressPing(snapshot);
    await maybeAmbientChat(snapshot);
    saveState();
  };

  const hello = async (greet = shouldGreetOnBoot) => {
    const bootId = Date.now();
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
      `mailbox-hello-${botId}-${bootId}`
    );
    registered = true;

    if (greet) {
      await sendEvent(
        'bot:speech',
        { text: sanitizeSpeechText(`${peer.name} terhubung lewat REST Bridge dan siap menerima tugas.`) },
        `greet-${botId}-${bootId}`
      );
    }

    if (paths) {
      const initialState = await requestJson('/api/state');
      for (const msg of initialState.comms || []) {
        seenComms.add(msg.id);
      }
      if (typeof initialState.cursor === 'number') {
        stateCursor = initialState.cursor;
        eventsCursor = initialState.cursor;
      }
      await processSnapshot(initialState);
      if (hadSavedState) {
        await collectResults(initialState, { announce: false });
      } else {
        for (const task of initialState.tasks || []) {
          if (task.status === 'completed' && task.result) seenResults.add(task.id);
        }
      }
      await flushLocalQueues();
      saveState();
      log(`Kotak surat aktif di ${cleanUrl} (dir=${paths.root}, cursor=${stateCursor}, brainMode=muse-langsung).`);
    } else {
      log(`Kotak surat aktif di ${cleanUrl} (brainMode=muse-langsung).`);
    }
  };

  const pollMailboxOnce = async (overrideWaitMs) => {
    if (!registered) {
      await hello(false);
    }
    const reqWaitMs =
      overrideWaitMs !== undefined && Number.isFinite(Number(overrideWaitMs))
        ? Math.min(20_000, Math.max(0, Math.floor(Number(overrideWaitMs))))
        : defaultWaitMs;
    const query = `since=${eventsCursor}${reqWaitMs > 0 ? `&waitMs=${reqWaitMs}` : ''}`;
    const timeoutMs = Math.max(REQUEST_TIMEOUT_BASE_MS, reqWaitMs + 10_000);

    let inbox;
    try {
      inbox = await requestJson(
        `/api/bridge/bots/${encodeURIComponent(botId)}/events?${query}`,
        {},
        timeoutMs
      );
    } catch (err) {
      if (err instanceof HttpBridgeError && err.status === 404 && !stopped) {
        registered = false;
        await hello(false);
        inbox = await requestJson(
          `/api/bridge/bots/${encodeURIComponent(botId)}/events?${query}`,
          {},
          timeoutMs
        );
      } else {
        throw err;
      }
    }

    if (typeof inbox.cursor === 'number') {
      if (inbox.cursor < eventsCursor) {
        log(`Server restart terdeteksi pada stream events (${eventsCursor} -> ${inbox.cursor}).`);
        eventsCursor = inbox.cursor;
        if (paths) stateCursor = 0;
      } else if (inbox.cursor > eventsCursor) {
        eventsCursor = inbox.cursor;
      }
    }

    let hasFreshWork = (inbox.events || []).length > 0;
    for (const evt of inbox.events || []) {
      if (!paths) {
        log(`Kotak surat event "${evt.event}": ${JSON.stringify(evt.payload)}`);
      }
    }
    for (const task of inbox.pendingTasks || []) {
      if (!seenTasks.has(task.id)) {
        hasFreshWork = true;
      }
      if (!paths) {
        log(`Tugas menunggu di kotak surat [${task.id}]: ${task.title}`);
      }
    }

    if (paths && !stopped) {
      await syncMailboxSnapshot();
    }

    if (!stopped) {
      try {
        await sendEvent('bot:heartbeat', {});
      } catch (err) {
        if (err instanceof HttpBridgeError && err.status === 404) {
          registered = false;
        } else {
          throw err;
        }
      }
    }

    lastPollHadFreshWork = hasFreshWork;
    return inbox;
  };

  const startLocalWatchers = () => {
    if (!paths) return;
    const scheduleFlush = () => {
      if (stopped || outboxDebounce) return;
      outboxDebounce = setTimeout(() => {
        outboxDebounce = null;
        if (registered && !stopped) {
          void flushLocalQueues().catch((err) => {
            if (!isUnregisteredError(err) && !(err instanceof HttpBridgeError && err.status === 401)) {
              log(`Flush outbox watcher gagal: ${err?.message || err}`, true);
            }
          });
        }
      }, 80);
    };

    for (const dir of [paths.outbox, paths.delegateDir]) {
      try {
        const w = fs.watch(dir, (_evt, filename) => {
          if (filename && String(filename).endsWith('.json')) {
            scheduleFlush();
          }
        });
        watchers.push(w);
      } catch {
        // fallback interval below handles platforms without fs.watch support
      }
    }

    outboxTimer = setInterval(() => {
      if (registered && !stopped) {
        void flushLocalQueues().catch((err) => {
          if (!isUnregisteredError(err) && !(err instanceof HttpBridgeError && err.status === 401)) {
            log(`Flush outbox periodik gagal: ${err?.message || err}`, true);
          }
        });
      }
    }, Math.min(2000, idlePollMs));
  };

  const stopLocalWatchers = () => {
    if (outboxDebounce) {
      clearTimeout(outboxDebounce);
      outboxDebounce = null;
    }
    if (outboxTimer) {
      clearInterval(outboxTimer);
      outboxTimer = null;
    }
    for (const w of watchers) {
      try {
        w.close();
      } catch {
        // ignore
      }
    }
    watchers = [];
  };

  return {
    sendEvent,
    hello,
    pollMailboxOnce,
    async startLoop() {
      running = true;
      stopped = false;
      let authAttempt = 0;

      if (paths) {
        startLocalWatchers();
      }

      try {
        while (running && !stopped) {
          let nextSleepMs = idlePollMs;
          const startedAt = Date.now();
          try {
            if (!registered) {
              await hello(shouldGreetOnBoot);
              authAttempt = 0;
            }
            await pollMailboxOnce();
            authAttempt = 0;
            const elapsedMs = Date.now() - startedAt;
            if (lastPollHadFreshWork || (defaultWaitMs > 0 && elapsedMs >= Math.min(1000, defaultWaitMs))) {
              nextSleepMs = 40;
            }
          } catch (err) {
            if (stopped || !running || err?.name === 'AbortError') {
              break;
            }
            if (err instanceof HttpBridgeError && err.status === 401) {
              nextSleepMs = computeAuthBackoffMs(authAttempt);
              authAttempt += 1;
              log(`HTTP 401: ${AUTH_RETRY_MESSAGE} (retry ${nextSleepMs}ms)`, true);
            } else if (isUnregisteredError(err)) {
              registered = false;
              log('Server lupa registrasi bot — mendaftar ulang...');
              nextSleepMs = 250;
            } else {
              log(`Gagal cek kotak surat: ${err?.message || err}`, true);
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
      } finally {
        stopLocalWatchers();
      }
    },
    stop() {
      stopped = true;
      running = false;
      stopLocalWatchers();
      for (const controller of activeControllers) {
        try {
          controller.abort();
        } catch {
          // ignore
        }
      }
      activeControllers.clear();
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
  const explicitMailboxDir =
    args.dir || args.mailbox || process.env.MUSE_MAILBOX_DIR || '';
  const localEnvFile = path.join(__dirname, '.env');
  const mailboxEnvFile = explicitMailboxDir
    ? path.join(path.resolve(explicitMailboxDir), '.env')
    : '';
  const extraFiles = [args.env, mailboxEnvFile, localEnvFile].filter(
    (f, idx, arr) => Boolean(f) && arr.indexOf(f) === idx
  );

  const env = createEnvReader(extraFiles);
  const baseUrl = (args.url || env.get('MUSE_BASE_URL', 'https://musehq.onrender.com')).replace(/\/+$/, '');
  const peer = resolvePeerPreset(args.bot || env.get('BOT_ID', 'muse-bagas'), env);
  const token = resolveBridgeToken(baseUrl, extraFiles, peer.id);
  const mailboxDir = path.resolve(
    explicitMailboxDir ||
      env.get('MUSE_MAILBOX_DIR') ||
      path.join(__dirname, '.mailbox', peer.id)
  );
  const pollMs = Math.max(500, Number(env.get('POLL_MS', '3000')) || 3000);
  const waitMs = Math.max(0, Number(env.get('WAIT_MS', '18000')) || 18000);
  const ambientChat = env.get('AMBIENT_CHAT', '1') !== '0';

  const client = createMailboxClient({
    baseUrl,
    botId: peer.id,
    token,
    peer,
    pollMs,
    waitMs,
    mailboxDir,
    ambientChat,
    announceOnBoot: true,
  });

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
