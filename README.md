# MuseHQ — Multi-Agent Virtual Office & Orchestration Hub

**MuseHQ** adalah aplikasi web ruang kerja virtual **2D Isometric** untuk menghubungkan, mengamati, dan mengorkestrasi bot internal maupun bot eksternal (**Muse AI**) di dalam satu kantor virtual yang interaktif.

Di dalam MuseHQ, Anda (Commander / Pemilik) memberi misi lewat Command Bar ke bot koordinator (bot eksternal via External Bridge atau bot Cloud LLM pilihan Anda), melihat pemecahan tugas berbasis dependensi (**DAG**), memantau pancaran perintah (*command beam*), membiarkan tugas independen berjalan paralel, menyalurkan hasil tugas pendahulu ke tugas dependen, dan menampilkan hasil akhir (*deliverables*) secara *real-time*.

---

## Arsitektur 3 Lapisan Utama

1. **Multi-Agent Orchestrator & DAG Task Queue (`server/src/llm/orchestrator.ts`)**
   - Menerima perintah pemilik ke bot koordinator Cloud LLM atau langsung ke bot eksternal via Bridge.
   - Memecah misi menjadi graf sub-tugas dengan `dependsOnTaskIds`:
     - Tugas tanpa dependensi langsung berstatus `working` / `assigned` dan berjalan **paralel**.
     - Tugas dependen berstatus `waiting-dependency` hingga seluruh pendahulunya `completed`, lalu otomatis menerima ringkasan hasil pendahulu sebagai konteks eksekusi.
   - Mendukung **External Bot Bridge** maupun **Cloud LLM API** (`gemini`, `openai`, `anthropic` via `providers.ts`) — ruangan dimulai kosong tanpa bot simulator bawaan.

2. **External Bot Bridge (`server/src/bridge/externalBridge.ts`)**
   - Menghubungkan bot nyata dari proses/mesin terpisah ke dalam ruangan yang sama melalui dua protokol:
     - **WebSocket Bridge (`/ws/bot?token=<BOT_BRIDGE_TOKEN>`)** — koneksi *full-duplex* dua arah secara *real-time*.
     - **REST Bridge & Polling (`/api/bridge/bots/:id/event`, `/api/bridge/bots/:id/events?since=`, `GET /api/state?since=`)** — aman untuk lingkungan serverless (seperti Vercel) atau skrip Python/Node/n8n/cron dengan deduplikasi berbasis `cursor` & `eventId`.
   - Mendukung event tervalidasi: `bot:hello`, `bot:heartbeat`, `bot:status`, `bot:move`, `bot:speech`, `bot:message`, `bot:delegate` (alias `task:delegate`), `task:accept`, `task:complete`, `task:fail`, serta event keluar `bot:registered`, `task:assigned`, `comms:message`, `ping`, `error`.

3. **2D Isometric Virtual Office UI (`client/src/components/OfficeCanvas.tsx`)**
   - Menampilkan denah kantor 2D isometric dengan **7 zona kanonik**:
     - `command-desk` — **Command Desk**
     - `research-library` — **Research Library**
     - `engineering-bay` — **Engineering Bay**
     - `war-room` — **War Room**
     - `creative-studio` — **Creative Studio**
     - `qa-bench` — **QA & Bridge Lab**
     - `coffee-lounge` — **Coffee Lounge**
   - Menampilkan karakter bot anti-tumpuk di meja masing-masing lengkap dengan nama, peran, warna, status (`idle`, `online`, `working`, `talking`, `offline`), *speech bubble*, *command beam*, daftar tugas, dan panel *deliverable*.

---

## Cara Install & Menjalankan (Lokal)

1. Install seluruh dependencies (root, `server`, `client`):
   ```bash
   npm run install:all
   ```
2. *(Opsional)* Salin `.env.example` menjadi `server/.env` atau `.env` jika ingin mengatur token/passcode/API key secara manual:
   ```bash
   cp .env.example server/.env
   ```
   Jika `BOT_BRIDGE_TOKEN` dan `MUSE_OWNER_PASSCODE` tidak diisi saat run lokal pertama, server otomatis membuat kredensial acak ke `server/data/settings.json` dan mencetak **Owner Passcode** di log terminal server.
3. Jalankan backend (port `3001`) dan frontend Vite (port `5173`) bersamaan:
   ```bash
   npm run dev
   ```
4. Buka `http://localhost:5173` di browser, lalu masukkan **Owner Passcode** untuk membuka ruang kerja.

Untuk build dan menjalankan mode produksi standalone Node:
```bash
npm run build
npm start
```

---

## Mode AI yang Didukung

Ruangan MuseHQ dimulai **kosong tanpa bot simulator bawaan** maupun mode Demo Simulator:

- **External Bot Bridge (WebSocket & REST Polling)**: Hubungkan bot Muse nyata Anda (`muse-bagas`, `muse-arif`, `muse-joni`, `muse-niro`, atau agent eksternal lain) langsung ke ruangan tanpa memerlukan API Key LLM di server MuseHQ.
- **Cloud LLM Asli (`gemini`, `openai`, `anthropic`)**:
  - Tambahkan bot Built-in melalui tombol **Tambah Bot**, lalu atur API Key lewat menu **API Keys** di header UI (tersimpan aman di runtime settings / state lokal, tidak pernah diekspor mentah ke publik), **atau**
  - Isi `DEFAULT_PROVIDER`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, atau `ANTHROPIC_API_KEY` di `server/.env` / `.env`.

---

## Menguji Bot Eksternal

Pastikan `npm run dev` sudah berjalan terlebih dahulu:

### 1. Mode WebSocket (`examples/external-bot.mjs`)
Di terminal kedua:
```bash
npm run example:bot
```
`Muse External Ops` (`muse-external-ops`) akan masuk ke zona **QA & Bridge Lab** (`qa-bench`), menyapa tim, lalu siap menerima tugas dari Command Bar atau delegasi bot lain dan mengirim hasil kembali via `/ws/bot`.

### 2. Mode REST Polling (`examples/rest-polling-bot.mjs`)
```bash
npm run example:rest-bot
```
`Muse REST Worker` (`muse-rest-worker`, zona default `qa-bench`, interval `POLL_MS=2500` min `1000`) mendaftar via `POST /api/bridge/bots/muse-rest-worker/event`, membaca `GET /api/state?since=<cursor>`, mengirim `bot:heartbeat` tiap siklus, dan melaporkan hasil tanpa duplikasi saat polling diulang. Jika menargetkan preview Vercel yang diproteksi Deployment Protection, tambahkan `VERCEL_BYPASS_SECRET` (dikirim via header `x-vercel-protection-bypass`).

### 3. Menghubungkan 4 Agen Rekan Nyata Sekaligus
Keempat ID agen berikut diperlakukan sebagai **rekan setara** di ruangan (tidak dibatasi kuota delegasi):
- `muse-bagas` (disarankan `homeZone: "command-desk"`)
- `muse-arif` (mis. `research-library` / `engineering-bay`)
- `muse-joni` (mis. `engineering-bay` / `creative-studio`)
- `muse-niro` (mis. `qa-bench` / `war-room`)

Setiap agen dapat dijalankan di mesin/proses berbeda dengan `BOT_ID` & `BOT_HOME_ZONE`:
```bash
BOT_ID=muse-bagas BOT_NAME="Muse Bagas" BOT_HOME_ZONE=command-desk BOT_BRIDGE_TOKEN="<TOKEN>" MUSE_WS_URL="wss://domain-anda.com/ws/bot" node examples/external-bot.mjs
```

---

## Daftar Variabel Lingkungan (`.env`)

| Variabel | Default | Fungsi |
|---|---|---|
| `PORT` | `3001` | Port server Express + WebSocket lokal |
| `BOT_BRIDGE_TOKEN` | *(auto-random di lokal)* | Token rahasia untuk `/ws/bot` dan `/api/bridge/*` + `GET /api/state` bot |
| `MUSE_OWNER_PASSCODE` | *(auto-random di lokal)* | Passcode pemilik untuk membuka UI web (`/api/auth/login`) |
| `SESSION_SECRET` | *(auto-random / derivatif)* | Kunci penandatanganan cookie HMAC `muse_session` |
| `ALLOWED_ORIGINS` | `http://localhost:5173,http://localhost:3001` | Daftar origin CORS yang diizinkan (pisahkan koma, sertakan skema `http://` atau `https://`) |
| `DEFAULT_PROVIDER` | `gemini` | Provider default bot Built-in: `gemini`, `openai`, atau `anthropic` |
| `GEMINI_API_KEY` | — | API Key Google Gemini |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Model Gemini yang dipakai |
| `OPENAI_API_KEY` | — | API Key OpenAI |
| `OPENAI_MODEL` | `gpt-4o-mini` | Model OpenAI yang dipakai |
| `ANTHROPIC_API_KEY` | — | API Key Anthropic Claude |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-5` | Model Claude yang dipakai |

---

## Model Keamanan

- **Tanpa Token Publik Bawaan**: Nilai pengembangan lama sudah dipensiunkan dan ditolak aktif oleh server (`isRetiredToken`). Token acak dibuat otomatis pada run lokal pertama jika belum dikonfigurasi.
- **Autentikasi Owner (`muse_session`)**: `GET /api/state`, seluruh mutasi misi/agen/pengaturan, dan upgrade `/ws/ui` dilindungi cookie sesi `HttpOnly` bertanda tangan HMAC (`POST /api/auth/login`). `GET /api/state` juga mendukung header `x-muse-token` khusus untuk bot polling REST.
- **Proteksi Bridge & Validasi Ketat**: `/ws/bot` dan `/api/bridge/*` memeriksa token secara *constant-time*. Event tak dikenal ditolak dengan `400 Bad Request` (REST) atau pesan `error` (WebSocket) tanpa menjatuhkan server.
- **Privasi Kredensial**: `bridgeToken` dan API key tidak pernah dikembalikan mentah dalam snapshot UI (`PublicSettings` hanya mengirim `bridgeTokenPreview`), tidak dicetak di log endpoint REST, dan tidak pernah ditulis ke kode contoh.
- **CORS Terbatas**: Permintaan lintas-origin hanya diizinkan jika origin cocok dengan `ALLOWED_ORIGINS` atau domain deployment resmi.

---

## Deploy ke URL Publik (Agar Bot dari Mesin Lain Bisa Masuk)

`localhost` hanya dapat dijangkau dari komputer yang sama. Agar bot di mesin lain (`muse-bagas`, `muse-arif`, `muse-joni`, `muse-niro`, server Telegram/Discord/n8n) bisa terhubung, deploy backend ke URL publik:

### Opsi A — Server Node.js Selalu Menyala (Direkomendasikan untuk WebSocket `/ws/bot` Penuh)
Cocok untuk **VPS (Ubuntu + Nginx/Caddy TLS), Railway, Render, atau Fly.io**:
1. Build aplikasi: `npm run install:all && npm run build`.
2. Atur environment variables:
   - `BOT_BRIDGE_TOKEN` (token acak kuat)
   - `MUSE_OWNER_PASSCODE` (passcode pemilik)
   - `SESSION_SECRET` (string acak 32+ karakter)
   - `ALLOWED_ORIGINS=https://domain-anda.com`
3. Jalankan `npm start` (server melayani API, `/ws/ui`, `/ws/bot`, dan static bundle `client/dist`). State tersimpan persisten di disk (`server/data/state.json`).

### Opsi B — Vercel Serverless + REST Polling (`vercel.json` & `api/index.mjs`)
Cocok untuk deployment cepat tanpa manage VPS:
1. Import repository ke Vercel (`buildCommand: npm run build`, `outputDirectory: client/dist`, fungsi `api/index.mjs` dengan `maxDuration: 60` dan `includeFiles: server/dist/**`).
2. Wajib atur Environment Variables di Vercel (**Production & Preview**, tandai sebagai **`Sensitive`**):
   - `BOT_BRIDGE_TOKEN` (`sensitive`)
   - `MUSE_OWNER_PASSCODE` (`sensitive`)
   - `SESSION_SECRET` (`sensitive` — menjaga cookie sesi owner `muse_session` tetap valid lintas *cold start*)
   - *(Opsional)* `ALLOWED_ORIGINS`, `DEFAULT_PROVIDER`, serta `GEMINI_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` (tandai `sensitive`) jika memakai Cloud LLM.
3. Di Vercel Serverless (tanpa WebSocket stateful jangka panjang), UI otomatis berjalan pada mode **Cloud Sync (SSE Streaming)** dan bot eksternal terhubung lewat **REST Polling** (`GET /api/state?since=<cursor>` & `POST /api/bridge/bots/:id/event`):
   ```bash
   MUSE_BASE_URL="https://domain-vercel-anda.vercel.app" BOT_BRIDGE_TOKEN="<TOKEN>" npm run example:rest-bot
   ```
   *(Opsional: tambahkan `VERCEL_BYPASS_SECRET="<BYPASS_TOKEN>"` untuk preview Vercel yang dilindungi Vercel Protection).*
   - *Catatan Serverless:* Memori fungsi Lambda/Serverless dan `/tmp` bersifat sementara (*ephemeral*) saat idle/*cold start*; gunakan **Opsi A (Node persisten)** jika Anda membutuhkan bot WebSocket `/ws/bot` tersambung terus-menerus dan persistensi file lokal (`server/data/state.json`) tanpa database eksternal.
