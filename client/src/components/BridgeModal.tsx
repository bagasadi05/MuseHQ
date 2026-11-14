import React, { useState } from 'react';
import { Check, Copy, Plug, ShieldAlert, X } from 'lucide-react';
import { Agent } from '../types';
import { getAgentBrainBadge } from '../utils/brainBadge';

interface BridgeModalProps {
  open: boolean;
  bridgeTokenPreview: string;
  agents: Agent[];
  onClose: () => void;
}

type GuideTab = 'ws' | 'rest' | 'peers';

export const BridgeModal: React.FC<BridgeModalProps> = ({
  open,
  bridgeTokenPreview,
  agents,
  onClose,
}) => {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [tab, setTab] = useState<GuideTab>('ws');
  if (!open) return null;

  const isLocal =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3001';
  const wsBase = isLocal
    ? `ws://${host}:3001/ws/bot`
    : `${origin.replace(/^http/, 'ws')}/ws/bot`;
  const apiBase = isLocal ? `http://${host}:3001/api` : `${origin}/api`;

  const wsSnippet = `// Jalankan contoh resmi langsung dari root repo:
// BOT_BRIDGE_TOKEN=<token-dari-env> npm run example:bot

const TOKEN = process.env.BOT_BRIDGE_TOKEN;
const ws = new WebSocket('${wsBase}?token=' + encodeURIComponent(TOKEN));

ws.addEventListener('open', () => {
  ws.send(JSON.stringify({
    event: 'bot:hello',
    payload: {
      id: 'muse-external-ops',
      name: 'Muse External Ops',
      role: 'Automation & Integration Bot',
      homeZone: 'qa-bench',
      color: '#a855f7',
      canDelegate: true
    }
  }));
});

ws.addEventListener('message', (evt) => {
  const { event, payload } = JSON.parse(String(evt.data));
  if (event === 'task:assigned') {
    ws.send(JSON.stringify({
      event: 'task:complete',
      payload: {
        taskId: payload.taskId,
        speech: 'Tugas eksternal selesai!',
        result: 'Deliverable Markdown untuk ' + payload.title
      }
    }));
  }
});`;

  const restSnippet = `# 1. Registrasi / Bot Hello via REST (jalur polling tanpa WebSocket)
curl -X POST ${apiBase}/bridge/bots/muse-rest-scout/event \\
  -H "Content-Type: application/json" \\
  -H "x-muse-token: $BOT_BRIDGE_TOKEN" \\
  -d '{"event":"bot:hello","payload":{"name":"Muse REST Scout","role":"Polling Specialist","homeZone":"qa-bench","canDelegate":false}}'

# 2. Baca state ruangan atau poll event baru pakai cursor ?since=<seq>
curl -H "x-muse-token: $BOT_BRIDGE_TOKEN" "${apiBase}/state?since=0"
curl -H "x-muse-token: $BOT_BRIDGE_TOKEN" "${apiBase}/bridge/bots/muse-rest-scout/events?since=0"

# 3. Kirim status / selesai tugas (sertakan eventId opsional untuk deduplikasi)
curl -X POST ${apiBase}/bridge/bots/muse-rest-scout/event \\
  -H "Content-Type: application/json" \\
  -H "x-muse-token: $BOT_BRIDGE_TOKEN" \\
  -d '{"event":"task:complete","eventId":"done-1","payload":{"taskId":"task-id","speech":"Selesai!","result":"Laporan Markdown"}}'`;

  const peersSnippet = `// 1. Hubungkan sekaligus 4 agen (muse-bagas, muse-arif, muse-niro, muse-joni):
// Salin .env.bridge.example -> .env.bridge, isi BOT_BRIDGE_TOKEN (& API key / UPSTREAM_URL bila ada)
// lalu jalankan dari root repo:
//   MUSE_WS_URL="${wsBase}" npm run bridge:team

// 2. Atau jalankan terpisah per mesin/personil:
//   BOT_BRIDGE_TOKEN=<token> MUSE_WS_URL="${wsBase}" npm run bridge:bot -- --bot=muse-bagas
//   BOT_BRIDGE_TOKEN=<token> MUSE_WS_URL="${wsBase}" npm run bridge:bot -- --bot=muse-arif
//   BOT_BRIDGE_TOKEN=<token> MUSE_WS_URL="${wsBase}" npm run bridge:bot -- --bot=muse-niro
//   BOT_BRIDGE_TOKEN=<token> MUSE_WS_URL="${wsBase}" npm run bridge:bot -- --bot=muse-joni

const REAL_AGENTS = [
  { id: 'muse-bagas', name: 'Muse Bagas', role: 'Lead Architect',    homeZone: 'command-desk',     color: '#f59e0b', canDelegate: true },
  { id: 'muse-arif',  name: 'Muse Arif',  role: 'Research & Strategy', homeZone: 'research-library', color: '#06b6d4', canDelegate: true },
  { id: 'muse-niro',  name: 'Muse Niro',  role: 'Creative & QA Lead',  homeZone: 'creative-studio',  color: '#ec4899', canDelegate: true },
  { id: 'muse-joni',  name: 'Muse Joni',  role: 'Systems Engineer',  homeZone: 'engineering-bay',  color: '#10b981', canDelegate: true },
];`;

  const copyText = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1600);
  };

  const externalBots = agents.filter((a) => a.type !== 'builtin');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-2xl border border-slate-700/80 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Plug className="h-4 w-4 text-purple-400" />
            <h2 className="font-display text-sm font-bold text-slate-100">
              External Bot Bridge (WebSocket & REST API)
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

        <div className="flex-1 space-y-4 overflow-y-auto p-5 text-xs">
          <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-amber-200">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
            <div className="leading-relaxed">
              Demi keamanan, nilai asli <code className="font-mono">BOT_BRIDGE_TOKEN</code>{' '}
              ({bridgeTokenPreview || 'aktif di server'}) <strong>tidak ditampilkan di UI</strong>.
              Baca dari file <code className="font-mono">server/.env</code>,{' '}
              <code className="font-mono">server/data/settings.json</code>, atau Environment Variables
              deployment kamu saat menjalankan bot eksternal.
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
            <div className="mb-1 text-[11px] font-semibold text-slate-400">
              Status Bot Eksternal Terdaftar ({externalBots.length})
            </div>
            {externalBots.length === 0 ? (
              <div className="text-slate-500">
                Belum ada bot eksternal terhubung. Coba jalankan{' '}
                <code className="rounded bg-slate-800 px-1.5 py-0.5 text-amber-300">
                  BOT_BRIDGE_TOKEN=&lt;token&gt; npm run example:bot
                </code>{' '}
                di terminal!
              </div>
            ) : (
              <div className="flex flex-wrap gap-2 pt-1">
                {externalBots.map((b) => {
                  const brain = getAgentBrainBadge(b);
                  return (
                    <span
                      key={b.id}
                      className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1"
                    >
                      <span
                        className={`h-2 w-2 rounded-full ${
                          b.status === 'offline' ? 'bg-rose-500' : 'bg-emerald-400'
                        }`}
                      />
                      <span className="font-semibold text-slate-200">{b.name}</span>
                      <span className="text-slate-500">
                        ({b.id} • {b.type})
                      </span>
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${brain.cls}`}>
                        {brain.label}
                      </span>
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          {/* Protocol Tabs */}
          <div className="flex gap-1.5 border-b border-slate-800 pb-2">
            <button
              type="button"
              onClick={() => setTab('ws')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                tab === 'ws'
                  ? 'bg-purple-500/20 text-purple-200 border border-purple-500/40'
                  : 'text-slate-400 hover:bg-slate-800'
              }`}
            >
              WebSocket (/ws/bot)
            </button>
            <button
              type="button"
              onClick={() => setTab('rest')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                tab === 'rest'
                  ? 'bg-sky-500/20 text-sky-200 border border-sky-500/40'
                  : 'text-slate-400 hover:bg-slate-800'
              }`}
            >
              REST Polling (/api/bridge)
            </button>
            <button
              type="button"
              onClick={() => setTab('peers')}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition cursor-pointer ${
                tab === 'peers'
                  ? 'bg-amber-500/20 text-amber-200 border border-amber-500/40'
                  : 'text-slate-400 hover:bg-slate-800'
              }`}
            >
              Agen Rekan (Bagas/Arif/Joni/Niro)
            </button>
          </div>

          {tab === 'ws' && (
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="font-semibold text-purple-300">
                  Jalur Utama: Real-time WebSocket Bridge
                </span>
                <button
                  type="button"
                  onClick={() => copyText('ws', wsSnippet)}
                  className="flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700 cursor-pointer"
                >
                  {copiedKey === 'ws' ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-400" />
                      <span>Tersalin</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      <span>Salin Kode</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-300">
                {wsSnippet}
              </pre>
            </div>
          )}

          {tab === 'rest' && (
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="font-semibold text-sky-300">
                  Jalur Cadangan: REST Polling (atau jalankan npm run example:rest-bot)
                </span>
                <button
                  type="button"
                  onClick={() => copyText('rest', restSnippet)}
                  className="flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700 cursor-pointer"
                >
                  {copiedKey === 'rest' ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-400" />
                      <span>Tersalin</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      <span>Salin cURL</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-300">
                {restSnippet}
              </pre>
            </div>
          )}

          {tab === 'peers' && (
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <span className="font-semibold text-amber-300">
                  Preset ID Rekan Nyata di MuseHQ
                </span>
                <button
                  type="button"
                  onClick={() => copyText('peers', peersSnippet)}
                  className="flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-200 hover:bg-slate-700 cursor-pointer"
                >
                  {copiedKey === 'peers' ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-400" />
                      <span>Tersalin</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      <span>Salin Preset</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-300">
                {peersSnippet}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
