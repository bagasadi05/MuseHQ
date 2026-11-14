import React, { useState } from 'react';
import { Check, Copy, FileText, X } from 'lucide-react';
import { Mission } from '../types';

interface ReportModalProps {
  mission: Mission | null;
  onClose: () => void;
}

export const ReportModal: React.FC<ReportModalProps> = ({ mission, onClose }) => {
  const [copied, setCopied] = useState(false);
  if (!mission) return null;

  const handleCopy = () => {
    if (!mission.finalSummary) return;
    navigator.clipboard.writeText(mission.finalSummary);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
      <div className="flex max-h-[88vh] w-full max-w-3xl flex-col rounded-2xl border border-slate-700/80 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-emerald-400" />
            <h2 className="font-display text-sm font-bold text-slate-100">
              Laporan Akhir Misi Tim Muse AI
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-700 cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                  <span>Disalin</span>
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
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          <div className="mb-4 rounded-xl border border-slate-800 bg-slate-950 p-3 text-xs text-slate-300">
            <span className="font-semibold text-amber-300">Perintah Awal: </span>
            {mission.prompt}
          </div>
          <div className="whitespace-pre-wrap rounded-xl border border-slate-800 bg-slate-950/70 p-4 text-xs leading-relaxed text-slate-200">
            {mission.finalSummary || 'Belum ada ringkasan akhir.'}
          </div>
        </div>
      </div>
    </div>
  );
};
