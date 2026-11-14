import { Agent, BrainMode } from '../types';

export interface BrainBadgeMeta {
  mode?: BrainMode;
  label: string;
  compactLabel: string;
  cls: string;
  canvasBg: string;
  canvasText: string;
  isFallback: boolean;
}

const BRAIN_BADGE_MAP: Record<BrainMode, BrainBadgeMeta> = {
  fallback: {
    mode: 'fallback',
    label: 'Tanpa otak — tidak bisa kerja',
    compactLabel: 'Tanpa otak — tidak bisa kerja',
    cls: 'border-rose-500/60 bg-rose-500/20 text-rose-200',
    canvasBg: 'rgba(225, 29, 72, 0.92)',
    canvasText: '#fff1f2',
    isFallback: true,
  },
  'muse-langsung': {
    mode: 'muse-langsung',
    label: 'Muse Langsung',
    compactLabel: 'Muse Langsung',
    cls: 'border-cyan-500/50 bg-cyan-500/15 text-cyan-200',
    canvasBg: 'rgba(8, 145, 178, 0.88)',
    canvasText: '#ecfeff',
    isFallback: false,
  },
  upstream: {
    mode: 'upstream',
    label: 'Upstream',
    compactLabel: 'Upstream',
    cls: 'border-violet-500/50 bg-violet-500/15 text-violet-200',
    canvasBg: 'rgba(124, 58, 237, 0.88)',
    canvasText: '#f5f3ff',
    isFallback: false,
  },
  gemini: {
    mode: 'gemini',
    label: 'Gemini',
    compactLabel: 'Gemini',
    cls: 'border-sky-500/50 bg-sky-500/15 text-sky-200',
    canvasBg: 'rgba(2, 132, 199, 0.88)',
    canvasText: '#f0f9ff',
    isFallback: false,
  },
  openai: {
    mode: 'openai',
    label: 'OpenAI',
    compactLabel: 'OpenAI',
    cls: 'border-emerald-500/50 bg-emerald-500/15 text-emerald-200',
    canvasBg: 'rgba(5, 150, 105, 0.88)',
    canvasText: '#ecfdf5',
    isFallback: false,
  },
  anthropic: {
    mode: 'anthropic',
    label: 'Anthropic',
    compactLabel: 'Anthropic',
    cls: 'border-amber-500/50 bg-amber-500/15 text-amber-200',
    canvasBg: 'rgba(217, 119, 6, 0.88)',
    canvasText: '#fffbeb',
    isFallback: false,
  },
};

const UNKNOWN_BRAIN_BADGE: BrainBadgeMeta = {
  label: 'Otak belum dilaporkan',
  compactLabel: 'Belum dilaporkan',
  cls: 'border-slate-700 bg-slate-800/80 text-slate-400',
  canvasBg: 'rgba(51, 65, 85, 0.85)',
  canvasText: '#cbd5e1',
  isFallback: false,
};

/** Resolves normalized UI badge styling and label for an agent's execution engine (`brainMode`). */
export function getAgentBrainBadge(agent: Pick<Agent, 'brainMode' | 'type' | 'provider'>): BrainBadgeMeta {
  const effective = agent.brainMode || (agent.type === 'builtin' ? agent.provider : undefined);
  if (effective && effective in BRAIN_BADGE_MAP) {
    return BRAIN_BADGE_MAP[effective as BrainMode];
  }
  return UNKNOWN_BRAIN_BADGE;
}
