import { useState } from 'react';
import {
  Bot,
  Cpu,
  KeyRound,
  PanelRightClose,
  PanelRightOpen,
  Plug,
  Plus,
  Wifi,
  WifiOff,
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
    connected,
    agents,
    missions,
    tasks,
    comms,
    beams,
    settings,
    launchMission,
    createAgent,
    updateAgent,
    deleteAgent,
    moveAgent,
    sendBotCommand,
    triggerAllHands,
    updateSettings,
    clearHistory,
  } = useMuseSocket();

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [showAddBot, setShowAddBot] = useState(false);
  const [showBridge, setShowBridge] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [reportMission, setReportMission] = useState<Mission | null>(null);
  const [toastError, setToastError] = useState<string | null>(null);

  const onlineCount = agents.filter((a) => a.status !== 'offline').length;
  const workingCount = agents.filter(
    (a) => a.status === 'working' || a.status === 'thinking'
  ).length;
  const isRunningMission = missions.some((m) => m.status === 'running');

  const showError = (msg: string) => {
    setToastError(msg);
    setTimeout(() => setToastError(null), 4000);
  };

  const handleLaunchMission = async (prompt: string, targetId: string) => {
    try {
      await launchMission(prompt, targetId);
    } catch (err) {
      showError(err instanceof Error ? err.message : 'Gagal mengirim perintah');
    }
  };

  const handleApplyProviderToAll = async (provider: LLMProvider) => {
    const builtins = agents.filter((a) => a.type === 'builtin');
    await Promise.all(builtins.map((a) => updateAgent(a.id, { provider })));
  };

  const providerLabel =
    settings.defaultProvider === 'demo'
      ? 'Demo Simulator'
      : settings.defaultProvider === 'gemini'
        ? 'Gemini API'
        : settings.defaultProvider === 'openai'
          ? 'OpenAI API'
          : 'Claude API';

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
              <h1 className="font-display text-sm font-bold tracking-tight text-white">
                MuseHQ
              </h1>
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
              <span>{connected ? 'Live Sync' : 'Reconnecting'}</span>
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
              onOpenReport={(m) => setReportMission(m)}
              onClearHistory={async () => {
                await clearHistory();
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
        bridgeToken={settings.bridgeToken}
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
      />

      <ReportModal mission={reportMission} onClose={() => setReportMission(null)} />
    </div>
  );
}
