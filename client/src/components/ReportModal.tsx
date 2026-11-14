import React, { useEffect, useRef, useState } from 'react';
import { Check, Clock, Copy, FileText, X } from 'lucide-react';
import { Mission } from '../types';
import { cleanDisplayText } from '../utils/textClean';
import { MarkdownView } from './MarkdownView';

export interface ReportModalProps {
  mission: Mission | null;
  onClose: () => void;
}

const MISSION_STATUS_STYLE: Record<Mission['status'], { label: string; cls: string }> = {
  completed: {
    label: 'Selesai',
    cls: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300',
  },
  failed: {
    label: 'Gagal',
    cls: 'border-rose-500/40 bg-rose-500/15 text-rose-300',
  },
  running: {
    label: 'Berjalan',
    cls: 'border-amber-500/40 bg-amber-500/15 text-amber-300',
  },
};

function formatTimestamp(iso?: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const ReportModal: React.FC<ReportModalProps> = ({ mission, onClose }) => {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    setCopied(false);
    if (!mission) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [mission, onClose]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  if (!mission) return null;

  const cleanedPrompt = cleanDisplayText(mission.prompt, {
    stripMarkdown: true,
    singleLine: true,
  });
  const statusMeta = MISSION_STATUS_STYLE[mission.status] || MISSION_STATUS_STYLE.running;
  const timeLabel = formatTimestamp(mission.completedAt || mission.createdAt);

  const handleCopy = () => {
    if (!mission.finalSummary) return;
    try {
      void navigator.clipboard?.writeText(mission.finalSummary);
      setCopied(true);
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
      timerRef.current = window.setTimeout(() => {
        setCopied(false);
        timerRef.current = null;
      }, 1600);
    } catch {
      // Clipboard API may be unavailable in restricted contexts
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-modal-title"
    >
      <div
        className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-700/80 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-800/90 bg-slate-900/95 px-6 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/15 text-emerald-300">
              <FileText className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h2
                id="report-modal-title"
                className="font-display text-sm font-bold tracking-tight text-slate-100"
              >
                Laporan Akhir Misi Tim Muse AI
              </h2>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                <span
                  className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold ${statusMeta.cls}`}
                >
                  {statusMeta.label}
                </span>
                <span className="rounded-md border border-slate-800 bg-slate-950/70 px-2 py-0.5 font-mono text-[10px] text-slate-300">
                  Target: {mission.targetAgentId}
                </span>
                {timeLabel && (
                  <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                    <Clock className="h-3 w-3 text-slate-500" />
                    <span>{timeLabel}</span>
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              disabled={!mission.finalSummary}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-700 hover:text-white disabled:cursor-not-allowed disabled:opacity-45 cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="text-emerald-300">Disalin</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  <span>Salin Markdown</span>
                </>
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Tutup laporan"
              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-white cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <div className="rounded-xl border border-slate-800/90 bg-slate-950/90 px-4 py-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-300/90">
              Perintah Awal
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-slate-200">
              {cleanedPrompt || 'Perintah tidak tersedia.'}
            </p>
          </div>

          <div className="rounded-xl border border-slate-800/90 bg-slate-950/75 px-5 py-4">
            <MarkdownView content={mission.finalSummary || 'Belum ada ringkasan akhir.'} />
          </div>
        </div>
      </div>
    </div>
  );
};
