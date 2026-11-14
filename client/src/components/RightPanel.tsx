import React, { useEffect, useRef, useState } from 'react';
import {
  Activity,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  ListChecks,
  MessageSquare,
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
}

type TabId = 'comms' | 'tasks' | 'inspector';

const STATUS_BADGES: Record<string, { label: string; cls: string }> = {
  queued: { label: 'Antre', cls: 'bg-slate-700/70 text-slate-300' },
  delegated: { label: 'Menunggu Bot Luar', cls: 'bg-purple-500/20 text-purple-300' },
  working: { label: 'Dikerjakan', cls: 'bg-amber-500/20 text-amber-300' },
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
}) => {
  const [tab, setTab] = useState<TabId>('comms');
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

  // Bot-to-bot manual relay state
  const [relayFrom, setRelayFrom] = useState('muse-lead');
  const [relayTo, setRelayTo] = useState('muse-dev');
  const [relayText, setRelayText] = useState('');
  const [relayAsTask, setRelayAsTask] = useState(true);

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

  const handleRelaySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!relayText.trim() || !relayFrom || !relayTo) return;
    await onSendBotCommand(
      relayFrom,
      relayTo,
      relayText.trim(),
      relayAsTask,
      relayAsTask ? `Order langsung` : undefined
    );
    setRelayText('');
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

      {/* Navigation Tabs */}
      <div className="flex items-center border-b border-slate-800 px-2 pt-2">
        <button
          type="button"
          onClick={() => setTab('comms')}
          className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 px-3 py-2 text-xs font-semibold transition cursor-pointer ${
            tab === 'comms'
              ? 'border-amber-400 text-amber-300'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          <span>Comms</span>
          <span className="rounded-full bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
            {comms.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setTab('tasks')}
          className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 px-3 py-2 text-xs font-semibold transition cursor-pointer ${
            tab === 'tasks'
              ? 'border-amber-400 text-amber-300'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <ListChecks className="h-3.5 w-3.5" />
          <span>Tugas</span>
          <span className="rounded-full bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
            {tasks.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setTab('inspector')}
          className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 px-3 py-2 text-xs font-semibold transition cursor-pointer ${
            tab === 'inspector'
              ? 'border-amber-400 text-amber-300'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Settings2 className="h-3.5 w-3.5" />
          <span>Inspeksi Bot</span>
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
          <div className="flex flex-col gap-2">
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
                            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                              Menunggu {task.dependsOnTaskIds.length} tugas
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
                            <div className="whitespace-pre-wrap rounded-lg border border-emerald-500/20 bg-emerald-950/20 p-2.5 leading-relaxed text-slate-200">
                              {task.result}
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
                            <span>Sedang diproses di workstation {assignee?.name}...</span>
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
              disabled={!relayText.trim()}
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
  const [homeZone, setHomeZone] = useState<ZoneId>('dev-bay');
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
