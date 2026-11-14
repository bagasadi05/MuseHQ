import React, { useEffect, useRef, useState } from 'react';
import { Check, Info, Send, Sparkles, Terminal } from 'lucide-react';
import { Agent } from '../types';
import { getAgentBrainBadge } from '../utils/brainBadge';
import { playUiCue } from '../utils/soundEffects';

interface CommandBarProps {
  agents: Agent[];
  onLaunchMission: (prompt: string, targetAgentId: string) => Promise<boolean | void>;
  isRunningMission: boolean;
  selectedAgentId?: string | null;
}

const PRESET_MISSIONS = [
  {
    label: 'Rancang SaaS Pencatat Keuangan AI',
    prompt:
      'Buatkan rencana lengkap peluncuran SaaS Pencatat Keuangan AI untuk UMKM: mulai dari riset kebutuhan pasar, arsitektur API & database, copywriting landing page, hingga checklist QA sebelum rilis.',
  },
  {
    label: 'Strategi Bot Customer Service Otomatis',
    prompt:
      'Susun konsep sistem multi-bot Customer Service untuk toko online (WhatsApp + Web): alur eskalasi antar bot, rancangan webhook integration, template balasan ramah, dan audit risiko.',
  },
  {
    label: 'Audit & Optimasi Workflow Tim Konten',
    prompt:
      'Rancang workflow otomatis tim konten kreator berbasis AI: riset tren mingguan, penulisan script video pendek, dan QA kualitas konten sebelum dipublikasikan.',
  },
];

export const CommandBar: React.FC<CommandBarProps> = ({
  agents,
  onLaunchMission,
  isRunningMission,
  selectedAgentId,
}) => {
  const [prompt, setPrompt] = useState('');
  const [targetId, setTargetId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [targetHighlight, setTargetHighlight] = useState(false);
  const [sentPill, setSentPill] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const draftRef = useRef('');
  const lastSelectedRef = useRef<string | null | undefined>(selectedAgentId);
  const highlightTimerRef = useRef<number | null>(null);
  const sentTimerRef = useRef<number | null>(null);

  const selectedTarget =
    agents.find((a) => a.id === targetId) ||
    agents.find((a) => a.canDelegate) ||
    agents[0];
  const targetBrain = selectedTarget ? getAgentBrainBadge(selectedTarget) : null;
  const targetUnavailable =
    Boolean(selectedTarget) &&
    (selectedTarget!.status === 'offline' || targetBrain?.isFallback);

  // Sync target bot when user selects a bot on the office canvas
  useEffect(() => {
    if (selectedAgentId === lastSelectedRef.current) return;
    lastSelectedRef.current = selectedAgentId;
    if (!selectedAgentId) return;
    const matched = agents.find((a) => a.id === selectedAgentId);
    if (!matched) return;

    setTargetId(matched.id);
    setTargetHighlight(true);
    if (highlightTimerRef.current !== null) {
      window.clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = window.setTimeout(() => {
      setTargetHighlight(false);
      highlightTimerRef.current = null;
    }, 1150);
  }, [selectedAgentId, agents]);

  // Global `/` and `Ctrl+K` shortcut outside inputs/textareas to focus command input
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isEditable =
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        Boolean(target?.isContentEditable);
      if (isEditable) return;

      const isSlash = e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey;
      const isCtrlK = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k';
      if (!isSlash && !isCtrlK) return;

      e.preventDefault();
      inputRef.current?.focus();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current !== null) window.clearTimeout(highlightTimerRef.current);
      if (sentTimerRef.current !== null) window.clearTimeout(sentTimerRef.current);
    };
  }, []);

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (history.length === 0) return;

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (historyIndex === -1) {
        draftRef.current = prompt;
        setHistoryIndex(0);
        setPrompt(history[0]);
      } else if (historyIndex < history.length - 1) {
        const nextIdx = historyIndex + 1;
        setHistoryIndex(nextIdx);
        setPrompt(history[nextIdx]);
      }
      return;
    }

    if (e.key === 'ArrowDown' && historyIndex !== -1) {
      e.preventDefault();
      if (historyIndex === 0) {
        setHistoryIndex(-1);
        setPrompt(draftRef.current);
      } else {
        const nextIdx = historyIndex - 1;
        setHistoryIndex(nextIdx);
        setPrompt(history[nextIdx]);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = prompt.trim();
    if (!text || submitting || !selectedTarget) return;
    setSubmitting(true);
    try {
      const ok = await onLaunchMission(text, selectedTarget.id);
      if (ok !== false) {
        playUiCue('command');
        setHistory((prev) => [text, ...prev.filter((item) => item !== text)].slice(0, 25));
        setHistoryIndex(-1);
        draftRef.current = '';
        setPrompt('');
        setSentPill(`Terkirim ke @${selectedTarget.name}`);
        if (sentTimerRef.current !== null) {
          window.clearTimeout(sentTimerRef.current);
        }
        sentTimerRef.current = window.setTimeout(() => {
          setSentPill(null);
          sentTimerRef.current = null;
        }, 1800);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="pointer-events-auto absolute right-4 bottom-4 left-4 z-20 mx-auto max-w-4xl">
      {/* Quick Preset Prompts & Sent Feedback */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="flex items-center gap-1 rounded-md bg-slate-900/85 px-2 py-1 text-[11px] font-medium text-amber-300 backdrop-blur-md">
          <Sparkles className="h-3 w-3" />
          Contoh Perintah:
        </span>
        {PRESET_MISSIONS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => {
              playUiCue('click');
              setPrompt(preset.prompt);
              setHistoryIndex(-1);
              inputRef.current?.focus();
            }}
            className="rounded-md border border-slate-700/80 bg-slate-900/85 px-2.5 py-1 text-[11px] text-slate-300 backdrop-blur-md transition hover:border-amber-500/50 hover:bg-slate-800 hover:text-white cursor-pointer"
          >
            {preset.label}
          </button>
        ))}
        {sentPill && (
          <span
            role="status"
            className="ml-auto inline-flex items-center gap-1 rounded-md border border-emerald-500/45 bg-emerald-950/85 px-2.5 py-1 text-[11px] font-semibold text-emerald-200 shadow-lg backdrop-blur-md"
          >
            <Check className="h-3 w-3 text-emerald-400" />
            <span>{sentPill}</span>
          </span>
        )}
      </div>

      {/* Main Command Input */}
      <form
        onSubmit={handleSubmit}
        className={`flex flex-col gap-2 rounded-2xl border bg-slate-900/92 p-2.5 shadow-2xl shadow-black/60 backdrop-blur-xl transition-all duration-200 sm:flex-row sm:items-center ${
          targetHighlight
            ? 'border-amber-400/75 ring-2 ring-amber-400/35'
            : 'border-slate-700/80 focus-within:border-amber-500/55 focus-within:ring-2 focus-within:ring-amber-500/20'
        }`}
      >
        <div
          className={`flex items-center gap-2 rounded-xl border px-2.5 py-1.5 transition-colors ${
            targetHighlight
              ? 'border-amber-400/70 bg-amber-500/15'
              : 'border-slate-700/70 bg-slate-950/70'
          }`}
        >
          <Terminal className="h-3.5 w-3.5 shrink-0 text-amber-400" />
          <select
            value={selectedTarget?.id || ''}
            onChange={(e) => setTargetId(e.target.value)}
            disabled={agents.length === 0}
            aria-label="Target bot penerima perintah"
            title="Perintah dikirim sebagai SATU tugas ke bot yang dipilih; bot eksternal membagi sub-tugas sendiri lewat bot:delegate"
            className="bg-transparent text-xs font-medium text-slate-200 outline-none disabled:opacity-50 cursor-pointer"
          >
            {agents.length === 0 ? (
              <option value="" className="bg-slate-900 text-slate-400">
                Belum ada bot...
              </option>
            ) : (
              agents.map((a) => (
                <option key={a.id} value={a.id} className="bg-slate-900 text-slate-100">
                  @{a.name}{' '}
                  {a.type === 'builtin' && a.canDelegate
                    ? '(Koordinator Built-in)'
                    : a.canDelegate
                      ? '(Bot membagi via bot:delegate)'
                      : '(Langsung)'}
                </option>
              ))
            )}
          </select>
        </div>

        <div className="flex min-w-0 flex-1 items-center gap-2">
          <input
            ref={inputRef}
            type="text"
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              if (historyIndex !== -1) setHistoryIndex(-1);
            }}
            onKeyDown={handleInputKeyDown}
            placeholder={
              selectedTarget
                ? `Berikan perintah ke @${selectedTarget.name}...`
                : 'Hubungkan bot via External Bridge atau Tambah Bot dulu untuk memberi perintah...'
            }
            className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-sm text-slate-100 placeholder-slate-400 outline-none"
          />
          <kbd className="hidden rounded border border-slate-700/80 bg-slate-950/80 px-1.5 py-0.5 font-mono text-[10px] text-slate-400 md:inline-block">
            /
          </kbd>
        </div>

        <button
          type="submit"
          disabled={!prompt.trim() || submitting || !selectedTarget}
          className="flex items-center justify-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-45 cursor-pointer"
        >
          <Send className="h-3.5 w-3.5" />
          <span>{submitting ? 'Mengirim...' : isRunningMission ? 'Tambah Misi' : 'Kirim Perintah'}</span>
        </button>
      </form>

      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-slate-400">
        <span
          className="inline-flex items-center gap-1 rounded bg-slate-900/80 px-2 py-0.5 backdrop-blur-sm"
          title="Server membuat SATU tugas langsung ke bot pilihan Anda; untuk bot eksternal, bot itulah yang membagi tugas lewat event bot:delegate."
        >
          <Info className="h-3 w-3 shrink-0 text-sky-400" />
          <span>
            Perintah dari kolom ini dikirim sebagai <strong>SATU tugas</strong> ke bot yang dipilih;
            bot itulah yang membagi tugas ke bot lain — server tidak membagi otomatis untuk bot
            eksternal.
          </span>
        </span>
        {targetUnavailable && selectedTarget && (
          <span className="rounded border border-rose-500/40 bg-rose-950/70 px-2 py-0.5 text-[10px] font-semibold text-rose-200">
            @{selectedTarget.name}: {selectedTarget.status === 'offline' ? 'Offline' : targetBrain?.label} — misi akan ditolak
          </span>
        )}
      </div>
    </div>
  );
};
