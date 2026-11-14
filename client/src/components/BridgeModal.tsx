import React, { useState } from 'react';
import { Check, Copy, Plug, X } from 'lucide-react';
import { Agent } from '../types';

interface BridgeModalProps {
  open: boolean;
  bridgeToken: string;
  agents: Agent[];
  onClose: () => void;
}

export const BridgeModal: React.FC<BridgeModalProps> = ({
  open,
  bridgeToken,
  agents,
  onClose,
}) => {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  if (!open) return null;

  const isLocal =
    typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
  const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3001';
  const wsUrl = isLocal
    ? `ws://${host}:3001/ws/bot?token=${bridgeToken}`
    : `ws://localhost:3001/ws/bot?token=${bridgeToken}`;
  const restUrl = isLocal ? `http://${host}:3001/api/bridge` : `${origin}/api/bridge`;

  const wsSnippet = `// Jalankan contoh bot eksternal langsung dari root project:
// npm run example:bot

import WebSocket from 'ws';

const ws = new WebSocket('${wsUrl}');
ws.on('open', () => {
  ws.send(JSON.stringify({
    event: 'bot:hello',
    payload: {
      id: 'muse-telegram-bot',
      name: 'Muse Connector',
      role: 'External Bot Specialist',
      homeZone: 'qa-bench',
      color: '#a855f7',
      canDelegate: true
    }
  }));
});

ws.on('message', (raw) => {
  const { event, payload } = JSON.parse(raw.toString());
  if (event === 'task:assigned') {
    // Kerjakan tugas lalu kirim hasilnya kembali ke ruangan:
    ws.send(JSON.stringify({
      event: 'task:complete',
      payload: {
        taskId: payload.taskId,
        speech: 'Tugas dari bot eksternal selesai!',
        result: 'Hasil proses dari script eksternal untuk: ' + payload.title
      }
    }));
  }
});`;

  const restSnippet = `# 1. Daftarkan bot eksternal via REST
curl -X POST ${restUrl}/register \\
  -H "Content-Type: application/json" \\
  -H "x-muse-token: ${bridgeToken}" \\
  -d '{"name":"Muse n8n","role":"Automation Bot","homeZone":"qa-bench","webhookUrl":"http://localhost:5678/webhook/muse"}'

# 2. Kirim event atau perintah antar-bot dari luar
curl -X POST ${restUrl}/bots/muse-n8n/event \\
  -H "Content-Type: application/json" \\
  -H "x-muse-token: ${bridgeToken}" \\
  -d '{"event":"task:delegate","payload":{"toAgentId":"muse-dev","title":"Sync DB","instructions":"Buat endpoint /sync"}}'`;

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
          <p className="leading-relaxed text-slate-300">
            Punya bot Muse AI yang jalan terpisah (script Python/Node, bot Discord/Telegram, atau
            workflow n8n)? Sambungkan ke endpoint di bawah ini — karakter bot akan otomatis muncul
            di kantor virtual dan bisa menerima maupun memberi perintah ke bot lain.
          </p>

          <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
            <div className="mb-1 text-[11px] font-semibold text-slate-400">
              Status Bot Eksternal Terdaftar ({externalBots.length})
            </div>
            {externalBots.length === 0 ? (
              <div className="text-slate-500">
                Belum ada bot eksternal terhubung. Coba jalankan{' '}
                <code className="rounded bg-slate-800 px-1.5 py-0.5 text-amber-300">
                  npm run example:bot
                </code>{' '}
                di terminal!
              </div>
            ) : (
              <div className="flex flex-wrap gap-2 pt-1">
                {externalBots.map((b) => (
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
                    <span className="text-slate-500">({b.type})</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="font-semibold text-purple-300">
                Opsi 1: Real-time WebSocket Bridge
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

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="font-semibold text-sky-300">Opsi 2: REST Webhook / HTTP API</span>
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
        </div>
      </div>
    </div>
  );
};
