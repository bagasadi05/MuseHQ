import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeZoneId, pickSpotInZone } from './officeMap.js';
import { deriveDeterministicKey, generateSecureToken, isRetiredToken } from './security.js';
import {
  Agent,
  AgentStatus,
  BridgeQueuedEvent,
  CommandBeam,
  CommsMessage,
  LLMProvider,
  Mission,
  PublicSettings,
  RuntimeSettings,
  SpeechBubble,
  Task,
  WorkspaceSnapshot,
  ZoneId,
} from './types.js';

const VALID_PROVIDERS: ReadonlySet<LLMProvider> = new Set(['gemini', 'openai', 'anthropic']);

function isValidProvider(value: unknown): value is LLMProvider {
  return typeof value === 'string' && VALID_PROVIDERS.has(value as LLMProvider);
}

export const IS_SERVERLESS = Boolean(
  process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY
);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = IS_SERVERLESS
  ? path.join(os.tmpdir(), 'muse-hq-data')
  : path.resolve(__dirname, '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

export type BroadcastFn = (event: string, payload: unknown) => void;

interface PersistedState {
  cursor?: number;
  agents: Agent[];
  missions: Mission[];
  tasks: Task[];
  comms: CommsMessage[];
}

export interface StartupSecurityStatus {
  generatedBridgeToken: boolean;
  generatedOwnerPasscode: boolean;
  bridgeTokenFromEnv: boolean;
  ownerPasscodeFromEnv: boolean;
  settingsFilePath: string;
}

function maskKey(key: string): string {
  if (!key) return '';
  if (key.length < 16) return '••••••••';
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

function createInitialComms(): CommsMessage[] {
  return [
    {
      id: `msg-${Date.now()}`,
      seq: 1,
      fromId: 'system',
      fromName: 'MuseHQ System',
      toId: 'all',
      toName: 'All Muse Bots',
      kind: 'system',
      content:
        'Ruangan kerja MuseHQ siap. Hubungkan bot Muse nyata via External Bridge atau tambahkan bot Cloud LLM lewat tombol "Tambah Bot".',
      timestamp: new Date().toISOString(),
    },
  ];
}

export class WorkspaceStore {
  private agents: Agent[] = [];
  private missions: Mission[] = [];
  private tasks: Task[] = [];
  private comms: CommsMessage[] = [];
  private beams: CommandBeam[] = [];
  private cursor = 1;
  private botOutbox = new Map<string, BridgeQueuedEvent[]>();
  private processedBridgeEventIds = new Map<string, string[]>();
  private settings: RuntimeSettings;
  private securityStatus: StartupSecurityStatus;
  private broadcaster: BroadcastFn = () => {};
  private subscribers = new Set<BroadcastFn>();
  private persistTimer: NodeJS.Timeout | null = null;

  constructor() {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    } catch {
      // Ignore directory errors in strictly read-only environments
    }
    const loaded = this.loadSettings();
    this.settings = loaded.settings;
    this.securityStatus = loaded.securityStatus;
    this.loadState();
  }

  getSecurityStatus(): StartupSecurityStatus {
    return { ...this.securityStatus };
  }

  setBroadcaster(fn: BroadcastFn): void {
    this.broadcaster = fn;
  }

  subscribe(fn: BroadcastFn): () => void {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }

  private emit(event: string, payload: unknown): void {
    this.broadcaster(event, payload);
    for (const sub of this.subscribers) {
      try {
        sub(event, payload);
      } catch {
        // Ignore closed stream subscriber errors
      }
    }
  }

  nextCursor(): number {
    this.cursor += 1;
    return this.cursor;
  }

  private loadSettings(): {
    settings: RuntimeSettings;
    securityStatus: StartupSecurityStatus;
  } {
    const envProvider = (process.env.DEFAULT_PROVIDER || '').trim().toLowerCase() as RuntimeSettings['defaultProvider'];
    const rawEnvBridge = (process.env.BOT_BRIDGE_TOKEN || '').trim();
    const envBridgeValid = !isRetiredToken(rawEnvBridge) ? rawEnvBridge : '';
    const envOwnerPasscode = (process.env.MUSE_OWNER_PASSCODE || '').trim();
    const envSessionSecret = (process.env.SESSION_SECRET || '').trim();

    let saved: Partial<RuntimeSettings> = {};
    if (!IS_SERVERLESS && fs.existsSync(SETTINGS_FILE)) {
      try {
        saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) as Partial<RuntimeSettings>;
      } catch {
        saved = {};
      }
    }

    const savedBridgeValid = !isRetiredToken(saved.bridgeToken) ? saved.bridgeToken!.trim() : '';
    const savedOwnerPasscode = typeof saved.ownerPasscode === 'string' ? saved.ownerPasscode.trim() : '';
    const savedSessionSecret = typeof saved.sessionSecret === 'string' ? saved.sessionSecret.trim() : '';

    let generatedBridgeToken = false;
    let generatedOwnerPasscode = false;

    let bridgeToken = envBridgeValid || savedBridgeValid;
    if (!bridgeToken) {
      bridgeToken = generateSecureToken('mhq_bot_', 24);
      generatedBridgeToken = true;
    }

    let ownerPasscode = envOwnerPasscode || savedOwnerPasscode;
    if (!ownerPasscode && !IS_SERVERLESS) {
      ownerPasscode = generateSecureToken('mhq_own_', 12);
      generatedOwnerPasscode = true;
    }

    let sessionSecret = envSessionSecret || savedSessionSecret;
    if (!sessionSecret) {
      sessionSecret = IS_SERVERLESS
        ? deriveDeterministicKey(`${ownerPasscode}:${bridgeToken}`)
        : generateSecureToken('mhq_ses_', 24);
    }

    const resolved: RuntimeSettings = {
      defaultProvider: isValidProvider(envProvider)
        ? envProvider
        : isValidProvider(saved.defaultProvider)
          ? saved.defaultProvider
          : 'gemini',
      geminiApiKey: saved.geminiApiKey || process.env.GEMINI_API_KEY || '',
      openaiApiKey: saved.openaiApiKey || process.env.OPENAI_API_KEY || '',
      anthropicApiKey: saved.anthropicApiKey || process.env.ANTHROPIC_API_KEY || '',
      geminiModel: saved.geminiModel || process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      openaiModel: saved.openaiModel || process.env.OPENAI_MODEL || 'gpt-4o-mini',
      anthropicModel: saved.anthropicModel || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5',
      bridgeToken,
      ownerPasscode,
      sessionSecret,
    };

    if (!IS_SERVERLESS) {
      this.writeSettingsFile(resolved);
    }

    return {
      settings: resolved,
      securityStatus: {
        generatedBridgeToken,
        generatedOwnerPasscode,
        bridgeTokenFromEnv: Boolean(envBridgeValid),
        ownerPasscodeFromEnv: Boolean(envOwnerPasscode),
        settingsFilePath: SETTINGS_FILE,
      },
    };
  }

  private writeSettingsFile(settings: RuntimeSettings): void {
    try {
      const tmpFile = `${SETTINGS_FILE}.tmp`;
      fs.writeFileSync(tmpFile, JSON.stringify(settings, null, 2), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tmpFile, SETTINGS_FILE);
    } catch {
      // Ignore write failures in read-only runtimes
    }
  }

  private loadState(): void {
    if (fs.existsSync(STATE_FILE)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as Partial<PersistedState>;
        const occupied: Array<{ x: number; y: number }> = [];
        this.agents = (parsed.agents || [])
          .filter((agent) => !(agent.type === 'builtin' && (agent.provider as string) === 'demo'))
          .map((agent, idx) => {
            const homeZone = normalizeZoneId(agent.homeZone) || 'coffee-lounge';
            const isExternalWs = agent.type === 'external-ws';
            const isRest = agent.type === 'external-rest';
            const fallbackPos = pickSpotInZone(homeZone, idx, occupied);
            const sameZonePos = agent.currentZone === homeZone ? agent.position : undefined;
            occupied.push(fallbackPos);
            return {
              ...agent,
              provider: isValidProvider(agent.provider)
                ? agent.provider
                : this.settings.defaultProvider,
              homeZone,
              bridgeConnected: isExternalWs ? false : agent.type === 'builtin' || isRest || Boolean(agent.webhookUrl),
              status: isExternalWs ? 'offline' : isRest ? 'online' : 'idle',
              currentTaskId: null,
              speechBubble: null,
              currentZone: homeZone,
              targetZone: homeZone,
              position: sameZonePos ?? fallbackPos,
              targetPosition: sameZonePos ?? fallbackPos,
            };
          });
        this.missions = (parsed.missions || []).map((m) =>
          m.status === 'running' ? { ...m, status: 'failed' as const } : m
        );
        this.tasks = (parsed.tasks || []).map((t) =>
          t.status === 'working' ||
          t.status === 'in-progress' ||
          t.status === 'delegated' ||
          t.status === 'queued' ||
          t.status === 'waiting-dependency' ||
          t.status === 'assigned'
            ? { ...t, status: 'failed' as const, error: t.error || 'Server restarted before completion' }
            : t
        );
        this.comms = (parsed.comms || []).slice(-200);
        this.cursor = Math.max(
          parsed.cursor || 1,
          ...this.comms.map((c) => c.seq || 0),
          ...this.tasks.map((t) => t.seq || 0)
        );
        return;
      } catch {
        // Fall through to clean defaults on corrupt JSON
      }
    }

    this.cursor = 1;
    this.agents = [];
    this.comms = createInitialComms();
    this.schedulePersist();
  }

  private writeStateToDisk(): void {
    try {
      const payload: PersistedState = {
        cursor: this.cursor,
        agents: this.agents,
        missions: this.missions.slice(-50),
        tasks: this.tasks.slice(-250),
        comms: this.comms.slice(-200),
      };
      const tmpFile = `${STATE_FILE}.tmp`;
      fs.writeFileSync(tmpFile, JSON.stringify(payload, null, 2), 'utf8');
      fs.renameSync(tmpFile, STATE_FILE);
    } catch (err) {
      if (!IS_SERVERLESS) {
        console.error('Failed to persist workspace state:', err);
      }
    }
  }

  private schedulePersist(): void {
    if (IS_SERVERLESS) {
      this.writeStateToDisk();
      return;
    }
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.writeStateToDisk();
    }, 150);
  }

  flushPersist(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.writeStateToDisk();
  }

  getSettings(): RuntimeSettings {
    return { ...this.settings };
  }

  getPublicSettings(): PublicSettings {
    return {
      defaultProvider: this.settings.defaultProvider,
      hasGeminiKey: Boolean(this.settings.geminiApiKey),
      hasOpenaiKey: Boolean(this.settings.openaiApiKey),
      hasAnthropicKey: Boolean(this.settings.anthropicApiKey),
      geminiKeyPreview: maskKey(this.settings.geminiApiKey),
      openaiKeyPreview: maskKey(this.settings.openaiApiKey),
      anthropicKeyPreview: maskKey(this.settings.anthropicApiKey),
      geminiModel: this.settings.geminiModel,
      openaiModel: this.settings.openaiModel,
      anthropicModel: this.settings.anthropicModel,
      hasBridgeToken: Boolean(this.settings.bridgeToken),
      bridgeTokenPreview: maskKey(this.settings.bridgeToken),
      authConfigured: Boolean(this.settings.ownerPasscode),
    };
  }

  updateSettings(patch: Partial<RuntimeSettings>): PublicSettings {
    const cleanPatch: Partial<RuntimeSettings> = {};
    if (isValidProvider(patch.defaultProvider)) {
      cleanPatch.defaultProvider = patch.defaultProvider;
    }
    if (typeof patch.geminiApiKey === 'string') cleanPatch.geminiApiKey = patch.geminiApiKey.trim();
    if (typeof patch.openaiApiKey === 'string') cleanPatch.openaiApiKey = patch.openaiApiKey.trim();
    if (typeof patch.anthropicApiKey === 'string') {
      cleanPatch.anthropicApiKey = patch.anthropicApiKey.trim();
    }
    if (typeof patch.geminiModel === 'string' && patch.geminiModel.trim()) {
      cleanPatch.geminiModel = patch.geminiModel.trim();
    }
    if (typeof patch.openaiModel === 'string' && patch.openaiModel.trim()) {
      cleanPatch.openaiModel = patch.openaiModel.trim();
    }
    if (typeof patch.anthropicModel === 'string' && patch.anthropicModel.trim()) {
      cleanPatch.anthropicModel = patch.anthropicModel.trim();
    }
    if (typeof patch.bridgeToken === 'string' && patch.bridgeToken.trim()) {
      const nextToken = patch.bridgeToken.trim();
      if (isRetiredToken(nextToken)) {
        throw new Error('Token bridge tidak memenuhi syarat keamanan minimum (minimal 8 karakter unik).');
      }
      cleanPatch.bridgeToken = nextToken;
    }
    if (typeof patch.ownerPasscode === 'string' && patch.ownerPasscode.trim()) {
      const nextPass = patch.ownerPasscode.trim();
      if (nextPass.length < 6) {
        throw new Error('Owner passcode minimal 6 karakter.');
      }
      cleanPatch.ownerPasscode = nextPass;
    }

    this.settings = { ...this.settings, ...cleanPatch };
    if (!IS_SERVERLESS) {
      this.writeSettingsFile(this.settings);
    }

    const publicSettings = this.getPublicSettings();
    this.emit('settings:updated', publicSettings);
    return publicSettings;
  }

  hydrateFromClient(clientContext?: {
    agents?: Agent[];
    settingsPatch?: Partial<RuntimeSettings>;
  }): void {
    if (!clientContext) return;
    // Never accept bridgeToken, ownerPasscode, or sessionSecret from clientContext
    if (clientContext.settingsPatch) {
      const p = clientContext.settingsPatch;
      if (isValidProvider(p.defaultProvider)) {
        this.settings.defaultProvider = p.defaultProvider;
      }
      if (p.geminiApiKey) this.settings.geminiApiKey = p.geminiApiKey;
      if (p.openaiApiKey) this.settings.openaiApiKey = p.openaiApiKey;
      if (p.anthropicApiKey) this.settings.anthropicApiKey = p.anthropicApiKey;
      if (p.geminiModel) this.settings.geminiModel = p.geminiModel;
      if (p.openaiModel) this.settings.openaiModel = p.openaiModel;
      if (p.anthropicModel) this.settings.anthropicModel = p.anthropicModel;
    }
    if (Array.isArray(clientContext.agents) && clientContext.agents.length > 0) {
      for (const incoming of clientContext.agents) {
        if (!incoming?.id) continue;
        if (incoming.type === 'builtin' && (incoming.provider as string) === 'demo') continue;
        const normalizedZone = normalizeZoneId(incoming.homeZone) || 'engineering-bay';
        const safeProvider = isValidProvider(incoming.provider)
          ? incoming.provider
          : this.settings.defaultProvider;
        const existing = this.getAgent(incoming.id);
        if (existing) {
          Object.assign(existing, {
            name: incoming.name || existing.name,
            role: incoming.role || existing.role,
            description: incoming.description || existing.description,
            systemPrompt: incoming.systemPrompt || existing.systemPrompt,
            provider: safeProvider,
            model: incoming.model ?? existing.model,
            homeZone: normalizedZone,
            canDelegate: incoming.canDelegate ?? existing.canDelegate,
            webhookUrl: incoming.webhookUrl ?? existing.webhookUrl,
            color: incoming.color || existing.color,
            avatarVariant: incoming.avatarVariant || existing.avatarVariant,
          });
        } else {
          const spot = pickSpotInZone(normalizedZone, this.agents.length, this.getOccupiedInZone(normalizedZone));
          this.agents.push({
            ...incoming,
            provider: safeProvider,
            homeZone: normalizedZone,
            currentZone: normalizedZone,
            targetZone: normalizedZone,
            position: spot,
            targetPosition: { ...spot },
            status: incoming.type === 'external-ws' ? 'offline' : 'idle',
            currentTaskId: null,
            speechBubble: null,
          });
        }
      }
    }
  }

  getOccupiedInZone(zone: ZoneId, excludeAgentId?: string): Array<{ x: number; y: number }> {
    return this.agents
      .filter((a) => a.id !== excludeAgentId && (a.currentZone === zone || a.targetZone === zone))
      .map((a) => a.targetPosition || a.position);
  }

  getSnapshot(sinceSeq?: number): WorkspaceSnapshot {
    const now = Date.now();
    this.beams = this.beams.filter((b) => b.expiresAt > now);
    for (const agent of this.agents) {
      if (agent.speechBubble && agent.speechBubble.expiresAt <= now) {
        agent.speechBubble = null;
      }
    }
    const minSeq = typeof sinceSeq === 'number' && Number.isFinite(sinceSeq) ? sinceSeq : 0;
    return {
      agents: this.agents,
      missions: this.missions,
      tasks: minSeq > 0 ? this.tasks.filter((t) => (t.seq || 0) > minSeq) : this.tasks,
      comms: minSeq > 0 ? this.comms.filter((c) => (c.seq || 0) > minSeq) : this.comms,
      beams: this.beams,
      settings: this.getPublicSettings(),
      cursor: this.cursor,
    };
  }

  pushBotOutboxEvent(agentId: string, event: string, payload: Record<string, unknown>): BridgeQueuedEvent {
    const entry: BridgeQueuedEvent = {
      seq: this.nextCursor(),
      event,
      payload,
      timestamp: new Date().toISOString(),
    };
    const queue = this.botOutbox.get(agentId) || [];
    queue.push(entry);
    if (queue.length > 200) {
      this.botOutbox.set(agentId, queue.slice(-150));
    } else {
      this.botOutbox.set(agentId, queue);
    }
    return entry;
  }

  getBotOutboxEvents(agentId: string, sinceSeq = 0): BridgeQueuedEvent[] {
    const queue = this.botOutbox.get(agentId) || [];
    return queue.filter((e) => e.seq > sinceSeq);
  }

  hasBridgeEventId(agentId: string, eventId: string): boolean {
    if (!eventId) return false;
    const list = this.processedBridgeEventIds.get(agentId);
    return Boolean(list && list.includes(eventId));
  }

  recordBridgeEventId(agentId: string, eventId: string): boolean {
    if (!eventId) return true;
    const list = this.processedBridgeEventIds.get(agentId) || [];
    if (list.includes(eventId)) return false;
    list.push(eventId);
    if (list.length > 300) {
      list.shift();
    }
    this.processedBridgeEventIds.set(agentId, list);
    return true;
  }

  getAgents(): Agent[] {
    return this.agents;
  }

  getAgent(id: string): Agent | undefined {
    return this.agents.find((a) => a.id === id);
  }

  upsertAgent(agent: Agent): Agent {
    const idx = this.agents.findIndex((a) => a.id === agent.id);
    if (idx >= 0) {
      this.agents[idx] = agent;
    } else {
      this.agents.push(agent);
    }
    this.schedulePersist();
    this.emit('agent:updated', agent);
    return agent;
  }

  updateAgent(id: string, patch: Partial<Agent>): Agent | undefined {
    const agent = this.getAgent(id);
    if (!agent) return undefined;
    Object.assign(agent, patch, { lastSeenAt: new Date().toISOString() });
    this.schedulePersist();
    this.emit('agent:updated', agent);
    return agent;
  }

  removeAgent(id: string): boolean {
    const idx = this.agents.findIndex((a) => a.id === id);
    if (idx < 0) return false;
    this.agents.splice(idx, 1);
    this.botOutbox.delete(id);
    this.processedBridgeEventIds.delete(id);
    this.schedulePersist();
    this.emit('agent:removed', { id });
    return true;
  }

  moveAgentToZone(agentId: string, zone: ZoneId, spotSeed = 0, nextStatus?: AgentStatus): Agent | undefined {
    const agent = this.getAgent(agentId);
    if (!agent) return undefined;

    const destination = pickSpotInZone(zone, spotSeed, this.getOccupiedInZone(zone, agentId));
    const sameSpot =
      agent.currentZone === zone &&
      agent.position.x === destination.x &&
      agent.position.y === destination.y;

    if (sameSpot) {
      if (nextStatus) agent.status = nextStatus;
      agent.lastSeenAt = new Date().toISOString();
      this.emit('agent:updated', agent);
      return agent;
    }

    agent.targetZone = zone;
    agent.targetPosition = destination;
    agent.status = 'walking';
    agent.lastSeenAt = new Date().toISOString();
    this.emit('agent:updated', agent);

    if (IS_SERVERLESS) {
      agent.currentZone = zone;
      agent.position = { ...destination };
      agent.status = nextStatus ?? 'idle';
      agent.lastSeenAt = new Date().toISOString();
      this.emit('agent:updated', agent);
      return agent;
    }

    setTimeout(() => {
      const current = this.getAgent(agentId);
      if (!current) return;
      current.currentZone = zone;
      current.position = { ...destination };
      if (current.status === 'walking') {
        current.status = nextStatus ?? 'idle';
      }
      current.lastSeenAt = new Date().toISOString();
      this.schedulePersist();
      this.emit('agent:updated', current);
    }, 1100);

    return agent;
  }

  setSpeechBubble(
    agentId: string,
    text: string,
    kind: SpeechBubble['kind'] = 'chat',
    durationMs = 5500
  ): void {
    const agent = this.getAgent(agentId);
    if (!agent) return;
    const clipped = text.length > 92 ? `${text.slice(0, 89)}...` : text;
    agent.speechBubble = {
      text: clipped,
      kind,
      expiresAt: Date.now() + durationMs,
    };
    this.emit('agent:updated', agent);
  }

  emitBeam(fromAgentId: string, toAgentId: string, label: string, color = '#fbbf24'): void {
    const beam: CommandBeam = {
      id: `beam-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      fromAgentId,
      toAgentId,
      label: label.length > 34 ? `${label.slice(0, 31)}...` : label,
      color,
      createdAt: Date.now(),
      expiresAt: Date.now() + 3600,
    };
    this.beams.push(beam);
    this.emit('beam:created', beam);
  }

  addMission(mission: Mission): Mission {
    this.missions.push(mission);
    this.schedulePersist();
    this.emit('mission:updated', mission);
    return mission;
  }

  updateMission(id: string, patch: Partial<Mission>): Mission | undefined {
    const mission = this.missions.find((m) => m.id === id);
    if (!mission) return undefined;
    Object.assign(mission, patch);
    if (patch.status === 'completed' || patch.status === 'failed') {
      this.flushPersist();
    } else {
      this.schedulePersist();
    }
    this.emit('mission:updated', mission);
    return mission;
  }

  getMission(id: string): Mission | undefined {
    return this.missions.find((m) => m.id === id);
  }

  addTask(task: Task): Task {
    const withSeq: Task = { ...task, seq: this.nextCursor() };
    this.tasks.push(withSeq);
    this.schedulePersist();
    this.emit('task:updated', withSeq);
    return withSeq;
  }

  updateTask(id: string, patch: Partial<Task>): Task | undefined {
    const task = this.tasks.find((t) => t.id === id);
    if (!task) return undefined;
    Object.assign(task, patch, {
      seq: this.nextCursor(),
      updatedAt: new Date().toISOString(),
    });
    this.schedulePersist();
    this.emit('task:updated', task);
    return task;
  }

  getTask(id: string): Task | undefined {
    return this.tasks.find((t) => t.id === id);
  }

  getTasksByMission(missionId: string): Task[] {
    return this.tasks.filter((t) => t.missionId === missionId);
  }

  addComms(entry: Omit<CommsMessage, 'id' | 'timestamp' | 'seq'>): CommsMessage {
    const msg: CommsMessage = {
      ...entry,
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      seq: this.nextCursor(),
      timestamp: new Date().toISOString(),
    };
    this.comms.push(msg);
    if (this.comms.length > 250) {
      this.comms = this.comms.slice(-200);
    }
    this.schedulePersist();
    this.emit('comms:message', msg);
    return msg;
  }

  clearHistory(): void {
    this.missions = [];
    this.tasks = [];
    this.beams = [];
    this.comms = [
      {
        id: `msg-${Date.now()}`,
        seq: this.nextCursor(),
        fromId: 'system',
        fromName: 'MuseHQ System',
        toId: 'all',
        toName: 'All Muse Bots',
        kind: 'system',
        content: 'Riwayat misi dan log komunikasi dibersihkan.',
        timestamp: new Date().toISOString(),
      },
    ];
    for (const agent of this.agents) {
      agent.currentTaskId = null;
      agent.speechBubble = null;
      if (agent.status !== 'offline') {
        agent.status = agent.type === 'external-rest' ? 'online' : 'idle';
      }
    }
    this.schedulePersist();
    this.emit('snapshot', this.getSnapshot());
  }

  resetWorkspace(): WorkspaceSnapshot {
    this.missions = [];
    this.tasks = [];
    this.beams = [];
    this.botOutbox.clear();
    this.processedBridgeEventIds.clear();
    this.agents = [];
    this.comms = createInitialComms();
    this.cursor = 1;
    this.schedulePersist();
    const snap = this.getSnapshot();
    this.emit('snapshot', snap);
    return snap;
  }
}
