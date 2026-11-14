import { NextFunction, Request, Response, Router } from 'express';
import {
  BridgeValidationError,
  ExternalBridge,
  normalizeAgentStatus,
  normalizeBrainMode,
  validateWebhookUrl,
} from '../bridge/externalBridge.js';
import { MissionOrchestrator, MissionPreconditionError } from '../llm/orchestrator.js';
import { MissingProviderKeyError } from '../llm/providers.js';
import { normalizeZoneId, pickSpotInZone } from '../officeMap.js';
import {
  BridgeAuthResult,
  SESSION_COOKIE_NAME,
  authenticateBridgeToken,
  buildClearSessionCookie,
  buildSessionCookie,
  extractBearerOrHeaderToken,
  isHttpsRequest,
  logDeprecatedLegacyTokenOnce,
  parseCookies,
  signSessionToken,
  timingSafeEqualStr,
  verifySessionToken,
} from '../security.js';
import { IS_SERVERLESS, WorkspaceStore } from '../store.js';
import { Agent, AgentType, AvatarVariant, LLMProvider, RuntimeSettings, ZoneId } from '../types.js';

const VALID_PROVIDERS: LLMProvider[] = ['gemini', 'openai', 'anthropic'];

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

  const authenticateBridge = (req: Request, claimedBotId?: string): BridgeAuthResult => {
    const supplied = extractBearerOrHeaderToken(req);
    const settings = store.getSettings();
    const auth = authenticateBridgeToken(
      supplied,
      settings.botTokens,
      settings.bridgeToken,
      claimedBotId
    );
    if (auth.ok && auth.deprecatedLegacy) {
      logDeprecatedLegacyTokenOnce(`rest:${claimedBotId || req.path}`);
    }
    return auth;
  };

  const requireOwner = (req: Request, res: Response, next: NextFunction): void => {
    if (!isOwnerAuthenticated(req)) {
      res.status(401).json({ error: 'Autentikasi pemilik diperlukan (silakan login terlebih dahulu).' });
      return;
    }
    next();
  };

  const handleBridgeAuth = (req: Request, res: Response, claimedBotId?: string): BridgeAuthResult | null => {
    const auth = authenticateBridge(req, claimedBotId);
    if (!auth.ok) {
      if (auth.forbiddenImpersonation) {
        res.status(403).json({ error: auth.reason || 'Token tidak berhak mengakses bot lain' });
      } else {
        res.status(401).json({ error: 'Invalid or missing x-muse-token' });
      }
      return null;
    }
    return auth;
  };

  const requireBridgeToken = (req: Request, res: Response, next: NextFunction): void => {
    const claimedBotId = req.params.id && req.path.startsWith('/bridge/bots/') ? req.params.id : undefined;
    const auth = handleBridgeAuth(req, res, claimedBotId);
    if (!auth) return;
    res.locals.bridgeAuth = auth;
    next();
  };

  const requireOwnerOrBridge = (req: Request, res: Response, next: NextFunction): void => {
    if (isOwnerAuthenticated(req)) {
      next();
      return;
    }
    const auth = authenticateBridge(req);
    if (!auth.ok) {
      res.status(401).json({ error: 'Unauthorized: login owner atau sertakan header x-muse-token.' });
      return;
    }
    res.locals.bridgeAuth = auth;
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
    const { passcode } = (req.body || {}) as { passcode?: unknown };
    const configured = store.getSettings().ownerPasscode;
    if (!configured) {
      res.status(503).json({
        error: 'MUSE_OWNER_PASSCODE belum diatur di environment variable server.',
      });
      return;
    }
    if (typeof passcode !== 'string' || !passcode.trim() || !timingSafeEqualStr(passcode.trim(), configured)) {
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
      const { prompt, targetAgentId, stream, clientContext } = (req.body || {}) as {
        prompt?: unknown;
        targetAgentId?: string;
        stream?: boolean;
        clientContext?: {
          agents?: Agent[];
          settingsPatch?: Partial<RuntimeSettings>;
        };
      };
      if (typeof prompt !== 'string' || !prompt.trim()) {
        res.status(400).json({ error: 'Prompt perintah tidak boleh kosong.' });
        return;
      }

      if (clientContext) {
        store.hydrateFromClient(clientContext);
      }

      const cleanTargetId = typeof targetAgentId === 'string' && targetAgentId.trim() ? targetAgentId.trim() : undefined;
      orchestrator.resolveMissionTarget(cleanTargetId);

      const shouldStream = Boolean(stream || req.headers.accept?.includes('text/event-stream'));
      if (shouldStream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();

        const unsubscribe = store.subscribe((event, payload) => {
          if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ event, payload })}\n\n`);
          }
        });
        req.on('close', unsubscribe);

        try {
          await orchestrator.startMission(prompt, cleanTargetId, true);
          if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ event: 'done', payload: store.getSnapshot() })}\n\n`);
          }
        } catch (streamErr) {
          if (!res.writableEnded) {
            res.write(
              `data: ${JSON.stringify({
                event: 'error',
                payload: { message: streamErr instanceof Error ? streamErr.message : 'Gagal memulai misi' },
              })}\n\n`
            );
          }
        } finally {
          unsubscribe();
          if (!res.writableEnded) {
            res.end();
          }
        }
        return;
      }

      const mission = await orchestrator.startMission(
        prompt,
        cleanTargetId,
        IS_SERVERLESS
      );
      res.status(201).json({ mission, snapshot: store.getSnapshot() });
    } catch (err) {
      if (!res.headersSent) {
        const status =
          err instanceof MissionPreconditionError || err instanceof MissingProviderKeyError
            ? 400
            : 500;
        res.status(status).json({ error: err instanceof Error ? err.message : 'Gagal memulai misi' });
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

  router.post('/tasks/:id/cancel', noStore, requireOwner, async (req, res) => {
    const outcome = await orchestrator.cancelTask(req.params.id);
    if (!outcome.ok) {
      res.status(outcome.reason === 'Tugas tidak ditemukan' ? 404 : 400).json({ error: outcome.reason });
      return;
    }
    res.json({ ok: true, task: outcome.task, snapshot: store.getSnapshot() });
  });

  router.post('/tasks/:id/fail', noStore, requireOwner, async (req, res) => {
    const { reason } = (req.body || {}) as { reason?: unknown };
    const cleanReason = typeof reason === 'string' && reason.trim() ? reason.trim() : undefined;
    const outcome = await orchestrator.markTaskFailedByOwner(req.params.id, cleanReason);
    if (!outcome.ok) {
      res.status(outcome.reason === 'Tugas tidak ditemukan' ? 404 : 400).json({ error: outcome.reason });
      return;
    }
    res.json({ ok: true, task: outcome.task, snapshot: store.getSnapshot() });
  });

  router.post('/tasks/:id/reassign', noStore, requireOwner, async (req, res) => {
    const { targetAgentId } = (req.body || {}) as { targetAgentId?: unknown };
    const cleanTarget =
      typeof targetAgentId === 'string' && targetAgentId.trim() ? targetAgentId.trim() : undefined;
    const outcome = await orchestrator.reassignTask(req.params.id, cleanTarget);
    if (!outcome.ok) {
      res.status(outcome.reason === 'Tugas tidak ditemukan' ? 404 : 400).json({ error: outcome.reason });
      return;
    }
    res.json({ ok: true, task: outcome.task, snapshot: store.getSnapshot() });
  });

  router.post('/agents', requireOwner, (req, res) => {
    const body = (req.body || {}) as Partial<Agent> & { name?: unknown; role?: unknown };
    if (typeof body.name !== 'string' || !body.name.trim() || typeof body.role !== 'string' || !body.role.trim()) {
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

    let webhookUrl: string | undefined;
    try {
      webhookUrl = validateWebhookUrl(body.webhookUrl);
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : 'webhookUrl tidak valid' });
      return;
    }

    if (body.provider !== undefined && !VALID_PROVIDERS.includes(body.provider)) {
      res.status(400).json({ error: `Provider tidak valid: ${String(body.provider)}` });
      return;
    }

    const validTypes: AgentType[] = ['builtin', 'external-ws', 'external-rest', 'external-webhook'];
    if (body.type !== undefined && !validTypes.includes(body.type)) {
      res.status(400).json({ error: `Tipe bot tidak valid: ${String(body.type)}` });
      return;
    }

    const slugBase = body.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    const id =
      typeof body.id === 'string' && body.id.trim()
        ? body.id.trim()
        : `muse-${slugBase || 'bot'}-${Date.now().toString(36).slice(-4)}`;
    if (!/^[a-z0-9][a-z0-9_-]{1,63}$/i.test(id)) {
      res.status(400).json({ error: 'ID bot tidak valid (2-64 karakter alfanumerik, - atau _)' });
      return;
    }
    const pos = pickSpotInZone(zone, store.getAgents().length, store.getOccupiedInZone(zone));
    const type: AgentType = body.type || 'builtin';
    const provider: LLMProvider = body.provider || store.getSettings().defaultProvider;
    const avatarVariant: AvatarVariant =
      body.avatarVariant || (type === 'builtin' ? 'coder' : 'external');

    const agent: Agent = {
      id,
      name: body.name.trim(),
      role: body.role.trim(),
      description:
        typeof body.description === 'string' && body.description.trim()
          ? body.description.trim()
          : `Bot spesialis ${body.role.trim()}`,
      systemPrompt:
        typeof body.systemPrompt === 'string' && body.systemPrompt.trim()
          ? body.systemPrompt.trim()
          : `Kamu adalah ${body.name.trim()}, berperan sebagai ${body.role.trim()}. Kerjakan tugas dengan teliti dan terstruktur.`,
      type,
      provider,
      model: typeof body.model === 'string' ? body.model.trim() : '',
      webhookUrl,
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
    const patch = (req.body || {}) as Partial<Agent>;
    const allowed: Partial<Agent> = {};
    const fields: Array<keyof Agent> = [
      'name',
      'role',
      'description',
      'systemPrompt',
      'model',
      'canDelegate',
      'color',
      'avatarVariant',
    ];
    for (const key of fields) {
      if (patch[key] !== undefined) {
        (allowed as Record<string, unknown>)[key] = patch[key];
      }
    }

    if (patch.provider !== undefined) {
      if (!VALID_PROVIDERS.includes(patch.provider)) {
        res.status(400).json({ error: `Provider tidak valid: ${String(patch.provider)}` });
        return;
      }
      allowed.provider = patch.provider;
    }
    if (patch.type !== undefined) {
      if (!['builtin', 'external-ws', 'external-rest', 'external-webhook'].includes(patch.type)) {
        res.status(400).json({ error: `Tipe bot tidak valid: ${String(patch.type)}` });
        return;
      }
      allowed.type = patch.type;
    }
    if (patch.status !== undefined) {
      const normalizedStatus = normalizeAgentStatus(patch.status);
      if (!normalizedStatus) {
        res.status(400).json({ error: `Status tidak valid: ${String(patch.status)}` });
        return;
      }
      allowed.status = normalizedStatus;
    }
    if (patch.webhookUrl !== undefined) {
      try {
        allowed.webhookUrl = validateWebhookUrl(patch.webhookUrl);
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'webhookUrl tidak valid' });
        return;
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
    try {
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
      if (typeof content !== 'string' || !content.trim()) {
        res.status(400).json({ error: 'Pesan tidak boleh kosong' });
        return;
      }

      const cleanTarget = typeof toAgentId === 'string' && toAgentId.trim() ? toAgentId.trim() : undefined;
      if (createTask && cleanTarget) {
        const task = await orchestrator.delegateFromBot({
          fromAgentId: sender.id,
          toAgentId: cleanTarget,
          title: title?.trim() || `Perintah dari ${sender.name}`,
          instructions: content.trim(),
          waitForCompletion: IS_SERVERLESS,
        });
        if (!task) {
          res.status(404).json({ error: `Bot penerima "${cleanTarget}" tidak ditemukan` });
          return;
        }
        res.json({ ok: true, task, snapshot: store.getSnapshot() });
        return;
      }

      await bridge.processBotEvent(sender.id, 'bot:message', {
        toAgentId: cleanTarget || 'all',
        content: content.trim(),
      });
      res.json({ ok: true, snapshot: store.getSnapshot() });
    } catch (err) {
      const status =
        err instanceof BridgeValidationError
          ? err.statusCode
          : err instanceof MissionPreconditionError || err instanceof MissingProviderKeyError
            ? 400
            : 500;
      res.status(status).json({ error: err instanceof Error ? err.message : 'Gagal mengirim perintah bot' });
    }
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
      if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
        res.status(400).json({ error: 'Payload pengaturan harus berupa objek JSON' });
        return;
      }
      const updated = store.updateSettings(req.body);
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
    const botId = req.params.id;
    const parsedSince = Number(req.query.since);
    const since = Number.isFinite(parsedSince) && parsedSince >= 0 ? parsedSince : 0;
    const rawWaitMs = Number(req.query.waitMs);
    const waitMs =
      !IS_SERVERLESS && Number.isFinite(rawWaitMs) && rawWaitMs > 0
        ? Math.min(Math.max(Math.floor(rawWaitMs), 0), 20_000)
        : 0;

    const agent = store.getAgent(botId);
    if (!agent) {
      res.status(404).json({ error: `Bot "${botId}" tidak ditemukan` });
      return;
    }

    const collectMailbox = () => {
      const events = store.getBotOutboxEvents(botId, since);
      const snap = store.getSnapshot();
      const pendingTasks = snap.tasks.filter(
        (t) => t.assignedToId === botId && (t.status === 'assigned' || t.status === 'working')
      );
      const cursor =
        events.length > 0 ? Math.max(...events.map((e) => e.seq)) : Math.max(since, snap.cursor);
      return { events, pendingTasks, cursor };
    };

    const initial = collectMailbox();
    if (waitMs <= 0 || initial.events.length > 0 || initial.pendingTasks.length > 0) {
      res.json({ ok: true, cursor: initial.cursor, events: initial.events, pendingTasks: initial.pendingTasks });
      return;
    }

    let settled = false;
    let checkQueued = false;
    let unsubscribe = () => {};
    let timeoutHandle: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
      unsubscribe();
    };

    const finishWithJson = (status: number, body: Record<string, unknown>) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (!res.headersSent && !res.writableEnded) {
        res.status(status).json(body);
      }
    };

    const evaluateWakeup = () => {
      checkQueued = false;
      if (settled || res.headersSent || res.writableEnded) return;
      if (!store.getAgent(botId)) {
        finishWithJson(404, { error: `Bot "${botId}" tidak ditemukan` });
        return;
      }
      const next = collectMailbox();
      if (next.events.length > 0 || next.pendingTasks.length > 0) {
        finishWithJson(200, {
          ok: true,
          cursor: next.cursor,
          events: next.events,
          pendingTasks: next.pendingTasks,
        });
      }
    };

    unsubscribe = store.subscribe(() => {
      if (settled || checkQueued) return;
      checkQueued = true;
      queueMicrotask(evaluateWakeup);
    });

    timeoutHandle = setTimeout(() => {
      const latest = collectMailbox();
      finishWithJson(200, {
        ok: true,
        cursor: latest.cursor,
        events: latest.events,
        pendingTasks: latest.pendingTasks,
      });
    }, waitMs);
    timeoutHandle.unref?.();

    const onDisconnect = () => {
      if (!settled) {
        settled = true;
        cleanup();
      }
    };
    req.on('close', onDisconnect);
    res.on('close', onDisconnect);
  });

  router.post('/bridge/register', noStore, requireBridgeToken, (req, res) => {
    try {
      const bridgeAuth = res.locals.bridgeAuth as BridgeAuthResult | undefined;
      const body = (req.body || {}) as {
        id?: unknown;
        name?: unknown;
        role?: unknown;
        description?: unknown;
        homeZone?: ZoneId;
        color?: unknown;
        canDelegate?: unknown;
        brainMode?: unknown;
        webhookUrl?: unknown;
      };
      if (typeof body.name !== 'string' || !body.name.trim()) {
        res.status(400).json({ error: 'name wajib diisi berupa string' });
        return;
      }
      if (body.id !== undefined && typeof body.id !== 'string') {
        res.status(400).json({ error: 'id harus berupa string' });
        return;
      }
      const requestedId =
        typeof body.id === 'string' && body.id.trim() ? body.id.trim() : bridgeAuth?.matchedBotId;
      if (bridgeAuth?.matchedBotId && requestedId && requestedId !== bridgeAuth.matchedBotId) {
        res.status(403).json({
          error: `Token bot ini hanya sah untuk "${bridgeAuth.matchedBotId}" dan tidak boleh menyamar sebagai "${requestedId}"`,
        });
        return;
      }
      const webhookUrl = validateWebhookUrl(body.webhookUrl);
      const brainMode = normalizeBrainMode(body.brainMode);
      const agent = bridge.registerOrUpdateExternalBot({
        id: requestedId,
        name: body.name.trim(),
        role: typeof body.role === 'string' && body.role.trim() ? body.role.trim() : 'External Bot',
        description: typeof body.description === 'string' ? body.description : undefined,
        homeZone: body.homeZone,
        color: typeof body.color === 'string' ? body.color : undefined,
        canDelegate: body.canDelegate !== undefined ? Boolean(body.canDelegate) : undefined,
        brainMode,
        type: webhookUrl ? 'external-webhook' : 'external-rest',
        webhookUrl,
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
          error:
            'event wajib diisi (misal: bot:hello, bot:heartbeat, bot:status, bot:speech, bot:delegate, task:accept, task:complete, task:fail)',
        });
        return;
      }
      if (
        body.payload !== undefined &&
        (body.payload === null || typeof body.payload !== 'object' || Array.isArray(body.payload))
      ) {
        res.status(400).json({ error: 'payload wajib berupa objek JSON' });
        return;
      }
      if (body.eventId !== undefined && typeof body.eventId !== 'string') {
        res.status(400).json({ error: 'eventId wajib berupa string' });
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
      res.json({
        ok: true,
        duplicate: Boolean(result.duplicate),
        ...(result.taskId ? { taskId: result.taskId } : {}),
        ...(result.failed ? { failed: true, error: result.error } : {}),
        agent: result.agent,
        cursor: store.getSnapshot().cursor,
      });
    } catch (err) {
      const status = err instanceof BridgeValidationError ? err.statusCode : 400;
      res.status(status).json({ error: err instanceof Error ? err.message : 'Invalid bridge event' });
    }
  });

  router.post('/bridge/tasks/:id/complete', noStore, requireBridgeToken, async (req, res) => {
    const bridgeAuth = res.locals.bridgeAuth as BridgeAuthResult | undefined;
    const existingTask = store.getTask(req.params.id);
    if (bridgeAuth?.matchedBotId && existingTask && existingTask.assignedToId !== bridgeAuth.matchedBotId) {
      res.status(403).json({
        error: `Token bot ini hanya sah untuk "${bridgeAuth.matchedBotId}" dan tidak boleh menyelesaikan tugas milik "${existingTask.assignedToId}"`,
      });
      return;
    }
    const { result, speech } = (req.body || {}) as { result?: unknown; speech?: unknown };
    if (result !== undefined && typeof result !== 'string') {
      res.status(400).json({ error: 'result harus berupa string' });
      return;
    }
    if (speech !== undefined && typeof speech !== 'string') {
      res.status(400).json({ error: 'speech harus berupa string' });
      return;
    }
    const outcome = await orchestrator.completeExternalTask(
      req.params.id,
      (typeof result === 'string' && result.trim()) ? result : 'Selesai dikerjakan oleh bot eksternal.',
      typeof speech === 'string' ? speech : undefined,
      bridgeAuth?.matchedBotId
    );
    if (!outcome.applied) {
      res.status(404).json({ error: outcome.reason || 'Tugas tidak ditemukan' });
      return;
    }
    res.json({ ok: true, duplicate: Boolean(outcome.duplicate) });
  });

  router.post('/bridge/tasks/:id/fail', noStore, requireBridgeToken, async (req, res) => {
    const bridgeAuth = res.locals.bridgeAuth as BridgeAuthResult | undefined;
    const existingTask = store.getTask(req.params.id);
    if (bridgeAuth?.matchedBotId && existingTask && existingTask.assignedToId !== bridgeAuth.matchedBotId) {
      res.status(403).json({
        error: `Token bot ini hanya sah untuk "${bridgeAuth.matchedBotId}" dan tidak boleh menggagalkan tugas milik "${existingTask.assignedToId}"`,
      });
      return;
    }
    const { error } = (req.body || {}) as { error?: unknown };
    if (error !== undefined && typeof error !== 'string') {
      res.status(400).json({ error: 'error harus berupa string' });
      return;
    }
    const outcome = await orchestrator.failExternalTask(
      req.params.id,
      (typeof error === 'string' && error.trim()) ? error : 'External task failed',
      bridgeAuth?.matchedBotId
    );
    if (!outcome.applied) {
      res.status(404).json({ error: outcome.reason || 'Tugas tidak ditemukan' });
      return;
    }
    res.json({ ok: true, duplicate: Boolean(outcome.duplicate) });
  });

  router.use((_req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
  });

  return router;
}
