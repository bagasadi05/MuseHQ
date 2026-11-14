import { NextFunction, Request, Response, Router } from 'express';
import { ExternalBridge } from '../bridge/externalBridge.js';
import { MissionOrchestrator } from '../llm/orchestrator.js';
import { pickSpotInZone } from '../officeMap.js';
import { IS_SERVERLESS, WorkspaceStore } from '../store.js';
import { Agent, AgentType, AvatarVariant, LLMProvider, RuntimeSettings, ZoneId } from '../types.js';

export function createApiRouter(
  store: WorkspaceStore,
  orchestrator: MissionOrchestrator,
  bridge: ExternalBridge
): Router {
  const router = Router();

  const requireBridgeToken = (req: Request, res: Response, next: NextFunction): void => {
    const expected = store.getSettings().bridgeToken;
    const supplied = (req.headers['x-muse-token'] as string) || (req.query.token as string) || '';
    if (expected && supplied !== expected) {
      res.status(401).json({ error: 'Invalid x-muse-token' });
      return;
    }
    next();
  };

  router.get('/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'muse-hq-server',
      serverless: IS_SERVERLESS,
      timestamp: new Date().toISOString(),
    });
  });

  router.get('/state', (_req, res) => {
    res.json(store.getSnapshot());
  });

  router.post('/missions', async (req, res) => {
    try {
      const { prompt, targetAgentId, stream, clientContext } = req.body as {
        prompt?: string;
        targetAgentId?: string;
        stream?: boolean;
        clientContext?: {
          agents?: Agent[];
          settingsPatch?: Partial<RuntimeSettings>;
        };
      };
      if (!prompt || !prompt.trim()) {
        res.status(400).json({ error: 'Prompt perintah tidak boleh kosong.' });
        return;
      }

      if (clientContext) {
        store.hydrateFromClient(clientContext);
      }

      const shouldStream = Boolean(stream || req.headers.accept?.includes('text/event-stream'));
      if (shouldStream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();

        const unsubscribe = store.subscribe((event, payload) => {
          res.write(`data: ${JSON.stringify({ event, payload })}\n\n`);
        });

        try {
          await orchestrator.startMission(prompt, targetAgentId, true);
          res.write(`data: ${JSON.stringify({ event: 'done', payload: store.getSnapshot() })}\n\n`);
        } finally {
          unsubscribe();
          res.end();
        }
        return;
      }

      const mission = await orchestrator.startMission(prompt, targetAgentId, IS_SERVERLESS);
      res.status(201).json({ mission });
    } catch (err) {
      if (!res.headersSent) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Gagal memulai misi' });
      } else {
        res.end();
      }
    }
  });

  router.post('/missions/clear', (_req, res) => {
    store.clearHistory();
    res.json({ ok: true, snapshot: store.getSnapshot() });
  });

  router.post('/agents', (req, res) => {
    const body = req.body as Partial<Agent> & { name?: string; role?: string };
    if (!body.name?.trim() || !body.role?.trim()) {
      res.status(400).json({ error: 'Nama dan role bot wajib diisi.' });
      return;
    }

    const slugBase = body.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    const id = body.id?.trim() || `muse-${slugBase || 'bot'}-${Date.now().toString(36).slice(-4)}`;
    const zone: ZoneId = body.homeZone || 'dev-bay';
    const pos = pickSpotInZone(zone, store.getAgents().length);
    const type: AgentType = body.type || 'builtin';
    const provider: LLMProvider = body.provider || store.getSettings().defaultProvider;
    const avatarVariant: AvatarVariant =
      body.avatarVariant || (type === 'builtin' ? 'coder' : 'external');

    const agent: Agent = {
      id,
      name: body.name.trim(),
      role: body.role.trim(),
      description: body.description?.trim() || `Bot spesialis ${body.role.trim()}`,
      systemPrompt:
        body.systemPrompt?.trim() ||
        `Kamu adalah ${body.name.trim()}, berperan sebagai ${body.role.trim()}. Kerjakan tugas dengan teliti dan terstruktur.`,
      type,
      provider,
      model: body.model?.trim() || '',
      webhookUrl: body.webhookUrl?.trim() || undefined,
      bridgeConnected: type !== 'external-ws',
      canDelegate: Boolean(body.canDelegate),
      homeZone: zone,
      currentZone: zone,
      targetZone: zone,
      position: pos,
      targetPosition: { ...pos },
      color: body.color || '#14b8a6',
      avatarVariant,
      status: type === 'external-ws' ? 'offline' : 'idle',
      currentTaskId: null,
      speechBubble: {
        text: 'Halo! Saya baru bergabung di ruangan ini.',
        kind: 'chat',
        expiresAt: Date.now() + 4500,
      },
      lastSeenAt: new Date().toISOString(),
    };

    store.upsertAgent(agent);
    store.addComms({
      fromId: 'system',
      fromName: 'MuseHQ System',
      toId: 'all',
      toName: 'All Muse Bots',
      kind: 'system',
      content: `${agent.name} (${agent.role}) bergabung ke ruangan kerja di zona ${zone}.`,
    });

    res.status(201).json({ agent, snapshot: store.getSnapshot() });
  });

  router.patch('/agents/:id', (req, res) => {
    const existing = store.getAgent(req.params.id);
    if (!existing) {
      res.status(404).json({ error: 'Bot tidak ditemukan' });
      return;
    }
    const patch = req.body as Partial<Agent>;
    const allowed: Partial<Agent> = {};
    const fields: Array<keyof Agent> = [
      'name',
      'role',
      'description',
      'systemPrompt',
      'type',
      'provider',
      'model',
      'webhookUrl',
      'canDelegate',
      'homeZone',
      'color',
      'avatarVariant',
      'status',
    ];
    for (const key of fields) {
      if (patch[key] !== undefined) {
        (allowed as Record<string, unknown>)[key] = patch[key];
      }
    }

    const updated = store.updateAgent(req.params.id, allowed);
    if (patch.homeZone && patch.homeZone !== existing.currentZone) {
      store.moveAgentToZone(req.params.id, patch.homeZone, 0, updated?.status);
    }
    res.json({ agent: updated, snapshot: store.getSnapshot() });
  });

  router.delete('/agents/:id', (req, res) => {
    const ok = store.removeAgent(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'Bot tidak ditemukan' });
      return;
    }
    res.json({ ok: true, snapshot: store.getSnapshot() });
  });

  router.post('/agents/:id/move', (req, res) => {
    const { zone } = req.body as { zone?: ZoneId };
    if (!zone) {
      res.status(400).json({ error: 'Zone wajib diisi' });
      return;
    }
    const agent = store.moveAgentToZone(req.params.id, zone, 0);
    if (!agent) {
      res.status(404).json({ error: 'Bot tidak ditemukan' });
      return;
    }
    res.json({ agent, snapshot: store.getSnapshot() });
  });

  router.post('/agents/:id/chat', async (req, res) => {
    const { toAgentId, content, createTask, title, clientContext } = req.body as {
      toAgentId?: string;
      content?: string;
      createTask?: boolean;
      title?: string;
      clientContext?: {
        agents?: Agent[];
        settingsPatch?: Partial<RuntimeSettings>;
      };
    };
    if (clientContext) {
      store.hydrateFromClient(clientContext);
    }
    const sender = store.getAgent(req.params.id);
    if (!sender) {
      res.status(404).json({ error: 'Bot pengirim tidak ditemukan' });
      return;
    }
    if (!content?.trim()) {
      res.status(400).json({ error: 'Pesan tidak boleh kosong' });
      return;
    }

    if (createTask && toAgentId) {
      const task = await orchestrator.delegateFromBot({
        fromAgentId: sender.id,
        toAgentId,
        title: title?.trim() || `Perintah dari ${sender.name}`,
        instructions: content.trim(),
      });
      res.json({ ok: true, task, snapshot: store.getSnapshot() });
      return;
    }

    await bridge.processBotEvent(sender.id, 'bot:message', {
      toAgentId: toAgentId || 'all',
      content: content.trim(),
    });
    res.json({ ok: true, snapshot: store.getSnapshot() });
  });

  router.post('/office/all-hands', (req, res) => {
    const { mode } = req.body as { mode?: 'meeting' | 'desks' | 'lounge' };
    const agents = store.getAgents().filter((a) => a.status !== 'offline');
    agents.forEach((agent, idx) => {
      if (mode === 'meeting') {
        store.moveAgentToZone(agent.id, 'meeting-table', idx, 'meeting');
        store.setSpeechBubble(agent.id, 'Merapat ke ruang meeting!', 'chat', 3500);
      } else if (mode === 'lounge') {
        store.moveAgentToZone(agent.id, 'lounge', idx, 'idle');
        store.setSpeechBubble(agent.id, 'Ngopi sebentar di lounge~', 'chat', 3500);
      } else {
        store.moveAgentToZone(agent.id, agent.homeZone, idx, 'idle');
        store.setSpeechBubble(agent.id, 'Kembali ke meja kerja.', 'chat', 3000);
      }
    });

    store.addComms({
      fromId: 'user',
      fromName: 'Commander (You)',
      toId: 'all',
      toName: 'All Muse Bots',
      kind: 'system',
      content:
        mode === 'meeting'
          ? 'Memanggil seluruh bot Muse AI berkumpul di War Room / Meeting Table.'
          : mode === 'lounge'
            ? 'Istirahat sejenak — tim berjalan menuju Coffee Lounge.'
            : 'Seluruh bot kembali ke workstation masing-masing.',
    });
    res.json({ ok: true, snapshot: store.getSnapshot() });
  });

  router.post('/settings', (req, res) => {
    const updated = store.updateSettings(req.body || {});
    res.json({ settings: updated, snapshot: store.getSnapshot() });
  });

  // --- External Bot REST Bridge Endpoints ---
  router.post('/bridge/register', requireBridgeToken, (req, res) => {
    const body = req.body as {
      id?: string;
      name?: string;
      role?: string;
      description?: string;
      homeZone?: ZoneId;
      color?: string;
      canDelegate?: boolean;
      webhookUrl?: string;
    };
    if (!body.name?.trim()) {
      res.status(400).json({ error: 'name wajib diisi' });
      return;
    }
    const agent = bridge.registerOrUpdateExternalBot({
      id: body.id,
      name: body.name.trim(),
      role: body.role?.trim() || 'External Bot',
      description: body.description,
      homeZone: body.homeZone,
      color: body.color,
      canDelegate: body.canDelegate,
      type: body.webhookUrl ? 'external-webhook' : 'external-ws',
      webhookUrl: body.webhookUrl,
    });
    res.status(201).json({ agent, snapshot: store.getSnapshot() });
  });

  router.post('/bridge/bots/:id/event', requireBridgeToken, async (req, res) => {
    const { event, payload } = req.body as {
      event?: string;
      payload?: Record<string, unknown>;
    };
    if (!event) {
      res.status(400).json({ error: 'event wajib diisi (misal: bot:status, bot:message, task:delegate)' });
      return;
    }
    await bridge.processBotEvent(req.params.id, event, payload || {});
    res.json({ ok: true });
  });

  router.post('/bridge/tasks/:id/complete', requireBridgeToken, async (req, res) => {
    const { result, speech } = req.body as { result?: string; speech?: string };
    await orchestrator.completeExternalTask(
      req.params.id,
      result || 'Selesai dikerjakan oleh bot eksternal.',
      speech
    );
    res.json({ ok: true });
  });

  router.post('/bridge/tasks/:id/fail', requireBridgeToken, async (req, res) => {
    const { error } = req.body as { error?: string };
    await orchestrator.failExternalTask(req.params.id, error || 'External task failed');
    res.json({ ok: true });
  });

  return router;
}
