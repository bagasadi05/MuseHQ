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
  onUpdateBotProvider: (agentId: string, provider: LLMProvider) => Promise<void>;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  open,
  settings,
  agents,
  onClose,
  onSaveSettings,
  onApplyProviderToAll,
  onUpdateBotProvider,
}) => {
  const [defaultProvider, setDefaultProvider] = useState<LLMProvider>(settings.defaultProvider);
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [anthropicApiKey, setAnthropicApiKey] = useState('');
  const [geminiModel, setGeminiModel] = useState(settings.geminiModel);
  const [openaiModel, setOpenaiModel] = useState(settings.openaiModel);
  const [anthropicModel, setAnthropicModel] = useState(settings.anthropicModel);
  const [bridgeToken, setBridgeToken] = useState('');
  const [ownerPasscode, setOwnerPasscode] = useState('');
  const [applyAll, setApplyAll] = useState(true);
  const [botProviders, setBotProviders] = useState<Record<string, LLMProvider>>({});
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const builtinAgents = agents.filter((a) => a.type === 'builtin');

  useEffect(() => {
    if (!open) return;
    setDefaultProvider(settings.defaultProvider);
    setGeminiModel(settings.geminiModel);
    setOpenaiModel(settings.openaiModel);
    setAnthropicModel(settings.anthropicModel);
    setBridgeToken('');
    setOwnerPasscode('');
    setGeminiApiKey('');
    setOpenaiApiKey('');
    setAnthropicApiKey('');
    const nextMap: Record<string, LLMProvider> = {};
    for (const a of agents) {
      if (a.type === 'builtin') nextMap[a.id] = a.provider;
    }
    setBotProviders(nextMap);
    setErrorMsg(null);
  }, [open, settings, agents]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg(null);
    try {
      const patch: Record<string, string> = {
        defaultProvider,
        geminiModel,
        openaiModel,
        anthropicModel,
      };
      if (geminiApiKey.trim()) patch.geminiApiKey = geminiApiKey.trim();
      if (openaiApiKey.trim()) patch.openaiApiKey = openaiApiKey.trim();
      if (anthropicApiKey.trim()) patch.anthropicApiKey = anthropicApiKey.trim();
      if (bridgeToken.trim()) patch.bridgeToken = bridgeToken.trim();
      if (ownerPasscode.trim()) patch.ownerPasscode = ownerPasscode.trim();

      await onSaveSettings(patch);
      if (applyAll && builtinAgents.length > 0) {
        await onApplyProviderToAll(defaultProvider);
      } else if (!applyAll && builtinAgents.length > 0) {
        const changed = builtinAgents.filter(
          (a) => botProviders[a.id] && botProviders[a.id] !== a.provider
        );
        await Promise.all(changed.map((a) => onUpdateBotProvider(a.id, botProviders[a.id])));
      }
      setBridgeToken('');
      setOwnerPasscode('');
      setGeminiApiKey('');
      setOpenaiApiKey('');
      setAnthropicApiKey('');
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menyimpan pengaturan');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl border border-slate-700/80 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-amber-400" />
            <h2 className="font-display text-sm font-bold text-slate-100">
              Konfigurasi Cloud LLM & Keamanan
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

        <form onSubmit={handleSubmit} className="space-y-3.5 overflow-y-auto p-5 text-xs">
          <div>
            <label className="mb-1 block font-medium text-slate-300">Provider AI Default</label>
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
                {settings.hasGeminiKey ? (
                  <span className="font-mono text-[10px] text-emerald-400">
                    Aktif ({settings.geminiKeyPreview})
                  </span>
                ) : (
                  <span className="font-mono text-[10px] text-slate-500">Belum diatur</span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="password"
                  autoComplete="new-password"
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
                {settings.hasOpenaiKey ? (
                  <span className="font-mono text-[10px] text-emerald-400">
                    Aktif ({settings.openaiKeyPreview})
                  </span>
                ) : (
                  <span className="font-mono text-[10px] text-slate-500">Belum diatur</span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="password"
                  autoComplete="new-password"
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
                {settings.hasAnthropicKey ? (
                  <span className="font-mono text-[10px] text-emerald-400">
                    Aktif ({settings.anthropicKeyPreview})
                  </span>
                ) : (
                  <span className="font-mono text-[10px] text-slate-500">Belum diatur</span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <input
                  type="password"
                  autoComplete="new-password"
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

          <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-slate-300">Ganti BOT_BRIDGE_TOKEN</label>
                {settings.hasBridgeToken ? (
                  <span className="font-mono text-[10px] text-emerald-400">
                    {settings.bridgeTokenPreview}
                  </span>
                ) : (
                  <span className="font-mono text-[10px] text-slate-500">Belum diatur</span>
                )}
              </div>
              <input
                type="password"
                autoComplete="new-password"
                value={bridgeToken}
                onChange={(e) => setBridgeToken(e.target.value)}
                placeholder="Isi token baru (min 8 karakter)..."
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-slate-200 outline-none focus:border-amber-500"
              />
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-slate-300">Ganti Owner Passcode</label>
                <span className="font-mono text-[10px] text-emerald-400">
                  {settings.authConfigured ? 'Aktif' : 'Belum diatur'}
                </span>
              </div>
              <input
                type="password"
                autoComplete="new-password"
                value={ownerPasscode}
                onChange={(e) => setOwnerPasscode(e.target.value)}
                placeholder="Kosongkan jika tetap..."
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-slate-200 outline-none focus:border-amber-500"
              />
            </div>
          </div>

          {errorMsg && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-rose-200">
              {errorMsg}
            </div>
          )}

          <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={applyAll}
              onChange={(e) => setApplyAll(e.target.checked)}
              className="accent-amber-500"
            />
            <span>Terapkan provider default ini ke semua bot built-in di ruangan</span>
          </label>

          {!applyAll && builtinAgents.length > 0 && (
            <div className="space-y-1.5 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
              <div className="text-[11px] font-medium text-slate-400">
                Provider Per-Bot (Built-in)
              </div>
              {builtinAgents.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-2">
                  <span className="truncate text-slate-200">{a.name}</span>
                  <select
                    value={botProviders[a.id] || a.provider}
                    onChange={(e) =>
                      setBotProviders((prev) => ({
                        ...prev,
                        [a.id]: e.target.value as LLMProvider,
                      }))
                    }
                    className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-100 outline-none"
                  >
                    <option value="demo">demo</option>
                    <option value="gemini">gemini</option>
                    <option value="openai">openai</option>
                    <option value="anthropic">anthropic</option>
                  </select>
                </div>
              ))}
            </div>
          )}

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
