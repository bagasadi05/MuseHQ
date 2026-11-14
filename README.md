# MuseHQ — Multi-Agent Virtual Office untuk Bot Muse AI

**MuseHQ** adalah aplikasi web ruangan kerja virtual 2D Isometric tempat berbagai bot Muse AI bekerja di meja masing-masing, berkomunikasi, saling memberi perintah, dan membagi tugas secara otomatis (paralel maupun bertahap).

## Cara Kerja Arsitektur (3 Lapisan Utama)

1. **Multi-Agent Orchestrator & Task Queue (`server/src/llm/orchestrator.ts`)**
   - Saat kamu memberi satu perintah besar ke `@Muse Lead`, koordinator memecah perintah menjadi sub-tugas terstruktur lengkap dengan dependensi (`dependsOnTaskIds`).
   - Tugas independen langsung dikerjakan paralel oleh bot terkait (`Muse Scout`, `Muse Dev`, dsb.), sedangkan tugas dependen (`Muse Craft`, `Muse Sentinel`) menunggu hasil tugas sebelumnya sebagai konteks.
2. **External Bot Bridge (`server/src/bridge/externalBridge.ts`)**
   - Jalur **WebSocket** (`/ws/bot`) dan **REST Webhook** (`/api/bridge/*`) agar bot eksternal (script Node/Python, bot Telegram/Discord, atau n8n) bisa ikut masuk ke ruangan virtual, menerima tugas, dan mendelegasikan perintah ke bot lain.
3. **2D Isometric Virtual Office UI (`client/src/components/OfficeCanvas.tsx`)**
   - Menampilkan denah ruangan kantor virtual (Command Desk, Research Library, Engineering Bay, War Room, Creative Studio, QA & Bridge Lab, Coffee Lounge) lengkap dengan animasi karakter bot, *speech bubble*, dan pancaran garis perintah (*command beam*) secara *real-time*.

## Menjalankan Project

1. Install seluruh dependencies (root, server, client):
   ```bash
   npm run install:all
   ```
2. Jalankan backend & frontend sekaligus:
   ```bash
   npm run dev
   ```
3. Buka browser ke `http://localhost:5173`.

## Mode AI yang Didukung

- **Demo Simulator (Aktif Langsung):** Bisa langsung dicoba tanpa API Key untuk melihat alur delegasi, animasi ruangan, dan simulasi deliverable.
- **Cloud LLM API:** Klik tombol **API Keys** di header web (atau isi `.env` dari `.env.example`) untuk memakai **Google Gemini**, **OpenAI**, atau **Anthropic Claude** di tiap bot.

## Deploy ke Vercel

Project ini sudah siap dideploy langsung ke **Vercel** melalui [vercel.json](vercel.json) dan serverless handler [api/index.mjs](api/index.mjs):

1. Import repository GitHub ini di dashboard Vercel (**Add New → Project**).
2. Biarkan **Root Directory** di root (`.`), Vercel otomatis membaca `vercel.json` (`buildCommand: npm run build`, `outputDirectory: client/dist`).
3. *(Opsional)* Tambahkan Environment Variables di Vercel:
   - `DEFAULT_PROVIDER`: `gemini` / `openai` / `anthropic` / `demo`
   - `GEMINI_API_KEY`, `OPENAI_API_KEY`, atau `ANTHROPIC_API_KEY`
   - `BOT_BRIDGE_TOKEN`: token keamanan untuk REST Webhook bot eksternal
4. Klik **Deploy**. Di Vercel, frontend otomatis memakai mode **Cloud Sync** (SSE real-time streaming + sinkronisasi state), dan bot eksternal dapat terhubung lewat **REST Webhook** (`/api/bridge/*`).

## Menguji Bot Eksternal (`examples/external-bot.mjs`)

Setelah `npm run dev` berjalan, buka terminal kedua lalu jalankan:
```bash
npm run example:bot
```
Bot eksternal baru (`Muse External Ops`) akan langsung masuk ke zona **QA & Bridge Lab** di kantor virtual dan siap menerima tugas dari `Muse Lead`!
