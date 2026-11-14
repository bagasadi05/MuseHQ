import 'dotenv/config';
import cors from 'cors';
import express, { Express } from 'express';
import { ExternalBridge } from './bridge/externalBridge.js';
import { MissionOrchestrator } from './llm/orchestrator.js';
import { createApiRouter } from './routes/api.js';
import { IS_SERVERLESS, WorkspaceStore } from './store.js';

export interface MuseAppContext {
  app: Express;
  store: WorkspaceStore;
  bridge: ExternalBridge;
  orchestrator: MissionOrchestrator;
  isServerless: boolean;
}

export function createMuseApp(): MuseAppContext {
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

  return { app, store, bridge, orchestrator, isServerless: IS_SERVERLESS };
}
