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

### 3. Menghubungkan 4 Agen Rekan Nyata Sekaligus (`muse-bagas`, `muse-arif`, `muse-niro`, `muse-joni`)
Keempat ID agen berikut diperlakukan sebagai **rekan setara** di ruangan (tanpa batas kuota delegasi):
- `muse-bagas` (`Muse Bagas` — `command-desk`)
- `muse-arif` (`Muse Arif` — `research-library`)
- `muse-niro` (`Muse Niro` — `creative-studio`)
- `muse-joni` (`Muse Joni` — `engineering-bay`)

Gunakan launcher siap pakai [examples/team-bridge.mjs](examples/team-bridge.mjs) (mendukung auto-reconnect WebSocket dengan backoff auth 401/4001 mulai 5 detik hingga 1 menit, Cloud LLM API di `.env.bridge`/`.env`, serta penerusan ke endpoint bot terpisah via `*_UPSTREAM_URL`):
```bash
# 1. Salin template lalu isi token per-bot (BOT_BRIDGE_TOKEN_MUSE_BAGAS, dll.)
#    atau BOT_BRIDGE_TOKENS (+ API key / UPSTREAM_URL bila ada):
cp .env.bridge.example .env.bridge

# 2. Jalankan ke-4 bot sekaligus ke Render/VPS/lokal:
npm run bridge:team
```
Atau jalankan masing-masing bot dari mesin/terminal berbeda lewat [examples/muse-peer-bridge.mjs](examples/muse-peer-bridge.mjs), atau pakai template kotak surat [examples/muse-peer-client.mjs](examples/muse-peer-client.mjs) (`brainMode: "muse-langsung"`):
```bash
BOT_BRIDGE_TOKEN_MUSE_ARIF="<TOKEN-ARIF>" MUSE_WS_URL="wss://musehq.onrender.com/ws/bot" npm run bridge:bot -- --bot=muse-arif
```

> **Catatan Jujur Otak Bot (`brainMode`):** Bot `external-ws` / `external-rest` tanpa API key / upstream akan mengirim `brainMode: "fallback"`, ditandai merah `"Tanpa otak — tidak bisa kerja"` di UI, serta menolak tugas dengan `task:fail` alih-alih membuat laporan palsu.

---

## Daftar Variabel Lingkungan (`.env`)

| Variabel | Default | Fungsi |
|---|---|---|
| `PORT` | `3001` | Port server Express + WebSocket lokal |
| `BOT_BRIDGE_TOKENS` | — | Map JSON / `id=token` token per-bot agar satu bot tidak bisa menyamar menjadi bot lain (bisa juga lewat `BOT_BRIDGE_TOKEN_<BOT_ID>`, mis. `BOT_BRIDGE_TOKEN_MUSE_ARIF`) |
| `BOT_BRIDGE_TOKEN` | *(auto-random di lokal)* | *(Deprecated selama masa transisi)* Token bersama lama; penggunaannya dicatat sebagai warning deprecated di log server tanpa mencetak nilai token |
| `MUSE_DATA_DIR` | `/data` (jika tersedia) atau `server/data` | Direktori penyimpanan persisten `state.json`, `settings.json`, serta folder `backups/` (snapshot berkala tiap jam, 24 snapshot terakhir disimpan) |
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
- **Isolasi Token Per-Bot (`BOT_BRIDGE_TOKENS`)**: Setiap bot memakai token uniknya sendiri sehingga token milik bot A ditolak (`403` / close `4003`) jika mencoba mengirim `bot:hello` sebagai bot B. Token bersama lama tetap diterima sementara dengan log deprecation tanpa membocorkan token.
- **Autentikasi Owner (`muse_session`)**: `GET /api/state`, seluruh mutasi misi/agen/tugas/pengaturan, dan upgrade `/ws/ui` dilindungi cookie sesi `HttpOnly` bertanda tangan HMAC (`POST /api/auth/login`). `GET /api/state` juga mendukung header `x-muse-token` khusus untuk bot polling REST.
- **Delegasi Aman & Pengawasan Tugas**: Server menolak delegasi ke diri sendiri, siklus rantai `parentTaskId`, kedalaman delegasi `> 2`, serta misi ke bot offline/fallback; tugas eksternal tanpa progres `> 10` menit otomatis ditandai `stuck`.
- **Privasi Kredensial**: `bridgeToken`, `botTokens`, passcode, dan API key tidak pernah dikembalikan mentah dalam snapshot UI, tidak dicetak di log server/bridge, dan tidak pernah ditulis ke kode contoh.
- **CORS Terbatas**: Permintaan lintas-origin hanya diizinkan jika origin cocok dengan `ALLOWED_ORIGINS` atau domain deployment resmi.

---

## Deploy ke URL Publik (Agar Bot dari Mesin Lain Bisa Masuk)

`localhost` hanya dapat dijangkau dari komputer yang sama. Agar bot nyata dari mesin lain (`muse-bagas`, `muse-arif`, `muse-joni`, `muse-niro`, server Telegram/Discord/n8n) bisa masuk dan berkomunikasi secara konsisten dalam satu proses memori yang sama, deploy backend ke URL publik:

### Opsi Utama (Direkomendasikan) — Render Paket Gratis (Server Node Persisten via `render.yaml`)

MuseHQ menyertakan Blueprint `render.yaml` siap pakai agar satu proses Node.js memegang seluruh state ruangan secara konsisten dan membuka WebSocket penuh (`/ws/ui` dan `/ws/bot`).

1. **Buat akun Render** di https://render.com lalu login dengan akun GitHub Anda.
2. **Buat Web Service / Blueprint**:
   - **Cara cepat (Blueprint):** Klik **New → Blueprint**, pilih repo `bagasadi05/MuseHQ`, lalu Render membaca `render.yaml` otomatis (`runtime: node`, `plan: free`, `NODE_VERSION=24`, `healthCheckPath: /api/health`).
   - **Cara manual (New → Web Service):**
     - **Build Command:** `npm run install:all && npm run build` *(JANGAN memakai `npm ci` karena repo ini sengaja tanpa `package-lock.json`)*
     - **Start Command:** `npm start`
     - **Health Check Path:** `/api/health`
3. **Isi Environment Variables** di Dashboard Render (tandai variabel sensitif sebagai secret):
   - `NODE_VERSION=24`
   - `BOT_BRIDGE_TOKEN` — token rahasia bridge bot eksternal (min. 8 karakter acak kuat)
   - `MUSE_OWNER_PASSCODE` — passcode pemilik untuk membuka UI web
   - `SESSION_SECRET` — secret acak 32+ karakter untuk cookie sesi `muse_session`
   - `DEFAULT_PROVIDER=gemini` *(atau `openai` / `anthropic` — hanya dipakai bila menambah bot Built-in Cloud LLM)*
   - `ALLOWED_ORIGINS` — isi dengan URL Render setelah service tercipta (contoh: `https://musehq.onrender.com`; domain `RENDER_EXTERNAL_URL` juga diizinkan otomatis oleh server)
   - *(Opsional)* `GEMINI_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` bila ingin menjalankan bot Built-in Cloud LLM selain External Bridge.
4. **Deploy & Catat URL Publik**:
   - Tunggu build selesai lalu pastikan `GET https://<nama-service>.onrender.com/api/health` menjawab `{"ok":true,"serverless":false,...}`.
   - Buka URL di browser lalu login dengan `MUSE_OWNER_PASSCODE`.
   - Hubungkan bot eksternal menggunakan URL Render tersebut:
     - **WebSocket penuh:** `MUSE_WS_URL="wss://<nama-service>.onrender.com/ws/bot" BOT_BRIDGE_TOKEN="<TOKEN>" npm run example:bot`
     - **REST Polling:** `MUSE_BASE_URL="https://<nama-service>.onrender.com" BOT_BRIDGE_TOKEN="<TOKEN>" npm run example:rest-bot`

> **Catatan Batas Paket Gratis Render:**
> - **Disk Ephemeral:** Filesystem container paket gratis Render bersifat sementara (*ephemeral*), sehingga file `server/data/state.json` (daftar bot tersimpan, riwayat misi, tugas, dan comms) akan ter-reset setiap kali service restart, redeploy, atau bangun dari *spin-down*. *(Saran langkah lanjutan terpisah di luar migrasi ini: mount Render Persistent Disk ke `server/data`, lakukan backup berkala `state.json`, atau pindahkan penyimpanan ke Redis/PostgreSQL eksternal.)*
> - **Spin-down 15 Menit Saat Idle:** Service paket gratis Render masuk mode tidur jika tidak ada trafik masuk selama ~15 menit; selama ada bot eksternal yang aktif (WebSocket ping/heartbeat atau REST polling berkala), service tetap aktif tanpa terputus ke banyak instance terpisah.

### Opsi Alternatif Self-Hosted — VPS / Railway / Fly.io
1. Build aplikasi: `npm run install:all && npm run build`.
2. Atur `PORT`, `BOT_BRIDGE_TOKEN`, `MUSE_OWNER_PASSCODE`, `SESSION_SECRET`, dan `ALLOWED_ORIGINS=https://domain-anda.com`.
3. Jalankan `npm start` (server mendengarkan `0.0.0.0:$PORT` serta melayani API, `/ws/ui`, `/ws/bot`, dan static bundle `client/dist`).

### Opsi Cadangan — Vercel Serverless (`vercel.json` & `api/index.mjs`)
Konfigurasi Vercel (`buildCommand: npm run build`, `outputDirectory: client/dist`, `api/index.mjs`) tetap dipertahankan sebagai opsi cadangan / pratinjau cepat:
1. Wajib atur `BOT_BRIDGE_TOKEN`, `MUSE_OWNER_PASSCODE`, dan `SESSION_SECRET` (tandai **`Sensitive`**) di Vercel (**Production & Preview**), serta opsional `ALLOWED_ORIGINS`.
2. Hubungkan bot lewat REST Polling:
   ```bash
   MUSE_BASE_URL="https://domain-vercel-anda.vercel.app" BOT_BRIDGE_TOKEN="<TOKEN>" npm run example:rest-bot
   ```
   *(Opsional: tambahkan `VERCEL_BYPASS_SECRET="<BYPASS_TOKEN>"` untuk preview Vercel yang dilindungi Vercel Protection).*
- **Batas Vercel Serverless (Penting):** Setiap instance Lambda Serverless menyimpan state in-memory sendiri tanpa shared KV/Redis dan tidak mendukung koneksi WebSocket `/ws/bot` jangka panjang. Karena state tidak terbagi antar instance, request `bot:hello` atau `task:complete` dari bot eksternal tidak dijamin konsisten pada trafik nyata; Vercel hanya cocok untuk cadangan atau pratinjau cepat, sedangkan produksi stabil untuk banyak bot menggunakan **Opsi Utama (Render / Node persisten)**.
