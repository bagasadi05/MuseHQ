import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pickSpotInZone } from './officeMap.js';
import {
  Agent,
  AgentStatus,
  CommandBeam,
  CommsMessage,
  Mission,
  PublicSettings,
  RuntimeSettings,
  SpeechBubble,
  Task,
  WorkspaceSnapshot,
  ZoneId,
} from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

export type BroadcastFn = (event: string, payload: unknown) => void;

interface PersistedState {
  agents: Agent[];
  missions: Mission[];
  tasks: Task[];
  comms: CommsMessage[];
}

function createDefaultAgents(defaultProvider: RuntimeSettings['defaultProvider']): Agent[] {
  const now = new Date().toISOString();
  const baseConfigs: Array<{
    id: string;
    name: string;
    role: string;
    description: string;
    systemPrompt: string;
    canDelegate: boolean;
    homeZone: ZoneId;
    color: string;
    avatarVariant: Agent['avatarVariant'];
  }> = [
    {
      id: 'muse-lead',
      name: 'Muse Lead',
      role: 'Orchestrator & Commander',
      description:
        'Memecah perintah user menjadi sub-tugas terstruktur, mendelegasikan ke bot spesialis, lalu merangkum hasil akhir.',
      systemPrompt:
        'Kamu adalah Muse Lead, koordinator utama tim bot Muse AI. Pecah tugas kompleks secara cerdas, delegasikan pekerjaan ke anggota tim yang paling relevan, dan rangkum laporan akhir dengan jelas.',
      canDelegate: true,
      homeZone: 'command-desk',
      color: '#f59e0b',
      avatarVariant: 'lead',
    },
    {
      id: 'muse-scout',
      name: 'Muse Scout',
      role: 'Research & Strategy Analyst',
      description:
        'Mengumpulkan insight, riset kompetitor, kebutuhan user, dan menyusun landasan data untuk tim.',
      systemPrompt:
        'Kamu adalah Muse Scout, spesialis riset dan analisis strategi. Berikan temuan terstruktur, poin utama, risiko, dan rekomendasi berbasis konteks misi.',
      canDelegate: false,
      homeZone: 'research-nook',
      color: '#06b6d4',
      avatarVariant: 'researcher',
    },
    {
      id: 'muse-dev',
      name: 'Muse Dev',
      role: 'Systems & Code Engineer',
      description:
        'Merancang arsitektur teknis, API, struktur data, dan implementasi kode atau otomasi.',
      systemPrompt:
        'Kamu adalah Muse Dev, software & AI systems engineer. Buat rancangan teknis yang konkret, bersih, dan siap dieksekusi lengkap dengan struktur komponen atau potongan kode.',
      canDelegate: false,
      homeZone: 'dev-bay',
      color: '#10b981',
      avatarVariant: 'coder',
    },
    {
      id: 'muse-craft',
      name: 'Muse Craft',
      role: 'Content, UX & Copy Designer',
      description:
        'Menulis copywriting, alur UX, narasi produk, serta materi komunikasi yang memikat.',
      systemPrompt:
        'Kamu adalah Muse Craft, spesialis UX writing, storytelling, dan desain pengalaman. Ubah temuan teknis dan riset menjadi konsep produk atau copy yang jelas dan menarik.',
      canDelegate: false,
      homeZone: 'creative-studio',
      color: '#ec4899',
      avatarVariant: 'creative',
    },
    {
      id: 'muse-sentinel',
      name: 'Muse Sentinel',
      role: 'QA Reviewer & Validator',
      description:
        'Mengaudit kualitas output tim lain, mencari celah logika, dan memastikan deliverable siap dipakai.',
      systemPrompt:
        'Kamu adalah Muse Sentinel, QA reviewer yang teliti. Periksa hasil pekerjaan bot lain, identifikasi kekurangan atau edge-case, dan berikan checklist perbaikan.',
      canDelegate: false,
      homeZone: 'qa-bench',
      color: '#3b82f6',
      avatarVariant: 'qa',
    },
  ];

  return baseConfigs.map((cfg, idx) => {
    const pos = pickSpotInZone(cfg.homeZone, idx);
    return {
      ...cfg,
      type: 'builtin',
      provider: defaultProvider,
      model: '',
      bridgeConnected: true,
      currentZone: cfg.homeZone,
      targetZone: cfg.homeZone,
      position: pos,
      targetPosition: { ...pos },
      status: 'idle',
      currentTaskId: null,
      speechBubble: null,
      lastSeenAt: now,
    };
  });
}

function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '••••••••';
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

export class WorkspaceStore {
  private agents: Agent[] = [];
  private missions: Mission[] = [];
  private tasks: Task[] = [];
  private comms: CommsMessage[] = [];
  private beams: CommandBeam[] = [];
  private settings: RuntimeSettings;
  private broadcaster: BroadcastFn = () => {};
  private persistTimer: NodeJS.Timeout | null = null;

  constructor() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    this.settings = this.loadSettings();
    this.loadState();
  }

  setBroadcaster(fn: BroadcastFn): void {
    this.broadcaster = fn;
  }

  private loadSettings(): RuntimeSettings {
    const envProvider = (process.env.DEFAULT_PROVIDER || 'demo') as RuntimeSettings['defaultProvider'];
    const base: RuntimeSettings = {
      defaultProvider: ['demo', 'gemini', 'openai', 'anthropic'].includes(envProvider)
        ? envProvider
        : 'demo',
      geminiApiKey: process.env.GEMINI_API_KEY || '',
      openaiApiKey: process.env.OPENAI_API_KEY || '',
      anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
      geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5',
      bridgeToken: process.env.BOT_BRIDGE_TOKEN || 'muse-bridge-secret-dev',
    };

    if (fs.existsSync(SETTINGS_FILE)) {
      try {
        const saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) as Partial<RuntimeSettings>;
        return {
          ...base,
          ...saved,
          geminiApiKey: saved.geminiApiKey || base.geminiApiKey,
          openaiApiKey: saved.openaiApiKey || base.openaiApiKey,
          anthropicApiKey: saved.anthropicApiKey || base.anthropicApiKey,
          bridgeToken: saved.bridgeToken || base.bridgeToken,
        };
      } catch {
        return base;
      }
    }
    return base;
  }

  private loadState(): void {
    if (fs.existsSync(STATE_FILE)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as Partial<PersistedState>;
        this.agents = (parsed.agents && parsed.agents.length > 0
          ? parsed.agents
          : createDefaultAgents(this.settings.defaultProvider)
        ).map((agent, idx) => {
          const isExternalWs = agent.type === 'external-ws';
          const fallbackPos = pickSpotInZone(agent.homeZone, idx);
          return {
            ...agent,
            bridgeConnected: isExternalWs ? false : agent.type === 'builtin' || Boolean(agent.webhookUrl),
            status: isExternalWs ? 'offline' : 'idle',
            currentTaskId: null,
            speechBubble: null,
            currentZone: agent.homeZone,
            targetZone: agent.homeZone,
            position: agent.position ?? fallbackPos,
            targetPosition: agent.position ?? fallbackPos,
          };
        });
        this.missions = (parsed.missions || []).map((m) =>
          m.status === 'running' ? { ...m, status: 'failed' as const } : m
        );
        this.tasks = (parsed.tasks || []).map((t) =>
          t.status === 'working' || t.status === 'delegated' || t.status === 'queued'
            ? { ...t, status: 'failed' as const, error: t.error || 'Server restarted before completion' }
            : t
        );
        this.comms = (parsed.comms || []).slice(-200);
        return;
      } catch {
        // Fall through to clean defaults on corrupt JSON
      }
    }

    this.agents = createDefaultAgents(this.settings.defaultProvider);
    this.comms = [
      {
        id: `msg-${Date.now()}`,
        fromId: 'system',
        fromName: 'MuseHQ System',
        toId: 'all',
        toName: 'All Muse Bots',
        kind: 'system',
        content:
          'Ruangan kerja MuseHQ aktif. Kirim misi di Command Bar atau sambungkan bot eksternal via External Bridge.',
        timestamp: new Date().toISOString(),
      },
    ];
    this.schedulePersist();
  }

  private schedulePersist(): void {
    if (this.persistTimer) clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      try {
        const payload: PersistedState = {
          agents: this.agents,
          missions: this.missions.slice(-50),
          tasks: this.tasks.slice(-250),
          comms: this.comms.slice(-200),
        };
        fs.writeFileSync(STATE_FILE, JSON.stringify(payload, null, 2), 'utf8');
      } catch (err) {
        console.error('Failed to persist workspace state:', err);
      }
    }, 200);
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
      bridgeToken: this.settings.bridgeToken,
    };
  }

  updateSettings(patch: Partial<RuntimeSettings>): PublicSettings {
    const cleanPatch: Partial<RuntimeSettings> = {};
    if (patch.defaultProvider) cleanPatch.defaultProvider = patch.defaultProvider;
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
      cleanPatch.bridgeToken = patch.bridgeToken.trim();
    }

    this.settings = { ...this.settings, ...cleanPatch };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(this.settings, null, 2), 'utf8');

    const publicSettings = this.getPublicSettings();
    this.broadcaster('settings:updated', publicSettings);
    return publicSettings;
  }

  getSnapshot(): WorkspaceSnapshot {
    const now = Date.now();
    this.beams = this.beams.filter((b) => b.expiresAt > now);
    for (const agent of this.agents) {
      if (agent.speechBubble && agent.speechBubble.expiresAt <= now) {
        agent.speechBubble = null;
      }
    }
    return {
      agents: this.agents,
      missions: this.missions,
      tasks: this.tasks,
      comms: this.comms,
      beams: this.beams,
      settings: this.getPublicSettings(),
    };
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
    this.broadcaster('agent:updated', agent);
    return agent;
  }

  updateAgent(id: string, patch: Partial<Agent>): Agent | undefined {
    const agent = this.getAgent(id);
    if (!agent) return undefined;
    Object.assign(agent, patch, { lastSeenAt: new Date().toISOString() });
    this.schedulePersist();
    this.broadcaster('agent:updated', agent);
    return agent;
  }

  removeAgent(id: string): boolean {
    const idx = this.agents.findIndex((a) => a.id === id);
    if (idx < 0) return false;
    this.agents.splice(idx, 1);
    this.schedulePersist();
    this.broadcaster('agent:removed', { id });
    return true;
  }

  moveAgentToZone(agentId: string, zone: ZoneId, spotSeed = 0, nextStatus?: AgentStatus): Agent | undefined {
    const agent = this.getAgent(agentId);
    if (!agent) return undefined;

    const destination = pickSpotInZone(zone, spotSeed);
    const sameSpot =
      agent.currentZone === zone &&
      agent.position.x === destination.x &&
      agent.position.y === destination.y;

    if (sameSpot) {
      if (nextStatus) agent.status = nextStatus;
      agent.lastSeenAt = new Date().toISOString();
      this.broadcaster('agent:updated', agent);
      return agent;
    }

    agent.targetZone = zone;
    agent.targetPosition = destination;
    agent.status = 'walking';
    agent.lastSeenAt = new Date().toISOString();
    this.broadcaster('agent:updated', agent);

    // Deterministic travel time so server state converges with smooth client A* walk
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
      this.broadcaster('agent:updated', current);
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
    this.broadcaster('agent:updated', agent);
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
    this.broadcaster('beam:created', beam);
  }

  addMission(mission: Mission): Mission {
    this.missions.push(mission);
    this.schedulePersist();
    this.broadcaster('mission:updated', mission);
    return mission;
  }

  updateMission(id: string, patch: Partial<Mission>): Mission | undefined {
    const mission = this.missions.find((m) => m.id === id);
    if (!mission) return undefined;
    Object.assign(mission, patch);
    this.schedulePersist();
    this.broadcaster('mission:updated', mission);
    return mission;
  }

  getMission(id: string): Mission | undefined {
    return this.missions.find((m) => m.id === id);
  }

  addTask(task: Task): Task {
    this.tasks.push(task);
    this.schedulePersist();
    this.broadcaster('task:updated', task);
    return task;
  }

  updateTask(id: string, patch: Partial<Task>): Task | undefined {
    const task = this.tasks.find((t) => t.id === id);
    if (!task) return undefined;
    Object.assign(task, patch, { updatedAt: new Date().toISOString() });
    this.schedulePersist();
    this.broadcaster('task:updated', task);
    return task;
  }

  getTask(id: string): Task | undefined {
    return this.tasks.find((t) => t.id === id);
  }

  getTasksByMission(missionId: string): Task[] {
    return this.tasks.filter((t) => t.missionId === missionId);
  }

  addComms(entry: Omit<CommsMessage, 'id' | 'timestamp'>): CommsMessage {
    const msg: CommsMessage = {
      ...entry,
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
    };
    this.comms.push(msg);
    if (this.comms.length > 250) {
      this.comms = this.comms.slice(-200);
    }
    this.schedulePersist();
    this.broadcaster('comms:message', msg);
    return msg;
  }

  clearHistory(): void {
    this.missions = [];
    this.tasks = [];
    this.beams = [];
    this.comms = [
      {
        id: `msg-${Date.now()}`,
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
      if (agent.status !== 'offline') agent.status = 'idle';
    }
    this.schedulePersist();
    this.broadcaster('snapshot', this.getSnapshot());
  }
}
