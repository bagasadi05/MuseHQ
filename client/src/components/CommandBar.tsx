import React, { useState } from 'react';
import { Send, Sparkles, Terminal } from 'lucide-react';
import { Agent } from '../types';

interface CommandBarProps {
  agents: Agent[];
  onLaunchMission: (prompt: string, targetAgentId: string) => Promise<boolean | void>;
  isRunningMission: boolean;
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
}) => {
  const [prompt, setPrompt] = useState('');
  const [targetId, setTargetId] = useState('muse-lead');
  const [submitting, setSubmitting] = useState(false);

  const selectedTarget =
    agents.find((a) => a.id === targetId) ||
    agents.find((a) => a.canDelegate) ||
    agents[0];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = prompt.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    try {
      const ok = await onLaunchMission(text, selectedTarget?.id || 'muse-lead');
      if (ok !== false) {
        setPrompt('');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="pointer-events-auto absolute right-4 bottom-4 left-4 z-20 mx-auto max-w-4xl">
      {/* Quick Preset Prompts */}
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="flex items-center gap-1 rounded-md bg-slate-900/85 px-2 py-1 text-[11px] font-medium text-amber-300 backdrop-blur-md">
          <Sparkles className="h-3 w-3" />
          Contoh Perintah:
        </span>
        {PRESET_MISSIONS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => setPrompt(preset.prompt)}
            className="rounded-md border border-slate-700/80 bg-slate-900/85 px-2.5 py-1 text-[11px] text-slate-300 backdrop-blur-md transition hover:border-amber-500/50 hover:bg-slate-800 hover:text-white cursor-pointer"
          >
            {preset.label}
          </button>
        ))}
      </div>

      {/* Main Command Input */}
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-2 rounded-2xl border border-slate-700/80 bg-slate-900/92 p-2.5 shadow-2xl shadow-black/60 backdrop-blur-xl sm:flex-row sm:items-center"
      >
        <div className="flex items-center gap-2 rounded-xl border border-slate-700/70 bg-slate-950/70 px-2.5 py-1.5">
          <Terminal className="h-3.5 w-3.5 shrink-0 text-amber-400" />
          <select
            value={selectedTarget?.id || ''}
            onChange={(e) => setTargetId(e.target.value)}
            aria-label="Target bot penerima perintah"
            className="bg-transparent text-xs font-medium text-slate-200 outline-none cursor-pointer"
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id} className="bg-slate-900 text-slate-100">
                @{a.name} {a.canDelegate ? '(Auto-Bagi Tugas)' : '(Langsung)'}
              </option>
            ))}
          </select>
        </div>

        <input
          type="text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Berikan perintah ke tim Muse AI... (misal: Riset ide produk & buatkan rencana teknisnya)"
          className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-sm text-slate-100 placeholder-slate-400 outline-none"
        />

        <button
          type="submit"
          disabled={!prompt.trim() || submitting}
          className="flex items-center justify-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-45 cursor-pointer"
        >
          <Send className="h-3.5 w-3.5" />
          <span>{submitting ? 'Mengirim...' : isRunningMission ? 'Tambah Misi' : 'Kirim Perintah'}</span>
        </button>
      </form>
    </div>
  );
};
