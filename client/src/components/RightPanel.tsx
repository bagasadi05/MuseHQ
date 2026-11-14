import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Ban,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  FileText,
  GitBranch,
  ListChecks,
  MessageSquare,
  RefreshCw,
  RotateCcw,
  Send,
  Settings2,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  Agent,
  CommsMessage,
  LLMProvider,
  Mission,
  Task,
  ZONES_META,
  ZoneId,
} from '../types';
import { getAgentBrainBadge } from '../utils/brainBadge';
import { cleanDisplayText, stripUniqueSymbols } from '../utils/textClean';
import { MarkdownView } from './MarkdownView';

interface RightPanelProps {
  agents: Agent[];
  missions: Mission[];
  tasks: Task[];
  comms: CommsMessage[];
  selectedAgentId: string | null;
  onSelectAgent: (id: string | null) => void;
  onUpdateAgent: (id: string, patch: Partial<Agent>) => Promise<void>;
  onDeleteAgent: (id: string) => Promise<void>;
  onMoveAgent: (id: string, zone: ZoneId) => Promise<void>;
  onSendBotCommand: (
    fromId: string,
    toId: string,
    content: string,
    createTask: boolean,
    title?: string
  ) => Promise<void>;
  onCancelTask: (taskId: string) => Promise<void>;
  onMarkTaskFailed: (taskId: string, reason?: string) => Promise<void>;
  onReassignTask: (taskId: string, targetAgentId?: string) => Promise<void>;
  onOpenReport: (mission: Mission) => void;
  onClearHistory: () => Promise<void>;
  onResetWorkspace: () => Promise<void>;
}

type TabId = 'comms' | 'tasks' | 'deliverables' | 'inspector';
type CommsFilterId = 'all' | 'chat-command' | 'system-delegation';
type TaskFilterId = 'all' | 'active' | 'done';

const STATUS_BADGES: Record<string, { label: string; cls: string }> = {
  queued: { label: 'Antre', cls: 'bg-slate-700/70 text-slate-300' },
  'waiting-dependency': {
    label: 'Tunggu Dependensi',
    cls: 'bg-violet-500/20 text-violet-300',
  },
  assigned: { label: 'Ditugaskan', cls: 'bg-sky-500/20 text-sky-300' },
  delegated: { label: 'Menunggu Bot Luar', cls: 'bg-purple-500/20 text-purple-300' },
  working: { label: 'Dikerjakan', cls: 'bg-amber-500/20 text-amber-300' },
  'in-progress': { label: 'Dikerjakan', cls: 'bg-amber-500/20 text-amber-300' },
  stuck: {
    label: 'Macet (Stuck)',
    cls: 'bg-orange-500/20 text-orange-300 border border-orange-500/40',
  },
  completed: { label: 'Selesai', cls: 'bg-emerald-500/20 text-emerald-300' },
  failed: { label: 'Gagal', cls: 'bg-rose-500/20 text-rose-300' },
};

const MISSION_STATUS_META: Record<Mission['status'], { label: string; cls: string }> = {
  running: { label: 'Berjalan', cls: 'bg-amber-500/20 text-amber-300' },
  completed: { label: 'Selesai', cls: 'bg-emerald-500/20 text-emerald-300' },
  failed: { label: 'Gagal', cls: 'bg-rose-500/20 text-rose-300' },
};

interface CommsCategoryMeta {
  label: string;
  cardCls: string;
  pillCls: string;
  group: Exclude<CommsFilterId, 'all'>;
}

const COMMS_CATEGORY_META: Record<CommsMessage['kind'], CommsCategoryMeta> = {
  command: {
    label: 'Perintah',
    cardCls: 'border-amber-500/35 bg-amber-500/[0.07]',
    pillCls: 'border-amber-500/40 bg-amber-500/15 text-amber-200',
    group: 'chat-command',
  },
  chat: {
    label: 'Obrolan',
    cardCls: 'border-sky-500/30 bg-sky-500/[0.06]',
    pillCls: 'border-sky-500/35 bg-sky-500/15 text-sky-200',
    group: 'chat-command',
  },
  deliverable: {
    label: 'Laporan',
    cardCls: 'border-emerald-500/35 bg-emerald-500/[0.07]',
    pillCls: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200',
    group: 'chat-command',
  },
  delegation: {
    label: 'Delegasi',
    cardCls: 'border-violet-500/35 bg-violet-500/[0.07]',
    pillCls: 'border-violet-500/40 bg-violet-500/15 text-violet-200',
    group: 'system-delegation',
  },
  error: {
    label: 'Peringatan',
    cardCls: 'border-rose-500/40 bg-rose-500/[0.08]',
    pillCls: 'border-rose-500/40 bg-rose-500/15 text-rose-200',
    group: 'system-delegation',
  },
  progress: {
    label: 'Info',
    cardCls: 'border-slate-800 bg-slate-950/65',
    pillCls: 'border-slate-700 bg-slate-800/80 text-slate-300',
    group: 'system-delegation',
  },
  system: {
    label: 'Info',
    cardCls: 'border-slate-800 bg-slate-950/65',
    pillCls: 'border-slate-700 bg-slate-800/80 text-slate-300',
    group: 'system-delegation',
  },
};

const CANCELLABLE_STATUSES = new Set([
  'queued',
  'waiting-dependency',
  'assigned',
  'delegated',
  'working',
  'in-progress',
  'stuck',
]);

function cleanOneLine(text: string | undefined, fallback = ''): string {
  if (!text) return fallback;
  const cleaned = cleanDisplayText(text, { stripMarkdown: true, singleLine: true });
  return cleaned || fallback;
}

function formatTimeHMS(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--:--';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function isTerminalTaskStatus(status: Task['status']): boolean {
  return status === 'completed' || status === 'failed';
}

interface FilterOption<T extends string> {
  id: T;
  label: string;
  count: number;
}

function FilterPillBar<T extends string>({
  ariaLabel,
  options,
  value,
  onChange,
}: {
  ariaLabel: string;
  options: FilterOption<T>[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={ariaLabel}>
      {options.map((opt) => {
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            aria-pressed={active}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition cursor-pointer ${
              active
                ? 'border-amber-400/60 bg-amber-500/15 text-amber-200'
                : 'border-slate-800 bg-slate-950/70 text-slate-400 hover:border-slate-700 hover:text-slate-200'
            }`}
          >
            <span>{opt.label}</span>
            <span
              className={`font-mono text-[10px] ${
                active ? 'text-amber-300/90' : 'text-slate-500'
              }`}
            >
              {opt.count}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export const RightPanel: React.FC<RightPanelProps> = ({
  agents,
  missions,
  tasks,
  comms,
  selectedAgentId,
  onSelectAgent,
  onUpdateAgent,
  onDeleteAgent,
  onMoveAgent,
  onSendBotCommand,
  onCancelTask,
  onMarkTaskFailed,
  onReassignTask,
  onOpenReport,
  onClearHistory,
  onResetWorkspace,
}) => {
  const [tab, setTab] = useState<TabId>('comms');
  const [commsFilter, setCommsFilter] = useState<CommsFilterId>('all');
  const [taskFilter, setTaskFilter] = useState<TaskFilterId>('all');
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [reassignTargets, setReassignTargets] = useState<Record<string, string>>({});
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [copiedDeliverableId, setCopiedDeliverableId] = useState<string | null>(null);

  // Bot-to-bot manual relay state
  const [relayFrom, setRelayFrom] = useState('');
  const [relayTo, setRelayTo] = useState('');
  const [relayText, setRelayText] = useState('');
  const [relayAsTask, setRelayAsTask] = useState(true);
  const [relaySending, setRelaySending] = useState(false);

  const commsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selectedAgentId) setTab('inspector');
  }, [selectedAgentId]);

  useEffect(() => {
    if (agents.length > 0 && !agents.some((a) => a.id === relayFrom)) {
      setRelayFrom(agents[0].id);
    }
    if (agents.length > 1 && !agents.some((a) => a.id === relayTo)) {
      const other = agents.find((a) => a.id !== relayFrom) || agents[1];
      if (other) setRelayTo(other.id);
    }
  }, [agents, relayFrom, relayTo]);

  useEffect(() => {
    if (tab === 'comms') {
      commsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [comms.length, tab]);

  const latestMission = missions[missions.length - 1];
  const selectedAgent = agents.find((a) => a.id === selectedAgentId) || agents[0] || null;
  const missionDeliverables = [...missions].reverse().filter((m) => Boolean(m.finalSummary));
  const taskDeliverables = [...tasks]
    .reverse()
    .filter((t) => t.status === 'completed' && Boolean(t.result));
  const deliverablesCount = missionDeliverables.length + taskDeliverables.length;

  const chatCommandCount = comms.filter(
    (m) => (COMMS_CATEGORY_META[m.kind] || COMMS_CATEGORY_META.system).group === 'chat-command'
  ).length;
  const systemDelegationCount = comms.length - chatCommandCount;
  const filteredComms =
    commsFilter === 'all'
      ? comms
      : comms.filter(
          (m) => (COMMS_CATEGORY_META[m.kind] || COMMS_CATEGORY_META.system).group === commsFilter
        );

  const activeTaskCount = tasks.filter((t) => !isTerminalTaskStatus(t.status)).length;
  const doneTaskCount = tasks.length - activeTaskCount;
  const orderedTasks = [...tasks].reverse();
  const filteredTasks =
    taskFilter === 'all'
      ? orderedTasks
      : taskFilter === 'active'
        ? orderedTasks.filter((t) => !isTerminalTaskStatus(t.status))
        : orderedTasks.filter((t) => isTerminalTaskStatus(t.status));

  const handleCopyMarkdown = (id: string, markdown: string) => {
    navigator.clipboard.writeText(markdown);
    setCopiedDeliverableId(id);
    setTimeout(() => setCopiedDeliverableId(null), 1600);
  };

  const handleRelaySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!relayText.trim() || !relayFrom || !relayTo || relaySending) return;
    setRelaySending(true);
    try {
      await onSendBotCommand(
        relayFrom,
        relayTo,
        relayText.trim(),
        relayAsTask,
        relayAsTask ? 'Order langsung' : undefined
      );
      setRelayText('');
    } catch {
      // Errors surface via socket auth guard or server comms log
    } finally {
      setRelaySending(false);
    }
  };

  return (
    <aside className="flex h-full w-full flex-col border-l border-slate-800 bg-slate-900/95 backdrop-blur-xl">
      {/* Latest Mission Banner */}
      {latestMission && (
        <div className="border-b border-slate-800 bg-slate-950/60 px-4 py-3">
          <div className="flex items-start justify-between gap-2.5">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <Activity className="h-3.5 w-3.5 shrink-0 text-amber-400" />
                <span>Misi Terbaru</span>
                <span
                  className={`ml-1 rounded px-1.5 py-0.5 text-[10px] ${
                    MISSION_STATUS_META[latestMission.status].cls
                  }`}
                >
                  {MISSION_STATUS_META[latestMission.status].label}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-200">
                {cleanOneLine(latestMission.prompt, 'Misi aktif')}
              </p>
            </div>
            {latestMission.finalSummary && (
              <button
                type="button"
                onClick={() => onOpenReport(latestMission)}
                className="flex shrink-0 items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-200 transition hover:bg-emerald-500/25 cursor-pointer"
              >
                <FileText className="h-3.5 w-3.5" />
                <span>Hasil</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Live Room Roster & Status Strip */}
      <div className="border-b border-slate-800 bg-slate-950/35 px-3 py-2">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Bot Ruangan ({agents.length})
          </span>
          <button
            type="button"
            onClick={async () => {
              if (!confirmReset) {
                setConfirmReset(true);
                setTimeout(() => setConfirmReset(false), 3000);
                return;
              }
              setConfirmReset(false);
              await onResetWorkspace();
            }}
            className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition cursor-pointer ${
              confirmReset
                ? 'bg-rose-500/25 text-rose-200 border border-rose-500/40'
                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
            title="Reset ruangan ke keadaan awal"
          >
            <RotateCcw className="h-2.5 w-2.5" />
            <span>{confirmReset ? 'Klik lagi: Reset' : 'Reset Ruangan'}</span>
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {agents.map((a) => {
            const brain = getAgentBrainBadge(a);
            const dotCls =
              a.status === 'working'
                ? 'bg-emerald-400 animate-pulse'
                : a.status === 'online'
                  ? 'bg-green-400'
                  : a.status === 'talking'
                    ? 'bg-cyan-400 animate-pulse'
                    : a.status === 'thinking' || a.status === 'meeting'
                      ? 'bg-amber-400'
                      : a.status === 'offline' || a.status === 'error'
                        ? 'bg-rose-500'
                        : 'bg-sky-400';
            const cleanName = stripUniqueSymbols(a.name) || a.name;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => onSelectAgent(a.id)}
                title={`${cleanName} — ${a.role} (${a.status}) | Otak: ${brain.label}`}
                className={`flex flex-wrap items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition cursor-pointer ${
                  selectedAgentId === a.id
                    ? 'border-amber-400/70 bg-amber-500/15 text-amber-100'
                    : brain.isFallback
                      ? 'border-rose-500/45 bg-rose-950/35 text-rose-100 hover:border-rose-400'
                      : 'border-slate-800 bg-slate-900/90 text-slate-300 hover:border-slate-700'
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${dotCls}`} />
                <span className="font-medium">{cleanName}</span>
                <span className="font-mono text-[9px] text-slate-500">{a.status}</span>
                <span className={`rounded border px-1.5 py-0.5 text-[9px] font-semibold ${brain.cls}`}>
                  {brain.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center border-b border-slate-800 px-1.5 pt-1.5">
        <button
          type="button"
          onClick={() => setTab('comms')}
          className={`flex flex-auto items-center justify-center gap-1.5 whitespace-nowrap border-b-2 px-2 py-2 text-[11px] sm:text-xs font-semibold transition cursor-pointer ${
            tab === 'comms'
              ? 'border-amber-400 text-amber-300'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <MessageSquare className="h-3.5 w-3.5 shrink-0" />
          <span>Percakapan</span>
          <span className="rounded-full bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
            {comms.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setTab('tasks')}
          className={`flex flex-auto items-center justify-center gap-1.5 whitespace-nowrap border-b-2 px-2 py-2 text-[11px] sm:text-xs font-semibold transition cursor-pointer ${
            tab === 'tasks'
              ? 'border-amber-400 text-amber-300'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <ListChecks className="h-3.5 w-3.5 shrink-0" />
          <span>Tugas</span>
          <span className="rounded-full bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
            {tasks.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setTab('deliverables')}
          className={`flex flex-auto items-center justify-center gap-1.5 whitespace-nowrap border-b-2 px-2 py-2 text-[11px] sm:text-xs font-semibold transition cursor-pointer ${
            tab === 'deliverables'
              ? 'border-amber-400 text-amber-300'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <FileText className="h-3.5 w-3.5 shrink-0" />
          <span>Hasil</span>
          <span className="rounded-full bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
            {deliverablesCount}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setTab('inspector')}
          className={`flex flex-auto items-center justify-center gap-1.5 whitespace-nowrap border-b-2 px-2 py-2 text-[11px] sm:text-xs font-semibold transition cursor-pointer ${
            tab === 'inspector'
              ? 'border-amber-400 text-amber-300'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Settings2 className="h-3.5 w-3.5 shrink-0" />
          <span>Bot</span>
        </button>
      </div>

      {/* Tab Content */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3.5">
        {tab === 'comms' && (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-slate-400">
                Log Komunikasi & Delegasi Ruangan
              </span>
              {comms.length > 1 && (
                <button
                  type="button"
                  onClick={onClearHistory}
                  className="text-[11px] text-slate-500 transition hover:text-rose-400 cursor-pointer"
                >
                  Bersihkan Log
                </button>
              )}
            </div>

            <FilterPillBar
              ariaLabel="Filter percakapan"
              value={commsFilter}
              onChange={setCommsFilter}
              options={[
                { id: 'all', label: 'Semua', count: comms.length },
                { id: 'chat-command', label: 'Obrolan & Perintah', count: chatCommandCount },
                {
                  id: 'system-delegation',
                  label: 'Sistem & Delegasi',
                  count: systemDelegationCount,
                },
              ]}
            />

            {filteredComms.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-800 p-6 text-center text-xs text-slate-400">
                {comms.length === 0
                  ? 'Belum ada percakapan di ruangan.'
                  : 'Tidak ada pesan pada filter ini.'}
              </div>
            ) : (
              filteredComms.map((msg) => {
                const meta = COMMS_CATEGORY_META[msg.kind] || COMMS_CATEGORY_META.system;
                const fromLabel = stripUniqueSymbols(msg.fromName) || msg.fromName;
                const toLabel = stripUniqueSymbols(msg.toName) || msg.toName;

                return (
                  <div key={msg.id} className={`rounded-xl border p-3 ${meta.cardCls}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs font-semibold text-slate-100">
                        <span className="truncate">{fromLabel}</span>
                        <ArrowRight
                          className="h-3 w-3 shrink-0 text-slate-500"
                          aria-hidden="true"
                        />
                        <span className="truncate text-sky-300">{toLabel}</span>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <span
                          className={`rounded-md border px-1.5 py-0.5 text-[10px] font-semibold ${meta.pillCls}`}
                        >
                          {meta.label}
                        </span>
                        <span className="font-mono text-[10px] tabular-nums text-slate-500">
                          {formatTimeHMS(msg.timestamp)}
                        </span>
                      </div>
                    </div>
                    <div className="mt-2 border-t border-slate-800/50 pt-2">
                      <MarkdownView content={msg.content} compact />
                    </div>
                  </div>
                );
              })
            )}
            <div ref={commsEndRef} />
          </div>
        )}

        {tab === 'tasks' && (
          <div className="flex flex-col gap-3">
            {missions.length > 0 && (
              <div className="space-y-1.5">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Misi ({missions.length})
                </div>
                {[...missions]
                  .reverse()
                  .slice(0, 5)
                  .map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center justify-between gap-2 rounded-xl border border-slate-800/90 bg-slate-950/60 px-3 py-2 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${
                              MISSION_STATUS_META[m.status].cls
                            }`}
                          >
                            {MISSION_STATUS_META[m.status].label}
                          </span>
                          <span className="truncate text-[11px] text-slate-200">
                            {cleanOneLine(m.prompt, 'Misi')}
                          </span>
                        </div>
                      </div>
                      {m.finalSummary && (
                        <button
                          type="button"
                          onClick={() => onOpenReport(m)}
                          className="shrink-0 rounded-md border border-emerald-500/35 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-200 hover:bg-emerald-500/25 cursor-pointer"
                        >
                          Laporan
                        </button>
                      )}
                    </div>
                  ))}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Sub-Tugas & Dependensi ({tasks.length})
              </div>
              <FilterPillBar
                ariaLabel="Filter status tugas"
                value={taskFilter}
                onChange={setTaskFilter}
                options={[
                  { id: 'all', label: 'Semua', count: tasks.length },
                  { id: 'active', label: 'Aktif & Macet', count: activeTaskCount },
                  { id: 'done', label: 'Selesai & Gagal', count: doneTaskCount },
                ]}
              />
            </div>

            {tasks.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-800 p-6 text-center text-xs text-slate-400">
                Belum ada sub-tugas. Kirim perintah di Command Bar bawah untuk melihat bot saling
                membagi tugas secara otomatis.
              </div>
            ) : filteredTasks.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-800 p-6 text-center text-xs text-slate-400">
                Tidak ada tugas pada kategori ini.
              </div>
            ) : (
              filteredTasks.map((task) => {
                const assignee = agents.find((a) => a.id === task.assignedToId);
                const assigner = agents.find((a) => a.id === task.assignedById);
                const st = STATUS_BADGES[task.status] || STATUS_BADGES.queued;
                const open = expandedTaskId === task.id;
                const depTasks = task.dependsOnTaskIds
                  .map((depId) => tasks.find((t) => t.id === depId))
                  .filter((t): t is Task => Boolean(t));
                const pendingDeps = depTasks.filter(
                  (t) => !isTerminalTaskStatus(t.status)
                ).length;
                const isCancellable = CANCELLABLE_STATUSES.has(task.status);
                const isStuck = task.status === 'stuck';
                const capableReassignAgents = agents.filter(
                  (a) => a.status !== 'offline' && a.brainMode !== 'fallback'
                );
                const chosenReassignId =
                  reassignTargets[task.id] ||
                  capableReassignAgents.find((a) => a.id !== task.assignedToId)?.id ||
                  capableReassignAgents[0]?.id ||
                  '';

                const assignerLabel = stripUniqueSymbols(
                  assigner?.name || (task.assignedById === 'user' ? 'Owner' : task.assignedById)
                );
                const assigneeLabel = stripUniqueSymbols(assignee?.name || task.assignedToId);
                const cleanedTitle = cleanOneLine(task.title, 'Tugas');
                const previewSnippet = cleanOneLine(
                  task.error || task.result || task.instructions || ''
                );

                return (
                  <div
                    key={task.id}
                    className={`rounded-xl border transition ${
                      isStuck
                        ? 'border-orange-500/50 bg-orange-950/15'
                        : 'border-slate-800 bg-slate-950/70 hover:border-slate-700'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => setExpandedTaskId(open ? null : task.id)}
                      className="flex w-full flex-col p-3 text-left cursor-pointer"
                    >
                      <div className="flex w-full items-start justify-between gap-2">
                        <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                          <span>{assignerLabel}</span>
                          <ArrowRight
                            className="h-3 w-3 shrink-0 text-slate-500"
                            aria-hidden="true"
                          />
                          <span
                            className="font-medium"
                            style={{ color: assignee?.color || '#38bdf8' }}
                          >
                            {assigneeLabel}
                          </span>
                          {task.dependsOnTaskIds.length > 0 && (
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] ${
                                task.status === 'waiting-dependency'
                                  ? 'bg-violet-500/15 text-violet-300'
                                  : 'bg-slate-800 text-slate-400'
                              }`}
                            >
                              {task.status === 'waiting-dependency'
                                ? `Menunggu ${pendingDeps || task.dependsOnTaskIds.length} dependensi`
                                : `Setelah ${task.dependsOnTaskIds.length} tugas`}
                            </span>
                          )}
                        </div>
                        <span
                          className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold ${st.cls}`}
                        >
                          {st.label}
                        </span>
                      </div>

                      <div className="mt-1.5 flex items-start gap-1.5">
                        {open ? (
                          <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                        ) : (
                          <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                        )}
                        <span className="line-clamp-2 text-[13px] font-semibold leading-snug text-slate-100">
                          {cleanedTitle}
                        </span>
                      </div>

                      {!open && previewSnippet && (
                        <p
                          className={`mt-1.5 line-clamp-2 pl-5 text-[11px] leading-relaxed ${
                            task.error ? 'text-rose-300/90' : 'text-slate-400'
                          }`}
                        >
                          {previewSnippet}
                        </p>
                      )}
                    </button>

                    {(isStuck || isCancellable) && (
                      <div className="flex flex-wrap items-center gap-2 border-t border-slate-800/70 px-3 py-2.5">
                        {isStuck && (
                          <>
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-orange-300">
                              <AlertTriangle className="h-3 w-3 shrink-0" />
                              <span>Tanpa kabar &gt; 10 menit:</span>
                            </span>
                            {capableReassignAgents.length > 0 && (
                              <div className="flex flex-wrap items-center gap-1.5">
                                <select
                                  value={chosenReassignId}
                                  onChange={(e) =>
                                    setReassignTargets((prev) => ({
                                      ...prev,
                                      [task.id]: e.target.value,
                                    }))
                                  }
                                  aria-label="Pilih bot untuk tugaskan ulang"
                                  className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-200 outline-none"
                                >
                                  {capableReassignAgents.map((a) => (
                                    <option key={a.id} value={a.id}>
                                      {stripUniqueSymbols(a.name) || a.name}
                                    </option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  disabled={busyTaskId === task.id || !chosenReassignId}
                                  onClick={async () => {
                                    setBusyTaskId(task.id);
                                    try {
                                      await onReassignTask(task.id, chosenReassignId);
                                    } finally {
                                      setBusyTaskId(null);
                                    }
                                  }}
                                  className="inline-flex items-center gap-1 rounded-md border border-sky-500/45 bg-sky-500/15 px-2.5 py-1 text-[11px] font-semibold text-sky-200 transition hover:bg-sky-500/25 disabled:opacity-45 cursor-pointer"
                                >
                                  <RefreshCw className="h-3 w-3" />
                                  <span>Tugaskan Ulang</span>
                                </button>
                              </div>
                            )}
                            <button
                              type="button"
                              disabled={busyTaskId === task.id}
                              onClick={async () => {
                                setBusyTaskId(task.id);
                                try {
                                  await onMarkTaskFailed(task.id);
                                } finally {
                                  setBusyTaskId(null);
                                }
                              }}
                              className="inline-flex items-center gap-1 rounded-md border border-rose-500/45 bg-rose-500/15 px-2.5 py-1 text-[11px] font-semibold text-rose-200 transition hover:bg-rose-500/25 disabled:opacity-45 cursor-pointer"
                            >
                              <XCircle className="h-3 w-3" />
                              <span>Tandai Gagal</span>
                            </button>
                          </>
                        )}
                        {isCancellable && (
                          <button
                            type="button"
                            disabled={busyTaskId === task.id}
                            onClick={async () => {
                              setBusyTaskId(task.id);
                              try {
                                await onCancelTask(task.id);
                              } finally {
                                setBusyTaskId(null);
                              }
                            }}
                            className="ml-auto inline-flex items-center gap-1 rounded-md border border-rose-500/40 bg-rose-950/50 px-2.5 py-1 text-[11px] font-semibold text-rose-200 transition hover:bg-rose-500/25 disabled:opacity-45 cursor-pointer"
                          >
                            <Ban className="h-3 w-3" />
                            <span>Batalkan tugas</span>
                          </button>
                        )}
                      </div>
                    )}

                    {open && (
                      <div className="border-t border-slate-800/80 px-3 py-3 text-xs">
                        {task.dependsOnTaskIds.length > 0 && (
                          <div className="mb-3 rounded-lg border border-slate-800 bg-slate-900/70 p-2.5">
                            <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                              Dependensi ({task.dependsOnTaskIds.length})
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {task.dependsOnTaskIds.map((depId) => {
                                const dep = tasks.find((t) => t.id === depId);
                                const depBadge = dep
                                  ? STATUS_BADGES[dep.status] || STATUS_BADGES.queued
                                  : STATUS_BADGES.queued;
                                return (
                                  <span
                                    key={depId}
                                    className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${depBadge.cls}`}
                                  >
                                    <span>{cleanOneLine(dep?.title, depId)}</span>
                                    <span className="opacity-75">({depBadge.label})</span>
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        <div className="mb-1.5 text-[11px] font-medium text-slate-400">
                          Instruksi:
                        </div>
                        <div className="mb-3 rounded-lg border border-slate-800/75 bg-slate-900/80 p-2.5">
                          <MarkdownView content={task.instructions} compact />
                        </div>
                        {task.result && (
                          <>
                            <div className="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              <span>Hasil Pekerjaan:</span>
                            </div>
                            <div className="rounded-lg border border-emerald-500/20 bg-emerald-950/20 p-2.5 text-slate-200">
                              <MarkdownView content={task.result} compact />
                            </div>
                          </>
                        )}
                        {task.error && (
                          <div className="mt-2 flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-950/30 p-2.5 text-rose-300">
                            <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span className="text-[11px] leading-relaxed">
                              {cleanDisplayText(task.error, { stripMarkdown: true })}
                            </span>
                          </div>
                        )}
                        {!task.result && !task.error && (
                          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                            <Clock className="h-3.5 w-3.5 shrink-0" />
                            <span>
                              {task.status === 'waiting-dependency'
                                ? 'Menunggu tugas pendahulu selesai sebelum dieksekusi...'
                                : task.status === 'queued'
                                  ? 'Dalam antrean eksekusi...'
                                  : task.status === 'assigned' || task.status === 'delegated'
                                    ? `Tugas dikirim ke ${assigneeLabel}, menunggu pengerjaan...`
                                    : `Sedang diproses di workstation ${assigneeLabel}...`}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {tab === 'deliverables' && (
          <div className="flex flex-col gap-3">
            <div className="text-[11px] font-medium text-slate-400">
              Rantai Alur & Deliverables Markdown ({deliverablesCount})
            </div>

            {missions.length > 0 && (
              <div className="flex flex-col gap-2.5">
                {[...missions]
                  .reverse()
                  .filter((m) => tasks.some((t) => t.missionId === m.id))
                  .map((m) => {
                    const missionTasks = tasks.filter((t) => t.missionId === m.id);
                    const idSet = new Set(missionTasks.map((t) => t.id));
                    const childrenMap = new Map<string, Task[]>();
                    const roots: Task[] = [];
                    for (const t of missionTasks) {
                      if (t.parentTaskId && idSet.has(t.parentTaskId)) {
                        const list = childrenMap.get(t.parentTaskId) || [];
                        list.push(t);
                        childrenMap.set(t.parentTaskId, list);
                      } else {
                        roots.push(t);
                      }
                    }

                    const renderNode = (node: Task, depth: number): React.ReactNode => {
                      const worker = agents.find((a) => a.id === node.assignedToId);
                      const fromBot = agents.find((a) => a.id === node.assignedById);
                      const badge = STATUS_BADGES[node.status] || STATUS_BADGES.queued;
                      const children = childrenMap.get(node.id) || [];
                      const roleLabel = depth === 0 ? 'Tugas' : 'Sub-delegasi';
                      const fromLabel = fromBot
                        ? stripUniqueSymbols(fromBot.name) || fromBot.name
                        : node.assignedById === 'user'
                          ? 'Owner'
                          : node.assignedById;
                      const toLabel = stripUniqueSymbols(worker?.name || node.assignedToId);

                      return (
                        <div
                          key={node.id}
                          className={
                            depth > 0 ? 'mt-2 ml-3 border-l-2 border-slate-700/80 pl-2.5' : 'mt-2'
                          }
                        >
                          <div className="rounded-lg border border-slate-800/90 bg-slate-900/75 px-2.5 py-2">
                            <div className="flex items-center justify-between gap-2">
                              <span
                                className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${
                                  depth === 0
                                    ? 'bg-slate-800 text-slate-300'
                                    : 'bg-violet-500/15 text-violet-300'
                                }`}
                              >
                                {roleLabel}
                              </span>
                              <span
                                className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold ${badge.cls}`}
                              >
                                {badge.label}
                              </span>
                            </div>
                            <div className="mt-1.5 line-clamp-2 text-xs font-semibold leading-snug text-slate-100">
                              {cleanOneLine(node.title, 'Tugas')}
                            </div>
                            <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[10px] text-slate-400">
                              <span>{fromLabel}</span>
                              <ArrowRight
                                className="h-2.5 w-2.5 shrink-0 text-slate-500"
                                aria-hidden="true"
                              />
                              <span
                                className="font-medium"
                                style={{ color: worker?.color || '#38bdf8' }}
                              >
                                {toLabel}
                              </span>
                            </div>
                          </div>
                          {children.map((child) => renderNode(child, depth + 1))}
                        </div>
                      );
                    };

                    return (
                      <div
                        key={`chain-${m.id}`}
                        className="rounded-xl border border-slate-800 bg-slate-950/75 p-3"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-sky-300">
                            <GitBranch className="h-3 w-3 shrink-0" />
                            <span className="inline-flex items-center gap-1">
                              <span>Misi</span>
                              <ArrowRight
                                className="h-2.5 w-2.5 shrink-0 text-sky-400/80"
                                aria-hidden="true"
                              />
                              <span>Tugas</span>
                              <ArrowRight
                                className="h-2.5 w-2.5 shrink-0 text-sky-400/80"
                                aria-hidden="true"
                              />
                              <span>Sub-delegasi</span>
                            </span>
                          </div>
                          <span
                            className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold ${
                              MISSION_STATUS_META[m.status].cls
                            }`}
                          >
                            {MISSION_STATUS_META[m.status].label}
                          </span>
                        </div>

                        <div className="mt-2 rounded-lg border border-slate-800/80 bg-slate-900/60 px-2.5 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-sky-300">
                              Misi
                            </span>
                            {m.finalSummary && (
                              <button
                                type="button"
                                onClick={() => onOpenReport(m)}
                                className="rounded border border-emerald-500/35 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-200 transition hover:bg-emerald-500/25 cursor-pointer"
                              >
                                Buka Laporan
                              </button>
                            )}
                          </div>
                          <div className="mt-1.5 line-clamp-2 text-xs font-semibold leading-snug text-slate-100">
                            {cleanOneLine(m.prompt, 'Misi')}
                          </div>
                        </div>

                        <div className="mt-1">{roots.map((r) => renderNode(r, 0))}</div>
                      </div>
                    );
                  })}
              </div>
            )}

            {deliverablesCount === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-800 p-6 text-center text-xs text-slate-400">
                Belum ada deliverable Markdown. Hasil pekerjaan bot dan laporan akhir misi akan
                tampil di sini secara otomatis.
              </div>
            ) : (
              <>
                {missionDeliverables.map((m) => (
                  <div
                    key={m.id}
                    className="rounded-xl border border-emerald-500/30 bg-slate-950/80 p-3"
                  >
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                          Laporan Akhir Misi
                        </div>
                        <div className="mt-0.5 line-clamp-2 text-xs font-semibold leading-snug text-slate-100">
                          {cleanOneLine(m.prompt, 'Laporan Misi')}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleCopyMarkdown(m.id, m.finalSummary || '')}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[10px] font-medium text-slate-200 transition hover:bg-slate-700 cursor-pointer"
                          title="Salin Markdown"
                        >
                          {copiedDeliverableId === m.id ? (
                            <>
                              <Check className="h-3 w-3 text-emerald-400" />
                              <span>Disalin</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-3 w-3" />
                              <span>Salin Markdown</span>
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => onOpenReport(m)}
                          className="rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2 py-1 text-[10px] font-semibold text-emerald-200 transition hover:bg-emerald-500/25 cursor-pointer"
                        >
                          Buka Laporan
                        </button>
                      </div>
                    </div>
                    <div className="max-h-72 overflow-y-auto rounded-lg border border-slate-800/80 bg-slate-900/60 p-3">
                      <MarkdownView content={m.finalSummary || ''} compact />
                    </div>
                  </div>
                ))}

                {taskDeliverables.map((task) => {
                  const assignee = agents.find((a) => a.id === task.assignedToId);
                  const assigneeLabel = stripUniqueSymbols(assignee?.name || task.assignedToId);
                  return (
                    <div
                      key={task.id}
                      className="rounded-xl border border-slate-800 bg-slate-950/75 p-3"
                    >
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span
                              className="h-2 w-2 shrink-0 rounded-full"
                              style={{ backgroundColor: assignee?.color || '#38bdf8' }}
                            />
                            <span className="text-[10px] font-semibold text-slate-400">
                              {assigneeLabel}
                            </span>
                          </div>
                          <div className="mt-0.5 line-clamp-2 text-xs font-semibold leading-snug text-slate-100">
                            {cleanOneLine(task.title, 'Hasil Tugas')}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleCopyMarkdown(task.id, task.result || '')}
                          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[10px] font-medium text-slate-200 transition hover:bg-slate-700 cursor-pointer"
                          title="Salin Markdown"
                        >
                          {copiedDeliverableId === task.id ? (
                            <>
                              <Check className="h-3 w-3 text-emerald-400" />
                              <span>Disalin</span>
                            </>
                          ) : (
                            <>
                              <Copy className="h-3 w-3" />
                              <span>Salin Markdown</span>
                            </>
                          )}
                        </button>
                      </div>
                      <div className="max-h-64 overflow-y-auto rounded-lg border border-slate-800/80 bg-slate-900/50 p-3">
                        <MarkdownView content={task.result || ''} compact />
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}

        {tab === 'inspector' && (
          <BotInspector
            agents={agents}
            selectedAgent={selectedAgent}
            onSelectAgent={onSelectAgent}
            onUpdateAgent={onUpdateAgent}
            onDeleteAgent={onDeleteAgent}
            onMoveAgent={onMoveAgent}
          />
        )}
      </div>

      {/* Bottom Mini Bot-to-Bot Command Sender (visible on Percakapan tab) */}
      {tab === 'comms' && agents.length >= 2 && (
        <form
          onSubmit={handleRelaySubmit}
          className="border-t border-slate-800 bg-slate-950/70 p-2.5"
        >
          <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] text-slate-400">
            <span className="font-medium text-slate-300">Kirim Perintah / Chat Antar-Bot:</span>
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={relayAsTask}
                onChange={(e) => setRelayAsTask(e.target.checked)}
                className="accent-amber-500"
              />
              <span>Eksekusi sbg Tugas</span>
            </label>
          </div>
          <div className="mb-1.5 flex items-center gap-1.5">
            <select
              value={relayFrom}
              onChange={(e) => setRelayFrom(e.target.value)}
              aria-label="Bot pengirim"
              className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-200 outline-none"
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  Dari: {stripUniqueSymbols(a.name) || a.name}
                </option>
              ))}
            </select>
            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" />
            <select
              value={relayTo}
              onChange={(e) => setRelayTo(e.target.value)}
              aria-label="Bot penerima"
              className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-200 outline-none"
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  Ke: {stripUniqueSymbols(a.name) || a.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={relayText}
              onChange={(e) => setRelayText(e.target.value)}
              placeholder="Contoh: Tolong buatkan endpoint webhook..."
              className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-100 placeholder-slate-500 outline-none focus:border-amber-500/60"
            />
            <button
              type="submit"
              disabled={!relayText.trim() || relaySending}
              className="rounded-lg bg-slate-800 p-1.5 text-amber-300 transition hover:bg-slate-700 disabled:opacity-40 cursor-pointer"
              title="Kirim antar bot"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>
        </form>
      )}
    </aside>
  );
};

interface BotInspectorProps {
  agents: Agent[];
  selectedAgent: Agent | null;
  onSelectAgent: (id: string | null) => void;
  onUpdateAgent: (id: string, patch: Partial<Agent>) => Promise<void>;
  onDeleteAgent: (id: string) => Promise<void>;
  onMoveAgent: (id: string, zone: ZoneId) => Promise<void>;
}

const BotInspector: React.FC<BotInspectorProps> = ({
  agents,
  selectedAgent,
  onSelectAgent,
  onUpdateAgent,
  onDeleteAgent,
  onMoveAgent,
}) => {
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [provider, setProvider] = useState<LLMProvider>('gemini');
  const [model, setModel] = useState('');
  const [homeZone, setHomeZone] = useState<ZoneId>('engineering-bay');
  const [canDelegate, setCanDelegate] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [savedNotice, setSavedNotice] = useState(false);

  useEffect(() => {
    if (!selectedAgent) return;
    setName(selectedAgent.name);
    setRole(selectedAgent.role);
    setSystemPrompt(selectedAgent.systemPrompt);
    setProvider(selectedAgent.provider);
    setModel(selectedAgent.model);
    setHomeZone(selectedAgent.homeZone);
    setCanDelegate(selectedAgent.canDelegate);
    setWebhookUrl(selectedAgent.webhookUrl || '');
  }, [selectedAgent?.id]);

  if (!selectedAgent) {
    return (
      <div className="p-4 text-center text-xs text-slate-400">
        Pilih salah satu bot di ruangan kantor untuk melihat dan mengubah pengaturannya.
      </div>
    );
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    await onUpdateAgent(selectedAgent.id, {
      name,
      role,
      systemPrompt,
      provider,
      model,
      homeZone,
      canDelegate,
      webhookUrl: webhookUrl.trim() || undefined,
    });
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 1800);
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Quick Bot Selector Pills */}
      <div className="flex flex-wrap gap-1.5">
        {agents.map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => onSelectAgent(a.id)}
            className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-medium transition cursor-pointer ${
              a.id === selectedAgent.id
                ? 'border-amber-400 bg-amber-500/15 text-amber-200'
                : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700 hover:text-slate-200'
            }`}
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: a.status === 'offline' ? '#ef4444' : a.color }}
            />
            <span>{stripUniqueSymbols(a.name) || a.name}</span>
          </button>
        ))}
      </div>

      {/* Status Header */}
      {(() => {
        const selectedBrain = getAgentBrainBadge(selectedAgent);
        return (
          <div className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-950/70 p-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-950"
                  style={{ backgroundColor: selectedAgent.color }}
                >
                  <Bot className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-100">
                    {stripUniqueSymbols(selectedAgent.name) || selectedAgent.name}
                  </div>
                  <div className="font-mono text-[10px] text-slate-400">
                    ID: {selectedAgent.id} / {selectedAgent.type}
                  </div>
                </div>
              </div>
              <span className="rounded-md bg-slate-800 px-2 py-0.5 font-mono text-[10px] uppercase text-sky-300">
                {selectedAgent.status}
              </span>
            </div>
            <div className="flex items-center justify-between border-t border-slate-800/70 pt-1.5 text-[10px]">
              <span className="text-slate-400">Otak / Eksekutor:</span>
              <span className={`rounded border px-2 py-0.5 font-semibold ${selectedBrain.cls}`}>
                {selectedBrain.label}
              </span>
            </div>
          </div>
        );
      })()}

      {/* Quick Move Room Buttons */}
      <div>
        <div className="mb-1.5 text-[11px] font-medium text-slate-400">Pindahkan ke Ruangan:</div>
        <div className="flex flex-wrap gap-1">
          {ZONES_META.map((z) => (
            <button
              key={z.id}
              type="button"
              onClick={() => onMoveAgent(selectedAgent.id, z.id)}
              className={`rounded-md border px-2 py-1 text-[10px] font-medium transition cursor-pointer ${
                selectedAgent.currentZone === z.id
                  ? 'border-sky-400 bg-sky-500/15 text-sky-200'
                  : 'border-slate-800 bg-slate-950 text-slate-400 hover:text-slate-200'
              }`}
            >
              {z.shortLabel}
            </button>
          ))}
        </div>
      </div>

      {/* Edit Config Form */}
      <form onSubmit={handleSave} className="flex flex-col gap-2.5 border-t border-slate-800 pt-3">
        <div>
          <label className="mb-1 block text-[11px] text-slate-400">Nama Bot</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 outline-none focus:border-amber-500"
          />
        </div>

        <div>
          <label className="mb-1 block text-[11px] text-slate-400">Peran / Spesialisasi</label>
          <input
            type="text"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 outline-none focus:border-amber-500"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-[11px] text-slate-400">Mesin AI</label>
            {selectedAgent.type === 'builtin' ? (
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value as LLMProvider)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 outline-none"
              >
                <option value="gemini">Google Gemini</option>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic Claude</option>
              </select>
            ) : (
              <div className="rounded-lg border border-purple-500/30 bg-purple-500/10 px-2 py-1.5 font-mono text-[11px] text-purple-200">
                External Bridge
              </div>
            )}
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-slate-400">Meja Utama</label>
            <select
              value={homeZone}
              onChange={(e) => setHomeZone(e.target.value as ZoneId)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 outline-none"
            >
              {ZONES_META.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {selectedAgent.type === 'builtin' && (
          <div>
            <label className="mb-1 block text-[11px] text-slate-400">
              Override Model (opsional)
            </label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="Kosongkan untuk pakai model default"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 font-mono text-xs text-slate-100 outline-none focus:border-amber-500"
            />
          </div>
        )}

        {selectedAgent.type === 'external-webhook' && (
          <div>
            <label className="mb-1 block text-[11px] text-slate-400">Webhook URL</label>
            <input
              type="url"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://bot-kamu.example/webhook"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 font-mono text-xs text-slate-100 outline-none"
            />
          </div>
        )}

        <div>
          <label className="mb-1 block text-[11px] text-slate-400">System Prompt / Instruksi</label>
          <textarea
            rows={4}
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs leading-relaxed text-slate-100 outline-none focus:border-amber-500"
          />
        </div>

        <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            checked={canDelegate}
            onChange={(e) => setCanDelegate(e.target.checked)}
            className="accent-amber-500"
          />
          <span>Boleh memberi perintah & membagi tugas ke bot lain</span>
        </label>

        <div className="flex items-center gap-2 pt-1">
          <button
            type="submit"
            className="flex-1 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-amber-400 cursor-pointer"
          >
            {savedNotice ? 'Tersimpan!' : 'Simpan Pengaturan'}
          </button>
          <button
            type="button"
            onClick={() => onDeleteAgent(selectedAgent.id)}
            className="rounded-lg border border-rose-500/35 bg-rose-500/10 p-1.5 text-rose-300 transition hover:bg-rose-500/25 cursor-pointer"
            title="Hapus bot dari ruangan"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </form>
    </div>
  );
};
