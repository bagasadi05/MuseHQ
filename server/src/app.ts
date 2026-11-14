import './env.js';
import cors from 'cors';
import express, { Express, NextFunction, Request, Response } from 'express';
import { ExternalBridge } from './bridge/externalBridge.js';
import { MissionOrchestrator } from './llm/orchestrator.js';
import { createApiRouter } from './routes/api.js';
import { getAllowedOrigins, isOriginAllowed } from './security.js';
import { IS_SERVERLESS, WorkspaceStore } from './store.js';

export interface MuseAppContext {
  app: Express;
  store: WorkspaceStore;
  bridge: ExternalBridge;
  orchestrator: MissionOrchestrator;
  isServerless: boolean;
  allowedOrigins: Set<string>;
}

export function createMuseApp(): MuseAppContext {
  const app = express();
  app.set('trust proxy', 1);

  const allowedOrigins = getAllowedOrigins();
  app.use((req: Request, res: Response, next: NextFunction) => {
    cors({
      credentials: true,
      origin(origin, callback) {
        if (isOriginAllowed(origin, allowedOrigins, req.headers.host)) {
          callback(null, true);
          return;
        }
        callback(new Error(`Origin not allowed by CORS: ${origin}`));
      },
    })(req, res, next);
  });

  app.use(express.json({ limit: '2mb' }));

  const store = new WorkspaceStore();
  const bridge = new ExternalBridge(store);
  const orchestrator = new MissionOrchestrator(store, bridge);

  store.setBroadcaster((event, payload) => {
    bridge.broadcastToUi(event, payload);
  });

  bridge.setHandlers({
    onExternalTaskCompleted: (taskId, result, speech, agentId) =>
      orchestrator.completeExternalTask(taskId, result, speech, agentId),
    onExternalTaskFailed: (taskId, error, agentId) =>
      orchestrator.failExternalTask(taskId, error, agentId),
    onExternalDelegation: (params) => orchestrator.delegateFromBot(params),
  });

  app.use('/api', createApiRouter(store, orchestrator, bridge));

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err.message.startsWith('Origin not allowed by CORS')) {
      res.status(403).json({ error: err.message });
      return;
    }
    if (
      err instanceof SyntaxError &&
      'status' in err &&
      (err as { status?: number }).status === 400
    ) {
      res.status(400).json({ error: 'Invalid JSON body' });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  });

  return { app, store, bridge, orchestrator, isServerless: IS_SERVERLESS, allowedOrigins };
}
