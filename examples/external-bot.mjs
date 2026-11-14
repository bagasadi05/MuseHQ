/**
 * Contoh script Bot Eksternal yang menyambung ke ruangan kerja MuseHQ.
 * Jalankan dengan: npm run example:bot
 */

const TOKEN = process.env.BOT_BRIDGE_TOKEN || 'muse-bridge-secret-dev';
const WS_URL = `ws://localhost:3001/ws/bot?token=${encodeURIComponent(TOKEN)}`;

console.log('Menghubungkan Muse External Bot ke:', WS_URL);
const ws = new WebSocket(WS_URL);

function send(event, payload) {
  ws.send(JSON.stringify({ event, payload }));
}

ws.addEventListener('open', () => {
  console.log('[ExternalBot] Terhubung ke MuseHQ!');
  send('bot:hello', {
    id: 'muse-external-ops',
    name: 'Muse External Ops',
    role: 'Automation & Integration Bot',
    description: 'Bot eksternal yang berjalan di proses terpisah dan siap menerima delegasi.',
    homeZone: 'qa-bench',
    color: '#a855f7',
    canDelegate: true,
  });

  // Contoh interaksi awal di ruangan
  setTimeout(() => {
    send('bot:speech', { text: 'Halo tim! Bot eksternal baru saja login.' });
  }, 1500);
});

ws.addEventListener('message', (evt) => {
  const { event, payload } = JSON.parse(String(evt.data));
  console.log('[ExternalBot] Event masuk:', event, payload);

  if (event === 'task:assigned') {
    const { taskId, title, instructions } = payload;
    send('bot:status', {
      status: 'working',
      zone: 'qa-bench',
      speech: `Memproses "${title}" di script eksternal...`,
    });

    // Simulasi pekerjaan eksternal selama 2.5 detik lalu kirim hasil kembali
    setTimeout(() => {
      send('task:complete', {
        taskId,
        speech: `Selesai dari proses eksternal!`,
        result: [
          `#### Hasil Eksekusi Bot Eksternal (Muse External Ops)`,
          `**Tugas:** ${title}`,
          `**Ringkasan Instruksi:** ${String(instructions).slice(0, 120)}`,
          '',
          '- Diproses oleh worker script eksternal melalui WebSocket Bridge.',
          '- Integrasi dua arah aktif dan siap disambungkan ke Telegram/Discord/n8n/Python.',
        ].join('\n'),
      });
    }, 2500);
  }
});

ws.addEventListener('close', () => {
  console.log('[ExternalBot] Koneksi ditutup.');
});
