import { NextFunction, Request, Response, Router } from 'express';
import { BridgeValidationError, ExternalBridge } from '../bridge/externalBridge.js';
import { MissionOrchestrator } from '../llm/orchestrator.js';
import { normalizeZoneId, pickSpotInZone } from '../officeMap.js';
import {
  SESSION_COOKIE_NAME,
  buildClearSessionCookie,
  buildSessionCookie,
  extractBearerOrHeaderToken,
  isHttpsRequest,
  isRetiredToken,
  parseCookies,
  signSessionToken,
  timingSafeEqualStr,
  verifySessionToken,
} from '../security.js';
import { IS_SERVERLESS, WorkspaceStore } from '../store.js';
import { Agent, AgentType, AvatarVariant, LLMProvider, RuntimeSettings, ZoneId } from '../types.js';

export function createApiRouter(
  store: WorkspaceStore,
  orchestrator: MissionOrchestrator,
  bridge: ExternalBridge
): Router {
  const router = Router();

  const isOwnerAuthenticated = (req: Request): boolean => {
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies[SESSION_COOKIE_NAME];
    return Boolean(verifySessionToken(token, store.getSettings().sessionSecret));
  };

  const isBridgeAuthenticated = (req: Request): boolean => {
    // Only inspect headers on REST routes so bridge tokens never leak in HTTP access logs
    const supplied = extractBearerOrHeaderToken(req);
    const expected = store.getSettings().bridgeToken;
    if (!supplied || !expected || isRetiredToken(supplied)) return false;
    return timingSafeEqualStr(supplied, expected);
  };

  const requireOwner = (req: Request, res: Response, next: NextFunction): void => {
    if (!isOwnerAuthenticated(req)) {
      res.status(401).json({ error: 'Autentikasi pemilik diperlukan (silakan login terlebih dahulu).' });
      return;
    }
    next();
  };

  const requireBridgeToken = (req: Request, res: Response, next: NextFunction): void => {
    if (!isBridgeAuthenticated(req)) {
      res.status(401).json({ error: 'Invalid or missing x-muse-token' });
      return;
    }
    next();
  };

  const requireOwnerOrBridge = (req: Request, res: Response, next: NextFunction): void => {
    if (!isOwnerAuthenticated(req) && !isBridgeAuthenticated(req)) {
      res.status(401).json({ error: 'Unauthorized: login owner atau sertakan header x-muse-token.' });
      return;
    }
    next();
  };

  const noStore = (_req: Request, res: Response, next: NextFunction): void => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    next();
  };

  // --- Public minimal health & auth session endpoints (never return secrets or workspace state) ---
  router.get('/health', noStore, (_req, res) => {
    res.json({
      ok: true,
      service: 'muse-hq-server',
      serverless: IS_SERVERLESS,
      authConfigured: Boolean(store.getSettings().ownerPasscode),
      timestamp: new Date().toISOString(),
    });
  });

  router.get('/auth/session', noStore, (req, res) => {
    res.json({
      authenticated: isOwnerAuthenticated(req),
      authConfigured: Boolean(store.getSettings().ownerPasscode),
      serverless: IS_SERVERLESS,
    });
  });

  router.post('/auth/login', noStore, (req, res) => {
    const { passcode } = (req.body || {}) as { passcode?: string };
    const configured = store.getSettings().ownerPasscode;
    if (!configured) {
      res.status(503).json({
        error: 'MUSE_OWNER_PASSCODE belum diatur di environment variable server.',
      });
      return;
    }
    if (!passcode || !timingSafeEqualStr(passcode.trim(), configured)) {
      res.status(401).json({ error: 'Owner passcode salah.' });
      return;
    }

    const sessionToken = signSessionToken(store.getSettings().sessionSecret);
    res.setHeader('Set-Cookie', buildSessionCookie(sessionToken, isHttpsRequest(req)));
    res.json({ ok: true, authenticated: true });
  });

  router.post('/auth/logout', noStore, (req, res) => {
    res.setHeader('Set-Cookie', buildClearSessionCookie(isHttpsRequest(req)));
    res.json({ ok: true, authenticated: false });
  });

  // --- Protected State (accessible by authenticated Owner UI OR Bridge Token for REST polling bots) ---
  router.get('/state', noStore, requireOwnerOrBridge, (req, res) => {
    const rawSince = req.query.since;
    const since = typeof rawSince === 'string' && rawSince ? Number(rawSince) : undefined;
    res.json(store.getSnapshot(since));
  });

  // --- Owner Mission & Agent Management Routes ---
  router.post('/missions', requireOwner, async (req, res) => {
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

  router.post('/missions/clear', requireOwner, (_req, res) => {
    store.clearHistory();
    res.json({ ok: true, snapshot: store.getSnapshot() });
  });

  router.post('/workspace/reset', noStore, requireOwnerOrBridge, (_req, res) => {
    const snapshot = store.resetWorkspace();
    res.json({ ok: true, snapshot });
  });

  router.post('/agents', requireOwner, (req, res) => {
    const body = req.body as Partial<Agent> & { name?: string; role?: string };
    if (!body.name?.trim() || !body.role?.trim()) {
      res.status(400).json({ error: 'Nama dan role bot wajib diisi.' });
      return;
    }

    let zone: ZoneId = 'engineering-bay';
    if (body.homeZone) {
      const normalized = normalizeZoneId(body.homeZone);
      if (!normalized) {
        res.status(400).json({ error: `Zona tidak valid: ${body.homeZone}` });
        return;
      }
      zone = normalized;
    }

    const slugBase = body.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    const id = body.id?.trim() || `muse-${slugBase || 'bot'}-${Date.now().toString(36).slice(-4)}`;
    const pos = pickSpotInZone(zone, store.getAgents().length, store.getOccupiedInZone(zone));
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
      status: type === 'external-ws' ? 'offline' : type === 'external-rest' ? 'online' : 'idle',
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

  router.patch('/agents/:id', requireOwner, (req, res) => {
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
      'color',
      'avatarVariant',
      'status',
    ];
    for (const key of fields) {
      if (patch[key] !== undefined) {
        (allowed as Record<string, unknown>)[key] = patch[key];
      }
    }

    if (patch.homeZone !== undefined) {
      const normalized = normalizeZoneId(patch.homeZone);
      if (!normalized) {
        res.status(400).json({ error: `Zona tidak valid: ${patch.homeZone}` });
        return;
      }
      allowed.homeZone = normalized;
    }

    const updated = store.updateAgent(req.params.id, allowed);
    if (allowed.homeZone && allowed.homeZone !== existing.currentZone) {
      store.moveAgentToZone(req.params.id, allowed.homeZone, 0, updated?.status);
    }
    res.json({ agent: updated, snapshot: store.getSnapshot() });
  });

  router.delete('/agents/:id', requireOwner, (req, res) => {
    const ok = store.removeAgent(req.params.id);
    if (!ok) {
      res.status(404).json({ error: 'Bot tidak ditemukan' });
      return;
    }
    res.json({ ok: true, snapshot: store.getSnapshot() });
  });

  router.post('/agents/:id/move', requireOwner, (req, res) => {
    const { zone } = req.body as { zone?: string };
    const normalized = normalizeZoneId(zone);
    if (!normalized) {
      res.status(400).json({ error: 'Zone wajib diisi dengan ID zona yang valid' });
      return;
    }
    const agent = store.moveAgentToZone(req.params.id, normalized, 0);
    if (!agent) {
      res.status(404).json({ error: 'Bot tidak ditemukan' });
      return;
    }
    res.json({ agent, snapshot: store.getSnapshot() });
  });

  router.post('/agents/:id/chat', requireOwner, async (req, res) => {
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

  router.post('/office/all-hands', requireOwner, (req, res) => {
    const { mode } = req.body as {
      mode?: 'war-room' | 'meeting' | 'desks' | 'coffee-lounge' | 'lounge';
    };
    const isWarRoom = mode === 'war-room' || mode === 'meeting';
    const isCoffee = mode === 'coffee-lounge' || mode === 'lounge';
    const agents = store.getAgents().filter((a) => a.status !== 'offline');

    agents.forEach((agent, idx) => {
      if (isWarRoom) {
        store.moveAgentToZone(agent.id, 'war-room', idx, 'meeting');
        store.setSpeechBubble(agent.id, 'Merapat ke War Room!', 'chat', 3500);
      } else if (isCoffee) {
        store.moveAgentToZone(agent.id, 'coffee-lounge', idx, 'idle');
        store.setSpeechBubble(agent.id, 'Ngopi sebentar di Coffee Lounge~', 'chat', 3500);
      } else {
        store.moveAgentToZone(agent.id, agent.homeZone, idx, 'idle');
        store.setSpeechBubble(agent.id, 'Kembali ke meja kerja.', 'chat', 3000);
      }
    });

    store.addComms({
      fromId: 'user',
      fromName: 'Commander (Owner)',
      toId: 'all',
      toName: 'All Muse Bots',
      kind: 'system',
      content: isWarRoom
        ? 'Memanggil seluruh bot Muse AI berkumpul di War Room.'
        : isCoffee
          ? 'Istirahat sejenak — tim berjalan menuju Coffee Lounge.'
          : 'Seluruh bot kembali ke workstation masing-masing.',
    });
    res.json({ ok: true, snapshot: store.getSnapshot() });
  });

  router.post('/settings', noStore, requireOwner, (req, res) => {
    try {
      const updated = store.updateSettings(req.body || {});
      res.json({ settings: updated, snapshot: store.getSnapshot() });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'Pengaturan tidak valid' });
    }
  });

  // --- External Bot REST Bridge Endpoints ---
  router.get('/bridge/state', noStore, requireBridgeToken, (req, res) => {
    const rawSince = req.query.since;
    const since = typeof rawSince === 'string' && rawSince ? Number(rawSince) : undefined;
    res.json(store.getSnapshot(since));
  });

  router.get('/bridge/bots/:id/events', noStore, requireBridgeToken, (req, res) => {
    const since = Number(req.query.since || 0) || 0;
    const agent = store.getAgent(req.params.id);
    if (!agent) {
      res.status(404).json({ error: `Bot "${req.params.id}" tidak ditemukan` });
      return;
    }
    const events = store.getBotOutboxEvents(req.params.id, since);
    const pendingTasks = store
      .getSnapshot()
      .tasks.filter((t) => t.assignedToId === req.params.id && (t.status === 'assigned' || t.status === 'working'));
    const nextCursor =
      events.length > 0 ? Math.max(...events.map((e) => e.seq)) : Math.max(since, store.getSnapshot().cursor);
    res.json({ ok: true, cursor: nextCursor, events, pendingTasks });
  });

  router.post('/bridge/register', noStore, requireBridgeToken, (req, res) => {
    try {
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
        type: body.webhookUrl ? 'external-webhook' : 'external-rest',
        webhookUrl: body.webhookUrl,
      });
      res.status(201).json({ agent, snapshot: store.getSnapshot() });
    } catch (err) {
      const status = err instanceof BridgeValidationError ? err.statusCode : 400;
      res.status(status).json({ error: err instanceof Error ? err.message : 'Invalid payload' });
    }
  });

  router.post('/bridge/bots/:id/event', noStore, requireBridgeToken, async (req, res) => {
    try {
      const body = (req.body || {}) as {
        event?: unknown;
        payload?: unknown;
        eventId?: unknown;
      };
      if (typeof body.event !== 'string' || !body.event.trim()) {
        res.status(400).json({
          error: 'event wajib diisi (misal: bot:hello, bot:status, bot:speech, bot:message, task:delegate, task:complete)',
        });
        return;
      }
      const payload =
        body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
          ? { ...(body.payload as Record<string, unknown>) }
          : {};
      if (typeof body.eventId === 'string' && body.eventId.trim() && !payload.eventId) {
        payload.eventId = body.eventId.trim();
      }
      const result = await bridge.processBotEvent(req.params.id, body.event.trim(), payload);
      res.json({ ok: true, duplicate: Boolean(result.duplicate), agent: result.agent, cursor: store.getSnapshot().cursor });
    } catch (err) {
      const status = err instanceof BridgeValidationError ? err.statusCode : 400;
      res.status(status).json({ error: err instanceof Error ? err.message : 'Invalid bridge event' });
    }
  });

  router.post('/bridge/tasks/:id/complete', noStore, requireBridgeToken, async (req, res) => {
    const { result, speech } = req.body as { result?: string; speech?: string };
    const outcome = await orchestrator.completeExternalTask(
      req.params.id,
      result || 'Selesai dikerjakan oleh bot eksternal.',
      speech
    );
    if (!outcome.applied) {
      res.status(404).json({ error: outcome.reason || 'Tugas tidak ditemukan' });
      return;
    }
    res.json({ ok: true, duplicate: Boolean(outcome.duplicate) });
  });

  router.post('/bridge/tasks/:id/fail', noStore, requireBridgeToken, async (req, res) => {
    const { error } = req.body as { error?: string };
    const outcome = await orchestrator.failExternalTask(
      req.params.id,
      error || 'External task failed'
    );
    if (!outcome.applied) {
      res.status(404).json({ error: outcome.reason || 'Tugas tidak ditemukan' });
      return;
    }
    res.json({ ok: true, duplicate: Boolean(outcome.duplicate) });
  });

  return router;
}
