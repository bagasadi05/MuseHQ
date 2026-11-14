export type ZoneId =
  | 'command-desk'
  | 'research-library'
  | 'engineering-bay'
  | 'war-room'
  | 'creative-studio'
  | 'qa-bench'
  | 'coffee-lounge';

export type AgentStatus =
  | 'online'
  | 'idle'
  | 'walking'
  | 'thinking'
  | 'working'
  | 'talking'
  | 'meeting'
  | 'offline'
  | 'error';

export type AgentType = 'builtin' | 'external-ws' | 'external-rest' | 'external-webhook';

export type LLMProvider = 'gemini' | 'openai' | 'anthropic';

export type AvatarVariant =
  | 'lead'
  | 'coder'
  | 'researcher'
  | 'creative'
  | 'qa'
  | 'external';

export interface GridPoint {
  x: number;
  y: number;
}

export interface SpeechBubble {
  text: string;
  kind: 'chat' | 'command' | 'report' | 'error';
  expiresAt: number;
}

export interface Agent {
  id: string;
  name: string;
  role: string;
  description: string;
  systemPrompt: string;
  type: AgentType;
  provider: LLMProvider;
  model: string;
  webhookUrl?: string;
  bridgeConnected: boolean;
  canDelegate: boolean;
  homeZone: ZoneId;
  currentZone: ZoneId;
  targetZone: ZoneId;
  position: GridPoint;
  targetPosition: GridPoint;
  color: string;
  avatarVariant: AvatarVariant;
  status: AgentStatus;
  currentTaskId: string | null;
  speechBubble: SpeechBubble | null;
  lastSeenAt: string;
}

export type TaskStatus =
  | 'queued'
  | 'waiting-dependency'
  | 'assigned'
  | 'delegated'
  | 'working'
  | 'in-progress'
  | 'completed'
  | 'failed';

export interface Task {
  id: string;
  seq?: number;
  missionId: string;
  parentTaskId: string | null;
  title: string;
  instructions: string;
  assignedToId: string;
  assignedById: string;
  dependsOnTaskIds: string[];
  status: TaskStatus;
  result?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface Mission {
  id: string;
  prompt: string;
  targetAgentId: string;
  status: 'running' | 'completed' | 'failed';
  finalSummary?: string;
  createdAt: string;
  completedAt?: string;
}

export interface CommsMessage {
  id: string;
  seq?: number;
  missionId?: string;
  fromId: string;
  fromName: string;
  toId: string;
  toName: string;
  kind:
    | 'command'
    | 'delegation'
    | 'chat'
    | 'progress'
    | 'deliverable'
    | 'system'
    | 'error';
  content: string;
  timestamp: string;
}

export interface CommandBeam {
  id: string;
  fromAgentId: string;
  toAgentId: string;
  label: string;
  color: string;
  createdAt: number;
  expiresAt: number;
}

export interface PublicSettings {
  defaultProvider: LLMProvider;
  hasGeminiKey: boolean;
  hasOpenaiKey: boolean;
  hasAnthropicKey: boolean;
  geminiKeyPreview: string;
  openaiKeyPreview: string;
  anthropicKeyPreview: string;
  geminiModel: string;
  openaiModel: string;
  anthropicModel: string;
  hasBridgeToken: boolean;
  bridgeTokenPreview: string;
  authConfigured: boolean;
}

export interface WorkspaceSnapshot {
  agents: Agent[];
  missions: Mission[];
  tasks: Task[];
  comms: CommsMessage[];
  beams: CommandBeam[];
  settings: PublicSettings;
  cursor?: number;
}

export interface ZoneMeta {
  id: ZoneId;
  label: string;
  shortLabel: string;
  accent: string;
  floorTint: string;
  bounds: { x: number; y: number; w: number; h: number };
}

export const ZONES_META: ZoneMeta[] = [
  {
    id: 'command-desk',
    label: 'Command Desk',
    shortLabel: 'CMD',
    accent: '#f59e0b',
    floorTint: 'rgba(245, 158, 11, 0.14)',
    bounds: { x: 1, y: 1, w: 5, h: 4 },
  },
  {
    id: 'research-library',
    label: 'Research Library',
    shortLabel: 'RSC',
    accent: '#06b6d4',
    floorTint: 'rgba(6, 182, 212, 0.12)',
    bounds: { x: 7, y: 1, w: 6, h: 4 },
  },
  {
    id: 'engineering-bay',
    label: 'Engineering Bay',
    shortLabel: 'ENG',
    accent: '#10b981',
    floorTint: 'rgba(16, 185, 129, 0.12)',
    bounds: { x: 14, y: 1, w: 5, h: 5 },
  },
  {
    id: 'war-room',
    label: 'War Room',
    shortLabel: 'WAR',
    accent: '#8b5cf6',
    floorTint: 'rgba(139, 92, 246, 0.14)',
    bounds: { x: 7, y: 5, w: 6, h: 4 },
  },
  {
    id: 'creative-studio',
    label: 'Creative Studio',
    shortLabel: 'CRT',
    accent: '#ec4899',
    floorTint: 'rgba(236, 72, 153, 0.12)',
    bounds: { x: 1, y: 6, w: 5, h: 5 },
  },
  {
    id: 'qa-bench',
    label: 'QA & Bridge Lab',
    shortLabel: 'QA',
    accent: '#3b82f6',
    floorTint: 'rgba(59, 130, 246, 0.12)',
    bounds: { x: 14, y: 7, w: 5, h: 4 },
  },
  {
    id: 'coffee-lounge',
    label: 'Coffee Lounge',
    shortLabel: 'COF',
    accent: '#f97316',
    floorTint: 'rgba(249, 115, 22, 0.13)',
    bounds: { x: 7, y: 10, w: 6, h: 3 },
  },
];

const LEGACY_ZONE_MAP: Record<string, ZoneId> = {
  'research-nook': 'research-library',
  'dev-bay': 'engineering-bay',
  'meeting-table': 'war-room',
  lounge: 'coffee-lounge',
};

export function normalizeZoneId(raw: unknown): ZoneId {
  if (typeof raw === 'string') {
    if (ZONES_META.some((z) => z.id === raw)) return raw as ZoneId;
    if (raw in LEGACY_ZONE_MAP) return LEGACY_ZONE_MAP[raw];
  }
  return 'engineering-bay';
}
