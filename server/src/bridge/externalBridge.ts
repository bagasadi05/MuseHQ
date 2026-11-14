import { IncomingMessage } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import { pickSpotInZone } from '../officeMap.js';
import { WorkspaceStore } from '../store.js';
import { Agent, AgentStatus, Task, ZoneId } from '../types.js';

export interface BridgeHandlers {
  onExternalTaskCompleted: (taskId: string, result: string, speech?: string) => Promise<void>;
  onExternalTaskFailed: (taskId: string, error: string) => Promise<void>;
  onExternalDelegation: (params: {
    fromAgentId: string;
    toAgentId: string;
    title: string;
    instructions: string;
    missionId?: string;
    parentTaskId?: string | null;
  }) => Promise<Task | null>;
}

const VALID_ZONES: ZoneId[] = [
  'command-desk',
  'meeting-table',
  'dev-bay',
  'research-nook',
  'creative-studio',
  'qa-bench',
  'lounge',
];

const VALID_STATUSES: AgentStatus[] = [
  'idle',
  'walking',
  'thinking',
  'working',
  'meeting',
  'offline',
  'error',
];

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
  }

  attachWebSocketServers(
    uiWss: WebSocketServer,
    botWss: WebSocketServer
  ): void {
    uiWss.on('connection', (ws) => {
      this.uiClients.add(ws);
      ws.send(JSON.stringify({ event: 'snapshot', payload: this.store.getSnapshot() }));

      ws.on('close', () => {
        this.uiClients.delete(ws);
      });
    });

    botWss.on('connection', (ws, req) => {
      this.handleBotConnection(ws, req);
    });
  }

  private handleBotConnection(ws: WebSocket, req: IncomingMessage): void {
    const url = new URL(req.url || '/', 'http://localhost');
    const token = url.searchParams.get('token') || req.headers['x-muse-token'];
    const expectedToken = this.store.getSettings().bridgeToken;

    if (expectedToken && token !== expectedToken) {
      ws.send(JSON.stringify({ event: 'error', payload: { message: 'Invalid bridge token' } }));
      ws.close(4001, 'Unauthorized');
      return;
    }

    let boundAgentId: string | null = url.searchParams.get('agentId');
    if (boundAgentId) {
      this.bindSocketToAgent(boundAgentId, ws);
    }

    ws.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as { event?: string; payload?: Record<string, unknown> };
        const event = msg.event || '';
        const payload = msg.payload || {};

        if (event === 'bot:hello' || event === 'bot:register') {
          const agent = this.registerOrUpdateExternalBot({
            id: (payload.id as string) || boundAgentId || undefined,
            name: String(payload.name || 'External Muse Bot'),
            role: String(payload.role || 'External Specialist'),
            description: String(payload.description || 'Connected via WebSocket Bridge'),
            homeZone: payload.homeZone as ZoneId | undefined,
            color: payload.color as string | undefined,
            canDelegate: Boolean(payload.canDelegate),
            type: 'external-ws',
          });
          boundAgentId = agent.id;
          this.bindSocketToAgent(agent.id, ws);
          ws.send(JSON.stringify({ event: 'bot:registered', payload: { agent } }));
          return;
        }

        if (!boundAgentId) {
          ws.send(
            JSON.stringify({
              event: 'error',
              payload: { message: 'Send bot:hello with name/role or pass ?agentId=...' },
            })
          );
          return;
        }

        await this.processBotEvent(boundAgentId, event, payload);
      } catch (err) {
        ws.send(
          JSON.stringify({
            event: 'error',
            payload: { message: err instanceof Error ? err.message : 'Invalid JSON payload' },
          })
        );
      }
    });

    ws.on('close', () => {
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
    if (prev && prev !== ws && prev.readyState === WebSocket.OPEN) {
      prev.close(4002, 'Replaced by new connection');
    }
    this.botSockets.set(agentId, ws);

    const agent = this.store.getAgent(agentId);
    if (agent) {
      this.store.updateAgent(agentId, {
        type: 'external-ws',
        bridgeConnected: true,
        status: 'idle',
      });
      this.store.setSpeechBubble(agentId, 'Terhubung ke ruangan!', 'chat', 4000);
      this.store.addComms({
        fromId: agent.id,
        fromName: agent.name,
        toId: 'all',
        toName: 'All',
        kind: 'system',
        content: `${agent.name} masuk ke ruangan kerja via WebSocket Bridge.`,
      });
    }
  }

  registerOrUpdateExternalBot(input: {
    id?: string;
    name: string;
    role: string;
    description?: string;
    homeZone?: ZoneId;
    color?: string;
    canDelegate?: boolean;
    type: 'external-ws' | 'external-webhook';
    webhookUrl?: string;
  }): Agent {
    const slug =
      input.id ||
      `ext-${input.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') || Date.now()}`;

    const existing = this.store.getAgent(slug);
    const zone: ZoneId =
      input.homeZone && VALID_ZONES.includes(input.homeZone)
        ? input.homeZone
        : existing?.homeZone || 'qa-bench';

    if (existing) {
      const updated = this.store.updateAgent(slug, {
        name: input.name || existing.name,
        role: input.role || existing.role,
        description: input.description || existing.description,
        homeZone: zone,
        color: input.color || existing.color,
        canDelegate: input.canDelegate ?? existing.canDelegate,
        type: input.type,
        webhookUrl: input.webhookUrl ?? existing.webhookUrl,
        bridgeConnected: true,
        status: existing.status === 'offline' ? 'idle' : existing.status,
      });
      return updated!;
    }

    const pos = pickSpotInZone(zone, this.store.getAgents().length);
    const created: Agent = {
      id: slug,
      name: input.name,
      role: input.role,
      description: input.description || 'External bot connected via MuseBridge',
      systemPrompt: `External bot (${input.role})`,
      type: input.type,
      provider: 'demo',
      model: 'external',
      webhookUrl: input.webhookUrl,
      bridgeConnected: true,
      canDelegate: Boolean(input.canDelegate),
      homeZone: zone,
      currentZone: zone,
      targetZone: zone,
      position: pos,
      targetPosition: { ...pos },
      color: input.color || '#a855f7',
      avatarVariant: 'external',
      status: 'idle',
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
    payload: Record<string, unknown>
  ): Promise<void> {
    const agent = this.store.getAgent(agentId);
    if (!agent) return;

    if (event === 'bot:status') {
      const status = payload.status as AgentStatus | undefined;
      const zone = payload.zone as ZoneId | undefined;
      if (zone && VALID_ZONES.includes(zone)) {
        this.store.moveAgentToZone(
          agentId,
          zone,
          0,
          status && VALID_STATUSES.includes(status) ? status : undefined
        );
      } else if (status && VALID_STATUSES.includes(status)) {
        this.store.updateAgent(agentId, { status });
      }
      if (typeof payload.speech === 'string' && payload.speech.trim()) {
        this.store.setSpeechBubble(agentId, payload.speech.trim(), 'chat');
      }
      return;
    }

    if (event === 'bot:move') {
      const zone = payload.zone as ZoneId | undefined;
      if (zone && VALID_ZONES.includes(zone)) {
        this.store.moveAgentToZone(agentId, zone, 0);
      }
      return;
    }

    if (event === 'bot:speech') {
      const text = String(payload.text || '').trim();
      if (text) {
        this.store.setSpeechBubble(agentId, text, 'chat');
      }
      return;
    }

    if (event === 'bot:message') {
      const toAgentId = String(payload.toAgentId || 'all');
      const content = String(payload.content || '').trim();
      if (!content) return;
      const recipient = this.store.getAgent(toAgentId);
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
      return;
    }

    if (event === 'task:delegate' && this.handlers) {
      await this.handlers.onExternalDelegation({
        fromAgentId: agentId,
        toAgentId: String(payload.toAgentId || ''),
        title: String(payload.title || 'Tugas Delegasi Eksternal'),
        instructions: String(payload.instructions || ''),
        missionId: payload.missionId as string | undefined,
        parentTaskId: (payload.parentTaskId as string | undefined) ?? agent.currentTaskId,
      });
      return;
    }

    if (event === 'task:complete' && this.handlers) {
      const taskId = String(payload.taskId || agent.currentTaskId || '');
      const result = String(payload.result || 'Selesai tanpa catatan tambahan.');
      const speech = typeof payload.speech === 'string' ? payload.speech : undefined;
      if (taskId) {
        await this.handlers.onExternalTaskCompleted(taskId, result, speech);
      }
      return;
    }

    if (event === 'task:fail' && this.handlers) {
      const taskId = String(payload.taskId || agent.currentTaskId || '');
      const error = String(payload.error || 'External bot reported failure');
      if (taskId) {
        await this.handlers.onExternalTaskFailed(taskId, error);
      }
    }
  }

  async dispatchTaskToExternalBot(agent: Agent, task: Task, contextPrompt: string): Promise<boolean> {
    const packet = {
      event: 'task:assigned',
      payload: {
        taskId: task.id,
        missionId: task.missionId,
        title: task.title,
        instructions: task.instructions,
        context: contextPrompt,
        assignedById: task.assignedById,
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
