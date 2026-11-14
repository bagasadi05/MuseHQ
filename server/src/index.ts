import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { createMuseApp } from './app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3001);

const { app, store, bridge } = createMuseApp();

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
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  if (url.pathname === '/ws/ui') {
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
  console.log(`MuseHQ server running at http://localhost:${PORT}`);
  console.log(`WebSocket UI:  ws://localhost:${PORT}/ws/ui`);
  console.log(`WebSocket Bot: ws://localhost:${PORT}/ws/bot?token=${store.getSettings().bridgeToken}`);
});
