import React, { useEffect, useState } from 'react';
import { Bot, Plus, X } from 'lucide-react';
import { Agent, AgentType, AvatarVariant, LLMProvider, ZONES_META, ZoneId } from '../types';

interface AddBotModalProps {
  open: boolean;
  defaultProvider: LLMProvider;
  onClose: () => void;
  onCreate: (payload: Partial<Agent>) => Promise<void>;
}

const COLOR_SWATCHES = ['#f59e0b', '#06b6d4', '#10b981', '#ec4899', '#3b82f6', '#a855f7', '#f97316'];

export const AddBotModal: React.FC<AddBotModalProps> = ({
  open,
  defaultProvider,
  onClose,
  onCreate,
}) => {
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [type, setType] = useState<AgentType>('builtin');
  const [provider, setProvider] = useState<LLMProvider>(defaultProvider);
  const [homeZone, setHomeZone] = useState<ZoneId>('engineering-bay');
  const [avatarVariant, setAvatarVariant] = useState<AvatarVariant>('coder');
  const [color, setColor] = useState('#14b8a6');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [canDelegate, setCanDelegate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setProvider(defaultProvider);
    setErrorMsg(null);
  }, [open, defaultProvider]);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !role.trim()) return;
    setSaving(true);
    setErrorMsg(null);
    try {
      await onCreate({
        name: name.trim(),
        role: role.trim(),
        type,
        provider,
        homeZone,
        avatarVariant: type === 'builtin' ? avatarVariant : 'external',
        color,
        webhookUrl: type === 'external-webhook' ? webhookUrl.trim() : undefined,
        systemPrompt: systemPrompt.trim() || undefined,
        canDelegate,
      });
      setName('');
      setRole('');
      setSystemPrompt('');
      setWebhookUrl('');
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Gagal menambahkan bot');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-slate-700/80 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-amber-400" />
            <h2 className="font-display text-sm font-bold text-slate-100">
              Tambah Bot Muse AI ke Ruangan
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

        <form onSubmit={handleSubmit} className="flex flex-col gap-3 p-5 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-slate-400">Nama Bot</label>
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Misal: Muse Finance"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-amber-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-slate-400">Peran / Jabatan</label>
              <input
                required
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder="Misal: Growth & Data Analyst"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-amber-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="mb-1 block text-slate-400">Tipe Koneksi</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as AgentType)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-slate-100 outline-none"
              >
                <option value="builtin">Built-in AI Agent</option>
                <option value="external-ws">External (WebSocket)</option>
                <option value="external-rest">External (REST Polling)</option>
                <option value="external-webhook">External (Webhook)</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-slate-400">Mesin AI</label>
              <select
                disabled={type !== 'builtin'}
                value={provider}
                onChange={(e) => setProvider(e.target.value as LLMProvider)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-slate-100 outline-none disabled:opacity-45"
              >
                <option value="demo">Demo / Simulasi</option>
                <option value="gemini">Google Gemini</option>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic Claude</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-slate-400">Zona Meja</label>
              <select
                value={homeZone}
                onChange={(e) => setHomeZone(e.target.value as ZoneId)}
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-slate-100 outline-none"
              >
                {ZONES_META.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {type === 'builtin' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-slate-400">Gaya Karakter</label>
                <select
                  value={avatarVariant}
                  onChange={(e) => setAvatarVariant(e.target.value as AvatarVariant)}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-slate-100 outline-none"
                >
                  <option value="coder">Coder (Visor)</option>
                  <option value="researcher">Researcher (Scanner)</option>
                  <option value="creative">Creative (Beret)</option>
                  <option value="qa">QA Specialist</option>
                  <option value="lead">Commander (Crown)</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-slate-400">Warna Karakter</label>
                <div className="flex items-center gap-1.5 pt-1.5">
                  {COLOR_SWATCHES.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      className={`h-6 w-6 rounded-full border-2 transition cursor-pointer ${
                        color === c ? 'scale-110 border-white' : 'border-transparent opacity-75'
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          {type === 'external-webhook' && (
            <div>
              <label className="mb-1 block text-slate-400">Webhook Endpoint Bot Eksternal</label>
              <input
                type="url"
                required
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="http://localhost:4000/muse-task"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-slate-100 outline-none focus:border-amber-500"
              />
            </div>
          )}

          <div>
            <label className="mb-1 block text-slate-400">
              System Prompt / Kepribadian Bot (opsional)
            </label>
            <textarea
              rows={3}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="Jelaskan cara kerja dan keahlian bot ini saat menerima tugas..."
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 outline-none focus:border-amber-500"
            />
          </div>

          <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={canDelegate}
              onChange={(e) => setCanDelegate(e.target.checked)}
              className="accent-amber-500"
            />
            <span>Izinkan bot ini memberi perintah & mendelegasikan tugas ke bot lain</span>
          </label>

          {errorMsg && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-rose-200">
              {errorMsg}
            </div>
          )}

          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-700 px-4 py-2 font-medium text-slate-300 transition hover:bg-slate-800 cursor-pointer"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-4 py-2 font-semibold text-slate-950 transition hover:bg-amber-400 disabled:opacity-50 cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{saving ? 'Menambahkan...' : 'Masukkan ke Ruangan'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
