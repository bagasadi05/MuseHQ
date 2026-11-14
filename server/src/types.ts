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
  | 'meeting'
  | 'offline'
  | 'error';

export type AgentType = 'builtin' | 'external-ws' | 'external-rest' | 'external-webhook';

export type LLMProvider = 'demo' | 'gemini' | 'openai' | 'anthropic';

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

export interface BridgeQueuedEvent {
  seq: number;
  event: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface RuntimeSettings {
  defaultProvider: LLMProvider;
  geminiApiKey: string;
  openaiApiKey: string;
  anthropicApiKey: string;
  geminiModel: string;
  openaiModel: string;
  anthropicModel: string;
  bridgeToken: string;
  ownerPasscode: string;
  sessionSecret: string;
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
  cursor: number;
}
