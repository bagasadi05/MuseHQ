import React, { useEffect, useState } from 'react';
import { KeyRound, Save, X } from 'lucide-react';
import { Agent, LLMProvider, PublicSettings } from '../types';

interface SettingsModalProps {
  open: boolean;
  settings: PublicSettings;
  agents: Agent[];
  onClose: () => void;
  onSaveSettings: (patch: Record<string, string>) => Promise<void>;
  onApplyProviderToAll: (provider: LLMProvider) => Promise<void>;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  open,
  settings,
  agents,
  onClose,
  onSaveSettings,
  onApplyProviderToAll,
}) => {
  const [defaultProvider, setDefaultProvider] = useState<LLMProvider>(settings.defaultProvider);
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [anthropicApiKey, setAnthropicApiKey] = useState('');
  const [geminiModel, setGeminiModel] = useState(settings.geminiModel);
  const [openaiModel, setOpenaiModel] = useState(settings.openaiModel);
  const [anthropicModel, setAnthropicModel] = useState(settings.anthropicModel);
  const [bridgeToken, setBridgeToken] = useState(settings.bridgeToken);
  const [applyAll, setApplyAll] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDefaultProvider(settings.defaultProvider);
    setGeminiModel(settings.geminiModel);
    setOpenaiModel(settings.openaiModel);
    setAnthropicModel(settings.anthropicModel);
    setBridgeToken(settings.bridgeToken);
    setGeminiApiKey('');
    setOpenaiApiKey('');
    setAnthropicApiKey('');
  }, [open, settings]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const patch: Record<string, string> = {
        defaultProvider,
        geminiModel,
        openaiModel,
        anthropicModel,
        bridgeToken,
      };
      if (geminiApiKey.trim()) patch.geminiApiKey = geminiApiKey.trim();
      if (openaiApiKey.trim()) patch.openaiApiKey = openaiApiKey.trim();
      if (anthropicApiKey.trim()) patch.anthropicApiKey = anthropicApiKey.trim();

      await onSaveSettings(patch);
      if (applyAll && agents.length > 0) {
        await onApplyProviderToAll(defaultProvider);
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-slate-700/80 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-amber-400" />
            <h2 className="font-display text-sm font-bold text-slate-100">
              Konfigurasi Cloud LLM & API Keys
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-800 hover:text-white cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5 p-5 text-xs">
          <div>
            <label className="mb-1 block font-medium text-slate-300">
              Provider AI Default
            </label>
            <select
              value={defaultProvider}
              onChange={(e) => setDefaultProvider(e.target.value as LLMProvider)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-amber-500"
            >
              <option value="demo">Demo Mode (Simulasi gratis tanpa API Key)</option>
              <option value="gemini">Google Gemini API</option>
              <option value="openai">OpenAI API</option>
              <option value="anthropic">Anthropic Claude API</option>
            </select>
          </div>

          <div className="grid grid-cols-1 gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="font-medium text-sky-300">Google Gemini API Key</label>
                {settings.hasGeminiKey && (
                  <span className="font-mono text-[10px] text-emerald-400">
                    Aktif ({settings.geminiKeyPreview})
                  </span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="password"
                  value={geminiApiKey}
                  onChange={(e) => setGeminiApiKey(e.target.value)}
                  placeholder={settings.hasGeminiKey ? 'Isi untuk mengganti...' : 'AIza...'}
                  className="col-span-2 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-slate-100 outline-none focus:border-amber-500"
                />
                <input
                  type="text"
                  value={geminiModel}
                  onChange={(e) => setGeminiModel(e.target.value)}
                  placeholder="gemini-2.5-flash"
                  className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 font-mono text-slate-200 outline-none"
                />
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="font-medium text-emerald-300">OpenAI API Key</label>
                {settings.hasOpenaiKey && (
                  <span className="font-mono text-[10px] text-emerald-400">
                    Aktif ({settings.openaiKeyPreview})
                  </span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="password"
                  value={openaiApiKey}
                  onChange={(e) => setOpenaiApiKey(e.target.value)}
                  placeholder={settings.hasOpenaiKey ? 'Isi untuk mengganti...' : 'sk-...'}
                  className="col-span-2 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-slate-100 outline-none focus:border-amber-500"
                />
                <input
                  type="text"
                  value={openaiModel}
                  onChange={(e) => setOpenaiModel(e.target.value)}
                  placeholder="gpt-4o-mini"
                  className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 font-mono text-slate-200 outline-none"
                />
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="font-medium text-amber-300">Anthropic Claude API Key</label>
                {settings.hasAnthropicKey && (
                  <span className="font-mono text-[10px] text-emerald-400">
                    Aktif ({settings.anthropicKeyPreview})
                  </span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="password"
                  value={anthropicApiKey}
                  onChange={(e) => setAnthropicApiKey(e.target.value)}
                  placeholder={settings.hasAnthropicKey ? 'Isi untuk mengganti...' : 'sk-ant-...'}
                  className="col-span-2 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-slate-100 outline-none focus:border-amber-500"
                />
                <input
                  type="text"
                  value={anthropicModel}
                  onChange={(e) => setAnthropicModel(e.target.value)}
                  placeholder="claude-sonnet-4-5"
                  className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 font-mono text-slate-200 outline-none"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-slate-400">Token Keamanan External Bot Bridge</label>
            <input
              type="text"
              value={bridgeToken}
              onChange={(e) => setBridgeToken(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 font-mono text-slate-200 outline-none"
            />
          </div>

          <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={applyAll}
              onChange={(e) => setApplyAll(e.target.checked)}
              className="accent-amber-500"
            />
            <span>Terapkan provider default ini ke semua bot built-in di ruangan</span>
          </label>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-700 px-4 py-2 font-medium text-slate-300 hover:bg-slate-800 cursor-pointer"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-50 cursor-pointer"
            >
              <Save className="h-3.5 w-3.5" />
              <span>{saving ? 'Menyimpan...' : 'Simpan Konfigurasi'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
