import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  FileText,
  ListChecks,
  MessageSquare,
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
  onOpenReport: (mission: Mission) => void;
  onClearHistory: () => Promise<void>;
  onResetWorkspace: () => Promise<void>;
}

type TabId = 'comms' | 'tasks' | 'deliverables' | 'inspector';

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
  completed: { label: 'Selesai', cls: 'bg-emerald-500/20 text-emerald-300' },
  failed: { label: 'Gagal', cls: 'bg-rose-500/20 text-rose-300' },
};

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
  onOpenReport,
  onClearHistory,
  onResetWorkspace,
}) => {
  const [tab, setTab] = useState<TabId>('comms');
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [copiedDeliverableId, setCopiedDeliverableId] = useState<string | null>(null);

  // Bot-to-bot manual relay state
  const [relayFrom, setRelayFrom] = useState('muse-lead');
  const [relayTo, setRelayTo] = useState('muse-dev');
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
      setRelayTo(agents[1].id);
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
        relayAsTask ? `Order langsung` : undefined
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
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <Activity className="h-3.5 w-3.5 text-amber-400" />
                <span>Misi Terbaru</span>
                <span
                  className={`ml-1 rounded px-1.5 py-0.5 text-[10px] ${
                    latestMission.status === 'running'
                      ? 'bg-amber-500/20 text-amber-300'
                      : latestMission.status === 'completed'
                        ? 'bg-emerald-500/20 text-emerald-300'
                        : 'bg-rose-500/20 text-rose-300'
                  }`}
                >
                  {latestMission.status === 'running'
                    ? 'Berjalan'
                    : latestMission.status === 'completed'
                      ? 'Selesai'
                      : 'Gagal'}
                </span>
              </div>
              <p className="mt-1 line-clamp-2 text-xs text-slate-200">{latestMission.prompt}</p>
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
        <div className="flex flex-wrap gap-1">
          {agents.map((a) => {
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
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => onSelectAgent(a.id)}
                title={`${a.name} — ${a.role} (${a.status})`}
                className={`flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] transition cursor-pointer ${
                  selectedAgentId === a.id
                    ? 'border-amber-400/70 bg-amber-500/15 text-amber-100'
                    : 'border-slate-800 bg-slate-900/90 text-slate-300 hover:border-slate-700'
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${dotCls}`} />
                <span className="font-medium">{a.name}</span>
                <span className="font-mono text-[9px] text-slate-500">{a.status}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center border-b border-slate-800 px-1.5 pt-2">
        <button
          type="button"
          onClick={() => setTab('comms')}
          className={`flex flex-1 items-center justify-center gap-1 border-b-2 px-2 py-2 text-xs font-semibold transition cursor-pointer ${
            tab === 'comms'
              ? 'border-amber-400 text-amber-300'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <MessageSquare className="h-3.5 w-3.5 shrink-0" />
          <span>Comms</span>
          <span className="rounded-full bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
            {comms.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setTab('tasks')}
          className={`flex flex-1 items-center justify-center gap-1 border-b-2 px-2 py-2 text-xs font-semibold transition cursor-pointer ${
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
          className={`flex flex-1 items-center justify-center gap-1 border-b-2 px-2 py-2 text-xs font-semibold transition cursor-pointer ${
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
          className={`flex flex-1 items-center justify-center gap-1 border-b-2 px-2 py-2 text-xs font-semibold transition cursor-pointer ${
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
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {tab === 'comms' && (
          <div className="flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
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

            {comms.map((msg) => {
              const badgeColor =
                msg.kind === 'command'
                  ? 'border-amber-500/40 bg-amber-500/10'
                  : msg.kind === 'delegation'
                    ? 'border-violet-500/40 bg-violet-500/10'
                    : msg.kind === 'deliverable'
                      ? 'border-emerald-500/35 bg-emerald-500/10'
                      : msg.kind === 'error'
                        ? 'border-rose-500/40 bg-rose-500/10'
                        : 'border-slate-800 bg-slate-950/60';

              return (
                <div key={msg.id} className={`rounded-xl border p-2.5 text-xs ${badgeColor}`}>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <div className="font-semibold text-slate-100">
                      <span>{msg.fromName}</span>
                      <span className="mx-1 text-slate-500">→</span>
                      <span className="text-sky-300">{msg.toName}</span>
                    </div>
                    <span className="font-mono text-[10px] text-slate-500">
                      {new Date(msg.timestamp).toLocaleTimeString('id-ID', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </span>
                  </div>
                  <p className="whitespace-pre-wrap leading-relaxed text-slate-300">{msg.content}</p>
                </div>
              );
            })}
            <div ref={commsEndRef} />
          </div>
        )}

        {tab === 'tasks' && (
          <div className="flex flex-col gap-2.5">
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
                      className="flex items-center justify-between gap-2 rounded-xl border border-slate-800/90 bg-slate-950/60 px-2.5 py-2 text-xs"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${
                              m.status === 'running'
                                ? 'bg-amber-500/20 text-amber-300'
                                : m.status === 'completed'
                                  ? 'bg-emerald-500/20 text-emerald-300'
                                  : 'bg-rose-500/20 text-rose-300'
                            }`}
                          >
                            {m.status === 'running'
                              ? 'Berjalan'
                              : m.status === 'completed'
                                ? 'Selesai'
                                : 'Gagal'}
                          </span>
                          <span className="truncate text-[11px] text-slate-200">{m.prompt}</span>
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

            <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Sub-Tugas & Dependensi ({tasks.length})
            </div>

            {tasks.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-800 p-6 text-center text-xs text-slate-400">
                Belum ada sub-tugas. Kirim perintah di Command Bar bawah untuk melihat bot saling
                membagi tugas secara otomatis.
              </div>
            ) : (
              [...tasks].reverse().map((task) => {
                const assignee = agents.find((a) => a.id === task.assignedToId);
                const assigner = agents.find((a) => a.id === task.assignedById);
                const st = STATUS_BADGES[task.status] || STATUS_BADGES.queued;
                const open = expandedTaskId === task.id;
                const depTasks = task.dependsOnTaskIds
                  .map((depId) => tasks.find((t) => t.id === depId))
                  .filter((t): t is Task => Boolean(t));
                const pendingDeps = depTasks.filter(
                  (t) => t.status !== 'completed' && t.status !== 'failed'
                ).length;

                return (
                  <div
                    key={task.id}
                    className="rounded-xl border border-slate-800 bg-slate-950/70 transition hover:border-slate-700"
                  >
                    <button
                      type="button"
                      onClick={() => setExpandedTaskId(open ? null : task.id)}
                      className="flex w-full items-start justify-between gap-2 p-2.5 text-left cursor-pointer"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          {open ? (
                            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                          )}
                          <span className="truncate text-xs font-semibold text-slate-100">
                            {task.title}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 pl-5 text-[11px] text-slate-400">
                          <span>{assigner?.name || task.assignedById}</span>
                          <span>→</span>
                          <span
                            className="font-medium"
                            style={{ color: assignee?.color || '#38bdf8' }}
                          >
                            {assignee?.name || task.assignedToId}
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
                      </div>
                      <span
                        className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold ${st.cls}`}
                      >
                        {st.label}
                      </span>
                    </button>

                    {open && (
                      <div className="border-t border-slate-800/80 px-3 py-2.5 text-xs">
                        {task.dependsOnTaskIds.length > 0 && (
                          <div className="mb-2.5 rounded-lg border border-slate-800 bg-slate-900/70 p-2">
                            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                              Dependensi ({task.dependsOnTaskIds.length})
                            </div>
                            <div className="flex flex-wrap gap-1">
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
                                    <span>{dep?.title || depId}</span>
                                    <span className="opacity-75">({depBadge.label})</span>
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        <div className="mb-2 text-[11px] font-medium text-slate-400">Instruksi:</div>
                        <p className="mb-3 whitespace-pre-wrap rounded-lg bg-slate-900 p-2 text-slate-300">
                          {task.instructions}
                        </p>
                        {task.result && (
                          <>
                            <div className="mb-1 flex items-center gap-1 text-[11px] font-medium text-emerald-400">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              <span>Hasil Pekerjaan:</span>
                            </div>
                            <div className="rounded-lg border border-emerald-500/20 bg-emerald-950/20 p-2.5 text-slate-200">
                              <MarkdownView content={task.result} />
                            </div>
                          </>
                        )}
                        {task.error && (
                          <div className="flex items-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-950/30 p-2 text-rose-300">
                            <XCircle className="h-3.5 w-3.5 shrink-0" />
                            <span>{task.error}</span>
                          </div>
                        )}
                        {!task.result && !task.error && (
                          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                            <Clock className="h-3.5 w-3.5" />
                            <span>
                              {task.status === 'waiting-dependency'
                                ? 'Menunggu tugas pendahulu selesai sebelum dieksekusi...'
                                : task.status === 'queued'
                                  ? 'Dalam antrean eksekusi...'
                                  : task.status === 'assigned' || task.status === 'delegated'
                                    ? `Tugas dikirim ke ${assignee?.name || task.assignedToId}, menunggu pengerjaan...`
                                    : `Sedang diproses di workstation ${assignee?.name || task.assignedToId}...`}
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
              Deliverables Markdown ({deliverablesCount})
            </div>

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
                      <div className="min-w-0">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                          Laporan Akhir Misi
                        </div>
                        <div className="line-clamp-2 text-xs font-semibold text-slate-100">
                          {m.prompt}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handleCopyMarkdown(m.id, m.finalSummary || '')}
                          className="rounded border border-slate-700 bg-slate-800 p-1 text-slate-300 hover:bg-slate-700 cursor-pointer"
                          title="Salin Markdown"
                        >
                          {copiedDeliverableId === m.id ? (
                            <Check className="h-3 w-3 text-emerald-400" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => onOpenReport(m)}
                          className="rounded border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-200 hover:bg-emerald-500/25 cursor-pointer"
                        >
                          Perbesar
                        </button>
                      </div>
                    </div>
                    <div className="max-h-60 overflow-y-auto rounded-lg border border-slate-800/80 bg-slate-900/60 p-2.5">
                      <MarkdownView content={m.finalSummary || ''} />
                    </div>
                  </div>
                ))}

                {taskDeliverables.map((task) => {
                  const assignee = agents.find((a) => a.id === task.assignedToId);
                  return (
                    <div
                      key={task.id}
                      className="rounded-xl border border-slate-800 bg-slate-950/75 p-3"
                    >
                      <div className="mb-2 flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: assignee?.color || '#38bdf8' }}
                            />
                            <span className="text-[10px] font-semibold text-slate-400">
                              {assignee?.name || task.assignedToId}
                            </span>
                          </div>
                          <div className="truncate text-xs font-semibold text-slate-100">
                            {task.title}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleCopyMarkdown(task.id, task.result || '')}
                          className="shrink-0 rounded border border-slate-700 bg-slate-800 p-1 text-slate-300 hover:bg-slate-700 cursor-pointer"
                          title="Salin Markdown"
                        >
                          {copiedDeliverableId === task.id ? (
                            <Check className="h-3 w-3 text-emerald-400" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </button>
                      </div>
                      <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-800/80 bg-slate-900/50 p-2.5">
                        <MarkdownView content={task.result || ''} />
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

      {/* Bottom Mini Bot-to-Bot Command Sender (visible on Comms tab) */}
      {tab === 'comms' && agents.length >= 2 && (
        <form
          onSubmit={handleRelaySubmit}
          className="border-t border-slate-800 bg-slate-950/70 p-2.5"
        >
          <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] text-slate-400">
            <span className="font-medium text-slate-300">Simulasi Perintah Antar-Bot:</span>
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
              className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-200 outline-none"
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  Dari: {a.name}
                </option>
              ))}
            </select>
            <span className="text-slate-500">→</span>
            <select
              value={relayTo}
              onChange={(e) => setRelayTo(e.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-200 outline-none"
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  Ke: {a.name}
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
  const [provider, setProvider] = useState<LLMProvider>('demo');
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
            <span>{a.name}</span>
          </button>
        ))}
      </div>

      {/* Status Header */}
      <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/70 p-2.5">
        <div className="flex items-center gap-2">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-950"
            style={{ backgroundColor: selectedAgent.color }}
          >
            <Bot className="h-4 w-4" />
          </div>
          <div>
            <div className="text-xs font-bold text-slate-100">{selectedAgent.name}</div>
            <div className="font-mono text-[10px] text-slate-400">
              ID: {selectedAgent.id} • {selectedAgent.type}
            </div>
          </div>
        </div>
        <span className="rounded-md bg-slate-800 px-2 py-0.5 font-mono text-[10px] uppercase text-sky-300">
          {selectedAgent.status}
        </span>
      </div>

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
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as LLMProvider)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 outline-none"
            >
              <option value="demo">Demo / Simulasi</option>
              <option value="gemini">Google Gemini</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic Claude</option>
            </select>
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

        {provider !== 'demo' && selectedAgent.type === 'builtin' && (
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
          {selectedAgent.id !== 'muse-lead' && (
            <button
              type="button"
              onClick={() => onDeleteAgent(selectedAgent.id)}
              className="rounded-lg border border-rose-500/35 bg-rose-500/10 p-1.5 text-rose-300 transition hover:bg-rose-500/25 cursor-pointer"
              title="Hapus bot dari ruangan"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </form>
    </div>
  );
};
