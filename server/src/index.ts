import './env.js';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { createMuseApp } from './app.js';
import {
  SESSION_COOKIE_NAME,
  isOriginAllowed,
  parseCookies,
  verifySessionToken,
} from './security.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3001);

const { app, store, bridge, allowedOrigins } = createMuseApp();

// Serve built client assets when running in standalone Node production mode
const clientDist = path.resolve(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

const server = http.createServer(app);
const uiWss = new WebSocketServer({ noServer: true });
const botWss = new WebSocketServer({ noServer: true });

bridge.attachWebSocketServers(uiWss, botWss);

server.on('upgrade', (request, socket, head) => {
  const origin = typeof request.headers.origin === 'string' ? request.headers.origin : undefined;
  if (!isOriginAllowed(origin, allowedOrigins, request.headers.host)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }

  let url: URL;
  try {
    url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  } catch {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
    socket.destroy();
    return;
  }
  if (url.pathname === '/ws/ui') {
    const cookies = parseCookies(request.headers.cookie);
    const sessionOk = verifySessionToken(
      cookies[SESSION_COOKIE_NAME],
      store.getSettings().sessionSecret
    );
    if (!sessionOk) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    uiWss.handleUpgrade(request, socket, head, (ws) => {
      uiWss.emit('connection', ws, request);
    });
  } else if (url.pathname === '/ws/bot') {
    botWss.handleUpgrade(request, socket, head, (ws) => {
      botWss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

server.listen(PORT, () => {
  const sec = store.getSecurityStatus();
  const settings = store.getSettings();
  console.log(`MuseHQ server running at http://localhost:${PORT}`);
  console.log(`WebSocket UI:  ws://localhost:${PORT}/ws/ui`);
  console.log(`WebSocket Bot: ws://localhost:${PORT}/ws/bot?token=<BOT_BRIDGE_TOKEN>`);

  if (sec.generatedBridgeToken) {
    console.log(
      `[SECURITY] BOT_BRIDGE_TOKEN belum diatur di env. Token acak baru dibuat & disimpan di: ${sec.settingsFilePath}`
    );
    console.log(
      `[SECURITY] Untuk konfigurasi tetap, atur BOT_BRIDGE_TOKEN di server/.env (atau jalankan bot dengan token dari settings.json).`
    );
  }
  if (sec.generatedOwnerPasscode) {
    console.log(
      `[SECURITY] Owner Passcode (MUSE_OWNER_PASSCODE) lokal dibuat: ${settings.ownerPasscode}`
    );
    console.log(
      `[SECURITY] Gunakan passcode di atas untuk membuka UI web pertama kali, atau atur MUSE_OWNER_PASSCODE di server/.env.`
    );
  }
});

function handleShutdown() {
  store.flushPersist();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}

process.on('SIGINT', handleShutdown);
process.on('SIGTERM', handleShutdown);
