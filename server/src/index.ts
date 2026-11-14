import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { ExternalBridge } from './bridge/externalBridge.js';
import { MissionOrchestrator } from './llm/orchestrator.js';
import { createApiRouter } from './routes/api.js';
import { WorkspaceStore } from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3001);

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const store = new WorkspaceStore();
const bridge = new ExternalBridge(store);
const orchestrator = new MissionOrchestrator(store, bridge);

store.setBroadcaster((event, payload) => {
  bridge.broadcastToUi(event, payload);
});

bridge.setHandlers({
  onExternalTaskCompleted: (taskId, result, speech) =>
    orchestrator.completeExternalTask(taskId, result, speech),
  onExternalTaskFailed: (taskId, error) => orchestrator.failExternalTask(taskId, error),
  onExternalDelegation: (params) => orchestrator.delegateFromBot(params),
});

app.use('/api', createApiRouter(store, orchestrator, bridge));

// Serve built client assets when running in production mode
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
