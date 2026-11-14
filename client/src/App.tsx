import React, { useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Cpu,
  KeyRound,
  Lock,
  LogOut,
  PanelRightClose,
  PanelRightOpen,
  Plug,
  Plus,
  ShieldCheck,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { AddBotModal } from './components/AddBotModal';
import { BridgeModal } from './components/BridgeModal';
import { CommandBar } from './components/CommandBar';
import { OfficeCanvas } from './components/OfficeCanvas';
import { ReportModal } from './components/ReportModal';
import { RightPanel } from './components/RightPanel';
import { SettingsModal } from './components/SettingsModal';
import { useMuseSocket } from './hooks/useMuseSocket';
import { LLMProvider, Mission } from './types';

export default function App() {
  const {
    authStatus,
    authError,
    isServerless,
    connected,
    transportMode,
    agents,
    missions,
    tasks,
    comms,
    beams,
    settings,
    stateResetNotice,
    dismissResetNotice,
    login,
    logout,
    launchMission,
    createAgent,
    updateAgent,
    deleteAgent,
    moveAgent,
    sendBotCommand,
    triggerAllHands,
    updateSettings,
    clearHistory,
    resetWorkspace,
    cancelTask,
    markTaskFailed,
    reassignTask,
  } = useMuseSocket();

  const [passcodeInput, setPasscodeInput] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [showAddBot, setShowAddBot] = useState(false);
  const [showBridge, setShowBridge] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [reportMission, setReportMission] = useState<Mission | null>(null);
  const [toastError, setToastError] = useState<string | null>(null);
  const [dismissEmptyGuide, setDismissEmptyGuide] = useState(false);

  const onlineCount = agents.filter((a) => a.status !== 'offline').length;
  const workingCount = agents.filter(
    (a) => a.status === 'working' || a.status === 'thinking'
  ).length;
  const isRunningMission = missions.some((m) => m.status === 'running');

  const showError = (msg: string) => {
    setToastError(msg);
    setTimeout(() => setToastError(null), 4000);
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passcodeInput.trim() || loggingIn) return;
    setLoggingIn(true);
    try {
      await login(passcodeInput.trim());
      setPasscodeInput('');
    } catch {
      // authError state displayed below input
    } finally {
      setLoggingIn(false);
    }
  };

  const handleLaunchMission = async (prompt: string, targetId: string): Promise<boolean> => {
    try {
      await launchMission(prompt, targetId);
      return true;
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Gagal mengirim perintah');
      return false;
    }
  };

  const handleApplyProviderToAll = async (provider: LLMProvider) => {
    const builtins = agents.filter((a) => a.type === 'builtin');
    await Promise.all(builtins.map((a) => updateAgent(a.id, { provider })));
  };

  const hasActiveProviderKey =
    (settings.defaultProvider === 'gemini' && settings.hasGeminiKey) ||
    (settings.defaultProvider === 'openai' && settings.hasOpenaiKey) ||
    (settings.defaultProvider === 'anthropic' && settings.hasAnthropicKey);

  const providerLabel = !hasActiveProviderKey
    ? 'External Bridge'
    : settings.defaultProvider === 'gemini'
      ? 'Gemini API'
      : settings.defaultProvider === 'openai'
        ? 'OpenAI API'
        : 'Claude API';

  if (authStatus !== 'authenticated') {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-950 p-4 text-slate-100">
        <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/95 p-6 shadow-2xl">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 text-slate-950 shadow-lg shadow-amber-500/20">
              <Bot className="h-5 w-5" />
            </div>
            <div>
              <h1 className="font-display text-base font-bold text-white">MuseHQ Virtual Office</h1>
              <p className="text-xs text-slate-400">Akses Ruangan Terproteksi Pemilik</p>
            </div>
          </div>

          {authStatus === 'checking' && (
            <div className="py-6 text-center text-xs text-slate-400">
              Memeriksa sesi autentikasi...
            </div>
          )}

          {authStatus === 'setup-required' && (
            <div className="space-y-3 rounded-xl border border-amber-500/35 bg-amber-500/10 p-4 text-xs text-amber-100">
              <div className="font-semibold text-amber-300">
                Konfigurasi Keamanan Server Diperlukan
              </div>
              <p className="leading-relaxed text-amber-200/90">
                Server {isServerless ? 'serverless Vercel' : 'Node'} berjalan tanpa{' '}
                <code className="font-mono">MUSE_OWNER_PASSCODE</code>. Tambahkan environment
                variable berikut di Vercel Project Settings (atau <code className="font-mono">server/.env</code>) lalu redeploy:
              </p>
              <pre className="overflow-x-auto rounded-lg bg-slate-950 p-2.5 font-mono text-[11px] text-slate-200">
{`MUSE_OWNER_PASSCODE=<passcode-rahasia-kamu>
BOT_BRIDGE_TOKEN=<token-acak-bridge-kamu>
SESSION_SECRET=<string-acak-32-karakter>`}
              </pre>
            </div>
          )}

          {authStatus === 'locked' && (
            <form onSubmit={handleLoginSubmit} className="space-y-3.5 text-xs">
              <p className="leading-relaxed text-slate-300">
                State ruangan kerja dan komunikasi bot dilindungi sesi pemilik. Masukkan{' '}
                <code className="font-mono text-amber-300">MUSE_OWNER_PASSCODE</code> untuk
                membuka kantor virtual.
              </p>

              <div>
                <label className="mb-1.5 flex items-center gap-1.5 font-medium text-slate-300">
                  <Lock className="h-3.5 w-3.5 text-amber-400" />
                  <span>Owner Passcode</span>
                </label>
                <input
                  type="password"
                  required
                  autoFocus
                  value={passcodeInput}
                  onChange={(e) => setPasscodeInput(e.target.value)}
                  placeholder="Masukkan owner passcode..."
                  className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-xs text-slate-100 outline-none focus:border-amber-500"
                />
              </div>

              {authError && (
                <div className="rounded-lg border border-rose-500/40 bg-rose-950/40 px-3 py-2 text-rose-200">
                  {authError}
                </div>
              )}

              <button
                type="submit"
                disabled={!passcodeInput.trim() || loggingIn}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2.5 text-xs font-semibold text-slate-950 transition hover:bg-amber-400 disabled:opacity-50 cursor-pointer"
              >
                <ShieldCheck className="h-4 w-4" />
                <span>{loggingIn ? 'Memverifikasi...' : 'Buka MuseHQ'}</span>
              </button>

              <p className="text-[11px] leading-relaxed text-slate-500">
                Menjalankan secara lokal pertama kali? Cek terminal server{' '}
                <code className="font-mono">npm run dev</code> atau file{' '}
                <code className="font-mono">server/.env</code>.
              </p>
            </form>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-slate-950 text-slate-100">
      {/* Top Studio Header */}
      <header className="flex h-13 shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900/95 px-4 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 text-slate-950 shadow-lg shadow-amber-500/20">
            <Bot className="h-4.5 w-4.5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-display text-sm font-bold tracking-tight text-white">MuseHQ</h1>
              <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] font-medium text-amber-300">
                VIRTUAL OFFICE
              </span>
            </div>
            <p className="hidden text-[11px] text-slate-400 sm:block">
              Ruangan kerja terpadu untuk delegasi & kolaborasi tim bot Muse AI
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Live Status Pills */}
          <div className="hidden items-center gap-2 lg:flex">
            <span
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-medium ${
                connected
                  ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-300'
                  : 'border-rose-500/35 bg-rose-500/10 text-rose-300'
              }`}
            >
              {connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
              <span>
                {connected ? (transportMode === 'cloud' ? 'Cloud Sync' : 'Live Sync') : 'Reconnecting'}
              </span>
            </span>

            <span className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-[11px] text-slate-300">
              <Cpu className="h-3 w-3 text-sky-400" />
              <span>{providerLabel}</span>
            </span>

            <span className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 font-mono text-[11px] text-slate-300">
              {onlineCount}/{agents.length} Online
              {workingCount > 0 ? ` • ${workingCount} Aktif` : ''}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setShowAddBot(true)}
            className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-amber-400 cursor-pointer"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Tambah Bot</span>
          </button>

          <button
            type="button"
            onClick={() => setShowBridge(true)}
            className="flex items-center gap-1.5 rounded-lg border border-purple-500/40 bg-purple-500/10 px-2.5 py-1.5 text-xs font-medium text-purple-200 transition hover:bg-purple-500/20 cursor-pointer"
          >
            <Plug className="h-3.5 w-3.5" />
            <span className="hidden md:inline">External Bridge</span>
          </button>

          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800/80 px-2.5 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-700 cursor-pointer"
          >
            <KeyRound className="h-3.5 w-3.5 text-amber-300" />
            <span className="hidden md:inline">API Keys</span>
          </button>

          <button
            type="button"
            onClick={() => void logout()}
            className="rounded-lg border border-slate-700 bg-slate-800/80 p-1.5 text-slate-300 transition hover:bg-slate-700 hover:text-amber-300 cursor-pointer"
            title="Kunci sesi ruangan"
            aria-label="Kunci sesi"
          >
            <LogOut className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => setPanelOpen((v) => !v)}
            className="rounded-lg border border-slate-700 bg-slate-800/80 p-1.5 text-slate-300 transition hover:bg-slate-700 hover:text-white cursor-pointer"
            title={panelOpen ? 'Sembunyikan panel kanan' : 'Tampilkan panel kanan'}
          >
            {panelOpen ? (
              <PanelRightClose className="h-4 w-4" />
            ) : (
              <PanelRightOpen className="h-4 w-4" />
            )}
          </button>
        </div>
      </header>

      {stateResetNotice && (
        <div
          role="status"
          className="flex shrink-0 items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-950/90 px-4 py-2 text-xs text-amber-100"
        >
          <div className="flex min-w-0 items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
            <div className="min-w-0">
              <span className="font-semibold">{stateResetNotice}</span>{' '}
              <span className="text-amber-200/85">
                Pasang Render Disk (/data) atau jalankan bot Anda lagi untuk menyambung ulang.
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={dismissResetNotice}
            className="shrink-0 rounded p-1 text-amber-300 transition hover:bg-amber-900/60 cursor-pointer"
            aria-label="Tutup peringatan reset"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Main Workspace Area */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* Left / Center Isometric Virtual Office Viewport */}
        <main className="relative min-w-0 flex-1">
          <OfficeCanvas
            agents={agents}
            beams={beams}
            selectedAgentId={selectedAgentId}
            onSelectAgent={(id) => {
              setSelectedAgentId(id);
              if (id && !panelOpen) setPanelOpen(true);
            }}
            onMoveAgent={(id, zone) => void moveAgent(id, zone)}
            onAllHands={(mode) => void triggerAllHands(mode)}
          />

          <CommandBar
            agents={agents}
            onLaunchMission={handleLaunchMission}
            isRunningMission={isRunningMission}
          />

          {agents.length === 0 && !dismissEmptyGuide && (
            <div className="pointer-events-none absolute inset-x-4 top-1/2 z-20 flex -translate-y-1/2 justify-center">
              <div className="pointer-events-auto relative w-full max-w-md rounded-2xl border border-slate-700/80 bg-slate-900/92 p-5 text-center shadow-2xl shadow-black/60 backdrop-blur-xl">
                <button
                  type="button"
                  onClick={() => setDismissEmptyGuide(true)}
                  className="absolute top-3 right-3 rounded-lg p-1 text-slate-400 transition hover:bg-slate-800 hover:text-white cursor-pointer"
                  aria-label="Tutup panduan"
                >
                  <X className="h-4 w-4" />
                </button>
                <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-purple-500/40 bg-purple-500/15 text-purple-300">
                  <Plug className="h-5 w-5" />
                </div>
                <h2 className="font-display text-sm font-bold text-white">
                  Ruangan Kerja Kosong — Siap Koneksi Bot Nyata
                </h2>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                  Tidak ada bot simulator bawaan. Hubungkan Muse nyata Anda via External Bridge
                  (WebSocket / REST Polling) atau tambahkan bot Cloud LLM (Gemini / OpenAI / Claude).
                </p>
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowBridge(true)}
                    className="flex items-center gap-1.5 rounded-xl bg-purple-500 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-purple-400 cursor-pointer"
                  >
                    <Plug className="h-3.5 w-3.5" />
                    <span>Hubungkan External Bridge</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAddBot(true)}
                    className="flex items-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2 text-xs font-semibold text-amber-200 transition hover:bg-amber-500/20 cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Tambah Bot Manual</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {toastError && (
            <div className="absolute top-14 left-1/2 z-30 -translate-x-1/2 rounded-xl border border-rose-500/50 bg-rose-950/90 px-4 py-2 text-xs font-medium text-rose-200 shadow-xl backdrop-blur-md">
              {toastError}
            </div>
          )}
        </main>

        {/* Right Docked Comms / Tasks / Inspector Panel */}
        {panelOpen && (
          <div className="h-full w-80 shrink-0 sm:w-96 xl:w-[410px]">
            <RightPanel
              agents={agents}
              missions={missions}
              tasks={tasks}
              comms={comms}
              selectedAgentId={selectedAgentId}
              onSelectAgent={setSelectedAgentId}
              onUpdateAgent={async (id, patch) => {
                await updateAgent(id, patch);
              }}
              onDeleteAgent={async (id) => {
                await deleteAgent(id);
                if (selectedAgentId === id) setSelectedAgentId(null);
              }}
              onMoveAgent={async (id, zone) => {
                await moveAgent(id, zone);
              }}
              onSendBotCommand={async (fromId, toId, content, createTask, title) => {
                await sendBotCommand(fromId, toId, content, createTask, title);
              }}
              onCancelTask={async (taskId) => {
                try {
                  await cancelTask(taskId);
                } catch (err) {
                  showError(err instanceof Error ? err.message : 'Gagal membatalkan tugas');
                }
              }}
              onMarkTaskFailed={async (taskId, reason) => {
                try {
                  await markTaskFailed(taskId, reason);
                } catch (err) {
                  showError(err instanceof Error ? err.message : 'Gagal menandai tugas gagal');
                }
              }}
              onReassignTask={async (taskId, targetAgentId) => {
                try {
                  await reassignTask(taskId, targetAgentId);
                } catch (err) {
                  showError(err instanceof Error ? err.message : 'Gagal menugaskan ulang');
                }
              }}
              onOpenReport={(m) => setReportMission(m)}
              onClearHistory={async () => {
                await clearHistory();
              }}
              onResetWorkspace={async () => {
                await resetWorkspace();
              }}
            />
          </div>
        )}
      </div>

      {/* Modals */}
      <AddBotModal
        open={showAddBot}
        defaultProvider={settings.defaultProvider}
        onClose={() => setShowAddBot(false)}
        onCreate={async (payload) => {
          await createAgent(payload);
        }}
      />

      <BridgeModal
        open={showBridge}
        bridgeTokenPreview={settings.bridgeTokenPreview}
        agents={agents}
        onClose={() => setShowBridge(false)}
      />

      <SettingsModal
        open={showSettings}
        settings={settings}
        agents={agents}
        onClose={() => setShowSettings(false)}
        onSaveSettings={async (patch) => {
          await updateSettings(patch);
        }}
        onApplyProviderToAll={handleApplyProviderToAll}
        onUpdateBotProvider={async (agentId, provider) => {
          await updateAgent(agentId, { provider });
        }}
      />

      <ReportModal mission={reportMission} onClose={() => setReportMission(null)} />
    </div>
  );
}
