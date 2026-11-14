import { createMuseApp } from '../server/dist/app.js';

let cachedApp = null;

function getApp() {
  if (!cachedApp) {
    cachedApp = createMuseApp().app;
  }
  return cachedApp;
}

export default function handler(req, res) {
  if (req.url) {
    const parsed = new URL(req.url, 'http://localhost');
    const pathParam = parsed.searchParams.get('__path');
    if (pathParam !== null || parsed.pathname === '/api/index.mjs') {
      parsed.searchParams.delete('__path');
      const cleanPath = pathParam ? `/api/${pathParam.replace(/^\/+/, '')}` : '/api/health';
      const qs = parsed.searchParams.toString();
      req.url = `${cleanPath}${qs ? `?${qs}` : ''}`;
    }
  }

  const app = getApp();
  return app(req, res);
}
