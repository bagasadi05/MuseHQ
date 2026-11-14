import { IncomingMessage } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { normalizeZoneId, pickSpotInZone } from '../officeMap.js';
import { extractBearerOrHeaderToken, isRetiredToken, timingSafeEqualStr } from '../security.js';
import { WorkspaceStore } from '../store.js';
import { Agent, AgentStatus, CommsMessage, Task, ZoneId } from '../types.js';

export class BridgeValidationError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 400
  ) {
    super(message);
    this.name = 'BridgeValidationError';
  }
}

export interface BridgeHandlers {
  onExternalTaskCompleted: (
    taskId: string,
    result: string,
    speech?: string,
    agentId?: string
  ) => Promise<{ applied: boolean; duplicate?: boolean; reason?: string }>;
  onExternalTaskFailed: (
    taskId: string,
    error: string,
    agentId?: string
  ) => Promise<{ applied: boolean; duplicate?: boolean; reason?: string }>;
  onExternalDelegation: (params: {
    fromAgentId: string;
    toAgentId: string;
    title: string;
    instructions: string;
    missionId?: string;
    parentTaskId?: string | null;
  }) => Promise<Task | null>;
}

const VALID_BOT_ID_RE = /^[a-z0-9][a-z0-9_-]{1,63}$/i;
const WS_PING_INTERVAL_MS = 25_000;

const ALLOWED_BRIDGE_EVENTS = new Set([
  'bot:hello',
  'bot:register',
  'bot:status',
  'bot:move',
  'bot:speech',
  'bot:message',
  'bot:heartbeat',
  'bot:delegate',
  'task:accept',
  'task:delegate',
  'task:complete',
  'task:fail',
]);

const VALID_STATUSES: AgentStatus[] = [
  'online',
  'idle',
  'walking',
  'thinking',
  'working',
  'talking',
  'meeting',
  'offline',
  'error',
];

export function normalizeAgentStatus(raw: unknown): AgentStatus | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === 'in-progress') return 'working';
  if ((VALID_STATUSES as string[]).includes(trimmed)) {
    return trimmed as AgentStatus;
  }
  return null;
}

export function validateWebhookUrl(raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'string') {
    throw new BridgeValidationError('Field "webhookUrl" harus berupa string URL yang valid');
  }
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new BridgeValidationError('webhookUrl harus menggunakan protokol http:// atau https://');
    }
    return parsed.toString();
  } catch (err) {
    if (err instanceof BridgeValidationError) throw err;
    throw new BridgeValidationError('Format webhookUrl tidak valid');
  }
}

export class ExternalBridge {
  private uiClients = new Set<WebSocket>();
  private botSockets = new Map<string, WebSocket>();
  private handlers: BridgeHandlers | null = null;

  constructor(private store: WorkspaceStore) {}

  setHandlers(handlers: BridgeHandlers): void {
    this.handlers = handlers;
  }

  broadcastToUi(event: string, payload: unknown): void {
    const frame = JSON.stringify({ event, payload });
    for (const client of this.uiClients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(frame);
      }
    }

    if (event === 'comms:message' && payload && typeof payload === 'object') {
      this.routeCommsToExternalBots(payload as CommsMessage);
    }
  }

  private routeCommsToExternalBots(msg: CommsMessage): void {
    const contentLower = (msg.content || '').toLowerCase();
    for (const bot of this.store.getAgents()) {
      if (bot.type === 'builtin' || bot.id === msg.fromId) continue;
      if (msg.kind === 'system') continue;

      const isDirect = msg.toId === bot.id;
      const isBroadcast = msg.toId === 'all' && msg.kind === 'chat';
      const isMentioned =
        contentLower.includes(`@${bot.id.toLowerCase()}`) ||
        contentLower.includes(`@${bot.name.toLowerCase()}`);

      if (!isDirect && !isBroadcast && !isMentioned) continue;

      const outboxEntry = this.store.pushBotOutboxEvent(
        bot.id,
        'comms:message',
        msg as unknown as Record<string, unknown>
      );

      if (bot.type === 'external-ws') {
        const sock = this.botSockets.get(bot.id);
        if (sock && sock.readyState === WebSocket.OPEN) {
          sock.send(
            JSON.stringify({
              event: 'comms:message',
              payload: { ...msg, seq: outboxEntry.seq },
            })
          );
        }
      }
    }
  }

  attachWebSocketServers(uiWss: WebSocketServer, botWss: WebSocketServer): void {
    uiWss.on('connection', (ws) => {
      this.uiClients.add(ws);
      ws.send(JSON.stringify({ event: 'snapshot', payload: this.store.getSnapshot() }));

      ws.on('error', () => {
        this.uiClients.delete(ws);
      });

      ws.on('close', () => {
        this.uiClients.delete(ws);
      });
    });

    botWss.on('connection', (ws, req) => {
      this.handleBotConnection(ws, req);
    });
  }

  private handleBotConnection(ws: WebSocket, req: IncomingMessage): void {
    let url: URL;
    try {
      url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    } catch {
      ws.close(1008, 'Invalid request URL');
      return;
    }

    const token = (url.searchParams.get('token') || extractBearerOrHeaderToken(req)).trim();
    const expectedToken = this.store.getSettings().bridgeToken;

    if (!token || isRetiredToken(token) || !timingSafeEqualStr(token, expectedToken)) {
      ws.send(JSON.stringify({ event: 'error', payload: { message: 'Unauthorized bridge token' } }));
      ws.close(4001, 'Unauthorized');
      return;
    }

    let boundAgentId: string | null = url.searchParams.get('agentId');
    if (boundAgentId) {
      if (!VALID_BOT_ID_RE.test(boundAgentId)) {
        ws.send(JSON.stringify({ event: 'error', payload: { message: 'Invalid agentId' } }));
        ws.close(4003, 'Invalid agentId');
        return;
      }
      if (this.store.getAgent(boundAgentId)) {
        this.bindSocketToAgent(boundAgentId, ws);
      }
    }

    const pingTimer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      try {
        ws.ping();
        ws.send(JSON.stringify({ event: 'ping', payload: { timestamp: new Date().toISOString() } }));
      } catch {
        // Ignore send errors on closing sockets
      }
    }, WS_PING_INTERVAL_MS);
    pingTimer.unref?.();

    const clearPingTimer = () => {
      clearInterval(pingTimer);
    };

    ws.on('error', () => {
      clearPingTimer();
    });

    ws.on('message', async (raw) => {
      try {
        const parsed = JSON.parse(raw.toString()) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new BridgeValidationError('Pesan bridge harus berupa objek JSON');
        }
        const msg = parsed as {
          event?: unknown;
          payload?: unknown;
          eventId?: unknown;
        };
        if (typeof msg.event !== 'string' || !msg.event.trim()) {
          throw new BridgeValidationError('Field "event" wajib berupa string');
        }
        const event = msg.event.trim();

        if (event === 'ping') {
          ws.send(JSON.stringify({ event: 'pong', payload: { timestamp: new Date().toISOString() } }));
          return;
        }
        if (event === 'pong') {
          if (boundAgentId) {
            const existing = this.store.getAgent(boundAgentId);
            if (existing) {
              this.store.updateAgent(boundAgentId, {
                bridgeConnected: true,
                status: existing.status === 'offline' ? 'online' : existing.status,
              });
            }
          }
          return;
        }

        if (!ALLOWED_BRIDGE_EVENTS.has(event)) {
          throw new BridgeValidationError(`Event bridge tidak dikenal: ${event}`);
        }
        if (
          msg.payload !== undefined &&
          (msg.payload === null || typeof msg.payload !== 'object' || Array.isArray(msg.payload))
        ) {
          throw new BridgeValidationError('Field "payload" harus berupa objek JSON');
        }
        if (msg.eventId !== undefined && typeof msg.eventId !== 'string') {
          throw new BridgeValidationError('Field "eventId" harus berupa string');
        }

        const payload =
          msg.payload && typeof msg.payload === 'object' && !Array.isArray(msg.payload)
            ? { ...(msg.payload as Record<string, unknown>) }
            : {};
        const clientEventId =
          typeof msg.eventId === 'string' && msg.eventId.trim()
            ? msg.eventId.trim()
            : typeof payload.eventId === 'string' && payload.eventId.trim()
              ? payload.eventId.trim()
              : '';
        if (clientEventId) {
          payload.eventId = clientEventId;
        }

        if (event === 'bot:hello' || event === 'bot:register') {
          const requestedId =
            typeof payload.id === 'string' && payload.id.trim()
              ? payload.id.trim()
              : boundAgentId || undefined;
          if (requestedId && clientEventId && this.store.hasBridgeEventId(requestedId, clientEventId)) {
            const existing = this.store.getAgent(requestedId);
            if (existing) {
              boundAgentId = existing.id;
              this.bindSocketToAgent(existing.id, ws);
              ws.send(
                JSON.stringify({ event: 'bot:registered', payload: { agent: existing, duplicate: true } })
              );
              return;
            }
          }
          const agent = this.registerOrUpdateExternalBot({
            id: requestedId,
            name: typeof payload.name === 'string' ? payload.name : 'External Muse Bot',
            role: typeof payload.role === 'string' ? payload.role : 'External Specialist',
            description:
              typeof payload.description === 'string'
                ? payload.description
                : 'Connected via WebSocket Bridge',
            homeZone: payload.homeZone,
            color: typeof payload.color === 'string' ? payload.color : undefined,
            canDelegate: Boolean(payload.canDelegate),
            type: 'external-ws',
          });
          if (clientEventId) {
            this.store.recordBridgeEventId(agent.id, clientEventId);
          }
          boundAgentId = agent.id;
          this.bindSocketToAgent(agent.id, ws);
          ws.send(JSON.stringify({ event: 'bot:registered', payload: { agent } }));
          return;
        }

        if (!boundAgentId) {
          throw new BridgeValidationError(
            'Kirim bot:hello terlebih dahulu sebelum mengirim event lain'
          );
        }

        await this.processBotEvent(boundAgentId, event, payload);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Invalid bridge message';
        ws.send(JSON.stringify({ event: 'error', payload: { message } }));
      }
    });

    ws.on('close', () => {
      clearPingTimer();
      if (!boundAgentId) return;
      const existing = this.botSockets.get(boundAgentId);
      if (existing === ws) {
        this.botSockets.delete(boundAgentId);
        const agent = this.store.getAgent(boundAgentId);
        if (agent && agent.type === 'external-ws') {
          this.store.updateAgent(boundAgentId, {
            bridgeConnected: false,
            status: 'offline',
            speechBubble: {
              text: 'Koneksi terputus',
              kind: 'error',
              expiresAt: Date.now() + 4000,
            },
          });
          this.store.addComms({
            fromId: agent.id,
            fromName: agent.name,
            toId: 'all',
            toName: 'All',
            kind: 'system',
            content: `${agent.name} terputus dari External Bridge.`,
          });
        }
      }
    });
  }

  private bindSocketToAgent(agentId: string, ws: WebSocket): void {
    const prev = this.botSockets.get(agentId);
    const alreadySameSocket = prev === ws;
    if (prev && prev !== ws && prev.readyState === WebSocket.OPEN) {
      prev.close(4002, 'Replaced by new connection');
    }
    this.botSockets.set(agentId, ws);

    const agent = this.store.getAgent(agentId);
    if (agent) {
      this.store.updateAgent(agentId, {
        type: 'external-ws',
        bridgeConnected: true,
        status: agent.status === 'offline' ? 'online' : agent.status === 'idle' ? 'online' : agent.status,
      });
      if (!alreadySameSocket) {
        this.store.setSpeechBubble(agentId, 'Terhubung ke ruangan!', 'chat', 4000);
        this.store.addComms({
          fromId: agent.id,
          fromName: agent.name,
          toId: 'all',
          toName: 'All Muse Bots',
          kind: 'system',
          content: `${agent.name} masuk ke ruangan kerja via WebSocket Bridge.`,
        });
      }
    }
  }

  registerOrUpdateExternalBot(input: {
    id?: string;
    name: string;
    role: string;
    description?: string;
    homeZone?: unknown;
    color?: string;
    canDelegate?: boolean;
    type: 'external-ws' | 'external-rest' | 'external-webhook';
    webhookUrl?: string;
  }): Agent {
    const cleanName = (input.name || '').trim();
    if (!cleanName) {
      throw new BridgeValidationError('Field "name" bot wajib diisi');
    }

    const slug = input.id
      ? input.id.trim()
      : `ext-${
          cleanName
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '') || Date.now()
        }`;

    if (!VALID_BOT_ID_RE.test(slug)) {
      throw new BridgeValidationError(
        'ID bot harus 2-64 karakter alfanumerik, tanda hubung (-), atau garis bawah (_)'
      );
    }

    const existing = this.store.getAgent(slug);
    if (existing && existing.type === 'builtin') {
      throw new BridgeValidationError(
        `ID "${slug}" adalah bot built-in dan tidak dapat ditimpa melalui External Bridge`,
        409
      );
    }

    const validatedWebhook = validateWebhookUrl(input.webhookUrl);
    let zone: ZoneId = existing?.homeZone || 'qa-bench';
    if (input.homeZone !== undefined && input.homeZone !== null && input.homeZone !== '') {
      const normalized = normalizeZoneId(input.homeZone);
      if (!normalized) {
        throw new BridgeValidationError(`Zona tidak valid: ${String(input.homeZone)}`);
      }
      zone = normalized;
    }

    if (existing) {
      const movedZone = zone !== existing.currentZone;
      const occupied = this.store.getOccupiedInZone(zone, slug);
      const nextSpot = movedZone ? pickSpotInZone(zone, this.store.getAgents().length, occupied) : existing.position;
      const updated = this.store.updateAgent(slug, {
        name: cleanName || existing.name,
        role: (input.role || '').trim() || existing.role,
        description: input.description?.trim() || existing.description,
        homeZone: zone,
        ...(movedZone
          ? {
              currentZone: zone,
              targetZone: zone,
              position: nextSpot,
              targetPosition: { ...nextSpot },
            }
          : {}),
        color: input.color?.trim() || existing.color,
        canDelegate: input.canDelegate ?? existing.canDelegate,
        type: input.type,
        webhookUrl: validatedWebhook ?? existing.webhookUrl,
        bridgeConnected: true,
        status: existing.status === 'offline' ? 'online' : existing.status,
      });
      return updated!;
    }

    const occupied = this.store.getOccupiedInZone(zone);
    const pos = pickSpotInZone(zone, this.store.getAgents().length, occupied);
    const created: Agent = {
      id: slug,
      name: cleanName,
      role: (input.role || '').trim() || 'External Specialist',
      description: input.description?.trim() || 'External bot connected via MuseBridge',
      systemPrompt: `External bot (${(input.role || '').trim() || 'Specialist'})`,
      type: input.type,
      provider: 'demo',
      model: 'external',
      webhookUrl: validatedWebhook,
      bridgeConnected: true,
      canDelegate: Boolean(input.canDelegate),
      homeZone: zone,
      currentZone: zone,
      targetZone: zone,
      position: pos,
      targetPosition: { ...pos },
      color: input.color?.trim() || '#a855f7',
      avatarVariant: 'external',
      status: 'online',
      currentTaskId: null,
      speechBubble: {
        text: 'Halo tim! Siap menerima tugas.',
        kind: 'chat',
        expiresAt: Date.now() + 4500,
      },
      lastSeenAt: new Date().toISOString(),
    };
    this.store.upsertAgent(created);
    return created;
  }

  async processBotEvent(
    agentId: string,
    event: string,
    payload: Record<string, unknown> = {}
  ): Promise<{ ok: true; duplicate?: boolean; agent?: Agent }> {
    if (!ALLOWED_BRIDGE_EVENTS.has(event)) {
      throw new BridgeValidationError(`Event bridge tidak dikenal: ${event}`);
    }

    const clientEventId =
      typeof payload.eventId === 'string'
        ? payload.eventId.trim()
        : typeof payload.clientEventId === 'string'
          ? payload.clientEventId.trim()
          : '';
    if (clientEventId && this.store.hasBridgeEventId(agentId, clientEventId)) {
      return { ok: true, duplicate: true };
    }

    if (event === 'bot:hello' || event === 'bot:register') {
      if (typeof payload.id === 'string' && payload.id.trim() && payload.id.trim() !== agentId) {
        throw new BridgeValidationError('payload.id tidak cocok dengan parameter bot :id');
      }
      const webhookUrl =
        typeof payload.webhookUrl === 'string' && payload.webhookUrl.trim()
          ? payload.webhookUrl.trim()
          : undefined;
      const botType =
        this.botSockets.has(agentId)
          ? 'external-ws'
          : webhookUrl
            ? 'external-webhook'
            : 'external-rest';

      const existing = Boolean(this.store.getAgent(agentId));
      const registered = this.registerOrUpdateExternalBot({
        id: agentId,
        name: typeof payload.name === 'string' ? payload.name : agentId,
        role: typeof payload.role === 'string' ? payload.role : 'External Specialist',
        description:
          typeof payload.description === 'string' ? payload.description : undefined,
        homeZone: payload.homeZone,
        color: typeof payload.color === 'string' ? payload.color : undefined,
        canDelegate: payload.canDelegate !== undefined ? Boolean(payload.canDelegate) : undefined,
        type: botType,
        webhookUrl,
      });

      if (clientEventId) {
        this.store.recordBridgeEventId(agentId, clientEventId);
      }

      if (!existing) {
        this.store.addComms({
          fromId: registered.id,
          fromName: registered.name,
          toId: 'all',
          toName: 'All Muse Bots',
          kind: 'system',
          content: `${registered.name} (${registered.role}) bergabung ke zona ${registered.homeZone}.`,
        });
      }
      return { ok: true, agent: registered };
    }

    const agent = this.store.getAgent(agentId);
    if (!agent) {
      throw new BridgeValidationError(
        `Bot "${agentId}" belum terdaftar. Kirim event bot:hello terlebih dahulu.`,
        404
      );
    }

    if (event === 'bot:heartbeat') {
      if (clientEventId) this.store.recordBridgeEventId(agentId, clientEventId);
      this.store.updateAgent(agentId, {
        bridgeConnected: true,
        status: agent.status === 'offline' ? 'online' : agent.status,
      });
      return { ok: true };
    }

    if (event === 'bot:status') {
      let nextStatus: AgentStatus | undefined;
      if (payload.status !== undefined) {
        const parsedStatus = normalizeAgentStatus(payload.status);
        if (!parsedStatus) {
          throw new BridgeValidationError(`Status bot tidak valid: ${String(payload.status)}`);
        }
        nextStatus = parsedStatus;
      }

      let nextZone: ZoneId | undefined;
      if (payload.zone !== undefined && payload.zone !== null && payload.zone !== '') {
        const parsedZone = normalizeZoneId(payload.zone);
        if (!parsedZone) {
          throw new BridgeValidationError(`Zona tidak valid: ${String(payload.zone)}`);
        }
        nextZone = parsedZone;
      }

      if (payload.speech !== undefined && typeof payload.speech !== 'string') {
        throw new BridgeValidationError('Field "speech" harus berupa string');
      }

      if (clientEventId) this.store.recordBridgeEventId(agentId, clientEventId);

      const bridgeConnected = nextStatus === 'offline' ? false : true;
      if (nextZone) {
        this.store.updateAgent(agentId, { bridgeConnected });
        this.store.moveAgentToZone(agentId, nextZone, 0, nextStatus);
      } else if (nextStatus) {
        this.store.updateAgent(agentId, { status: nextStatus, bridgeConnected });
      } else {
        this.store.updateAgent(agentId, { bridgeConnected });
      }

      const activeTaskId =
        typeof payload.taskId === 'string' && payload.taskId.trim()
          ? payload.taskId.trim()
          : agent.currentTaskId;
      if (nextStatus === 'working' && activeTaskId) {
        const currentTask = this.store.getTask(activeTaskId);
        if (currentTask && currentTask.assignedToId === agentId && currentTask.status === 'assigned') {
          this.store.updateTask(currentTask.id, { status: 'working' });
        }
      }

      if (typeof payload.speech === 'string' && payload.speech.trim()) {
        this.store.setSpeechBubble(agentId, payload.speech.trim(), 'chat');
      }
      return { ok: true };
    }

    if (event === 'bot:move') {
      const parsedZone = normalizeZoneId(payload.zone);
      if (!parsedZone) {
        throw new BridgeValidationError('Field "zone" wajib diisi dengan ID zona yang valid');
      }
      if (clientEventId) this.store.recordBridgeEventId(agentId, clientEventId);
      this.store.moveAgentToZone(agentId, parsedZone, 0);
      return { ok: true };
    }

    if (event === 'bot:speech') {
      const text = typeof payload.text === 'string' ? payload.text.trim() : '';
      if (!text) {
        throw new BridgeValidationError('Field "text" wajib diisi untuk event bot:speech');
      }
      const rawToId =
        typeof payload.toId === 'string'
          ? payload.toId.trim()
          : typeof payload.toAgentId === 'string'
            ? payload.toAgentId.trim()
            : 'all';
      const recipient =
        rawToId !== 'all' && rawToId !== 'user' ? this.store.getAgent(rawToId) : undefined;
      const resolvedToId = rawToId === 'user' ? 'user' : recipient?.id || 'all';
      const resolvedToName =
        rawToId === 'user' ? 'Commander (Owner)' : recipient?.name || 'All Muse Bots';

      if (clientEventId) this.store.recordBridgeEventId(agentId, clientEventId);
      this.store.setSpeechBubble(agentId, text, 'chat');
      this.store.addComms({
        fromId: agent.id,
        fromName: agent.name,
        toId: resolvedToId,
        toName: resolvedToName,
        kind: 'chat',
        content: text,
      });
      return { ok: true };
    }

    if (event === 'bot:message') {
      const toAgentId = typeof payload.toAgentId === 'string' ? payload.toAgentId.trim() : 'all';
      const content = typeof payload.content === 'string' ? payload.content.trim() : '';
      if (!content) {
        throw new BridgeValidationError('Field "content" wajib diisi untuk event bot:message');
      }
      const recipient = toAgentId !== 'all' ? this.store.getAgent(toAgentId) : undefined;
      if (toAgentId !== 'all' && !recipient) {
        throw new BridgeValidationError(`Bot penerima "${toAgentId}" tidak ditemukan`, 404);
      }
      if (clientEventId) this.store.recordBridgeEventId(agentId, clientEventId);
      this.store.setSpeechBubble(agentId, content, 'chat');
      if (recipient) {
        this.store.emitBeam(agentId, recipient.id, content, agent.color);
      }
      this.store.addComms({
        fromId: agent.id,
        fromName: agent.name,
        toId: recipient?.id || 'all',
        toName: recipient?.name || 'All Muse Bots',
        kind: 'chat',
        content,
      });
      return { ok: true };
    }

    if (event === 'task:accept') {
      const taskId = typeof payload.taskId === 'string' && payload.taskId.trim()
        ? payload.taskId.trim()
        : agent.currentTaskId || '';
      if (!taskId) {
        throw new BridgeValidationError('Field "taskId" wajib diisi untuk event task:accept');
      }
      const task = this.store.getTask(taskId);
      if (!task || task.assignedToId !== agentId) {
        throw new BridgeValidationError('Tugas tidak ditemukan atau bukan milik bot ini', 404);
      }
      if (clientEventId) this.store.recordBridgeEventId(agentId, clientEventId);
      if (task.status === 'completed' || task.status === 'failed') {
        return { ok: true, duplicate: true };
      }
      this.store.updateTask(taskId, { status: 'working' });
      this.store.updateAgent(agentId, { status: 'working', bridgeConnected: true });
      return { ok: true };
    }

    if ((event === 'bot:delegate' || event === 'task:delegate') && this.handlers) {
      const toAgentId =
        typeof payload.toAgentId === 'string' && payload.toAgentId.trim()
          ? payload.toAgentId.trim()
          : typeof payload.toId === 'string'
            ? payload.toId.trim()
            : '';
      const instructions = typeof payload.instructions === 'string' ? payload.instructions.trim() : '';
      if (!toAgentId || !instructions) {
        throw new BridgeValidationError('Field "toAgentId" dan "instructions" wajib diisi');
      }
      if (!this.store.getAgent(toAgentId)) {
        throw new BridgeValidationError(`Bot target "${toAgentId}" tidak ditemukan`, 404);
      }
      if (clientEventId) this.store.recordBridgeEventId(agentId, clientEventId);
      const created = await this.handlers.onExternalDelegation({
        fromAgentId: agentId,
        toAgentId,
        title:
          typeof payload.title === 'string' && payload.title.trim()
            ? payload.title.trim()
            : 'Tugas Delegasi Eksternal',
        instructions,
        missionId: typeof payload.missionId === 'string' ? payload.missionId : undefined,
        parentTaskId:
          typeof payload.parentTaskId === 'string' ? payload.parentTaskId : agent.currentTaskId,
      });
      if (!created) {
        throw new BridgeValidationError(`Bot target "${toAgentId}" tidak ditemukan`, 404);
      }
      return { ok: true };
    }

    if (event === 'task:complete' && this.handlers) {
      const taskId =
        typeof payload.taskId === 'string' && payload.taskId.trim()
          ? payload.taskId.trim()
          : agent.currentTaskId || '';
      if (!taskId) {
        throw new BridgeValidationError('Field "taskId" wajib diisi untuk task:complete');
      }
      if (payload.result !== undefined && typeof payload.result !== 'string') {
        throw new BridgeValidationError('Field "result" harus berupa string');
      }
      if (payload.speech !== undefined && typeof payload.speech !== 'string') {
        throw new BridgeValidationError('Field "speech" harus berupa string');
      }
      const existingTask = this.store.getTask(taskId);
      if (!existingTask || existingTask.assignedToId !== agentId) {
        throw new BridgeValidationError('Tugas tidak ditemukan atau bukan milik bot ini', 404);
      }
      if (clientEventId) this.store.recordBridgeEventId(agentId, clientEventId);
      const result =
        typeof payload.result === 'string' && payload.result.trim()
          ? payload.result
          : 'Selesai tanpa catatan tambahan.';
      const speech = typeof payload.speech === 'string' ? payload.speech : undefined;
      const outcome = await this.handlers.onExternalTaskCompleted(taskId, result, speech, agentId);
      if (!outcome.applied) {
        throw new BridgeValidationError(outcome.reason || 'Gagal menyelesaikan tugas', 404);
      }
      return { ok: true, duplicate: outcome.duplicate };
    }

    if (event === 'task:fail' && this.handlers) {
      const taskId =
        typeof payload.taskId === 'string' && payload.taskId.trim()
          ? payload.taskId.trim()
          : agent.currentTaskId || '';
      if (!taskId) {
        throw new BridgeValidationError('Field "taskId" wajib diisi untuk task:fail');
      }
      if (payload.error !== undefined && typeof payload.error !== 'string') {
        throw new BridgeValidationError('Field "error" harus berupa string');
      }
      const existingTask = this.store.getTask(taskId);
      if (!existingTask || existingTask.assignedToId !== agentId) {
        throw new BridgeValidationError('Tugas tidak ditemukan atau bukan milik bot ini', 404);
      }
      if (clientEventId) this.store.recordBridgeEventId(agentId, clientEventId);
      const error =
        typeof payload.error === 'string' && payload.error.trim()
          ? payload.error
          : 'External bot reported failure';
      const outcome = await this.handlers.onExternalTaskFailed(taskId, error, agentId);
      if (!outcome.applied) {
        throw new BridgeValidationError(outcome.reason || 'Gagal menandai tugas gagal', 404);
      }
      return { ok: true, duplicate: outcome.duplicate };
    }

    throw new BridgeValidationError(`Event bridge tidak dapat diproses: ${event}`);
  }

  async dispatchTaskToExternalBot(agent: Agent, task: Task, contextPrompt: string): Promise<boolean> {
    const outboxItem = this.store.pushBotOutboxEvent(agent.id, 'task:assigned', {
      taskId: task.id,
      missionId: task.missionId,
      title: task.title,
      instructions: task.instructions,
      context: contextPrompt,
      assignedById: task.assignedById,
    });

    const packet = {
      event: 'task:assigned',
      payload: {
        ...outboxItem.payload,
        seq: outboxItem.seq,
      },
    };

    if (agent.type === 'external-ws') {
      const sock = this.botSockets.get(agent.id);
      if (sock && sock.readyState === WebSocket.OPEN) {
        sock.send(JSON.stringify(packet));
        return true;
      }
      return false;
    }

    if (agent.type === 'external-rest') {
      // REST polling bot picks this up from GET /api/state or GET /api/bridge/bots/:id/events
      return true;
    }

    if (agent.type === 'external-webhook' && agent.webhookUrl) {
      try {
        const res = await fetch(agent.webhookUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-muse-token': this.store.getSettings().bridgeToken,
          },
          body: JSON.stringify(packet),
        });
        return res.ok;
      } catch (err) {
        console.error(`Webhook delivery failed for ${agent.id}:`, err);
        return false;
      }
    }

    return false;
  }
}
