import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Agent,
  CommandBeam,
  CommsMessage,
  Mission,
  PublicSettings,
  Task,
  WorkspaceSnapshot,
  ZoneId,
} from '../types';

export type TransportMode = 'ws' | 'cloud';

const CLOUD_CACHE_KEY = 'musehq_cloud_workspace_v1';
const CLOUD_SETTINGS_KEY = 'musehq_cloud_settings_v1';

const DEFAULT_SETTINGS: PublicSettings = {
  defaultProvider: 'demo',
  hasGeminiKey: false,
  hasOpenaiKey: false,
  hasAnthropicKey: false,
  geminiKeyPreview: '',
  openaiKeyPreview: '',
  anthropicKeyPreview: '',
  geminiModel: 'gemini-2.5-flash',
  openaiModel: 'gpt-4o-mini',
  anthropicModel: 'claude-sonnet-4-5',
  bridgeToken: 'muse-bridge-secret-dev',
};

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(errBody.error || `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

function loadJsonStorage<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function saveJsonStorage(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore storage quota or private mode failures
  }
}

export function useMuseSocket() {
  const [connected, setConnected] = useState(false);
  const [transportMode, setTransportMode] = useState<TransportMode>('ws');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [comms, setComms] = useState<CommsMessage[]>([]);
  const [beams, setBeams] = useState<CommandBeam[]>([]);
  const [settings, setSettings] = useState<PublicSettings>(DEFAULT_SETTINGS);

  const reconnectTimer = useRef<number | null>(null);
  const transportRef = useRef<TransportMode>('ws');
  const agentsRef = useRef<Agent[]>([]);
  agentsRef.current = agents;

  const applySnapshot = useCallback((snap: WorkspaceSnapshot) => {
    setAgents(snap.agents || []);
    setMissions(snap.missions || []);
    setTasks(snap.tasks || []);
    setComms(snap.comms || []);
    setBeams(snap.beams || []);
    if (snap.settings) setSettings(snap.settings);
  }, []);

  const applyEvent = useCallback(
    (event: string, payload: unknown) => {
      switch (event) {
        case 'snapshot':
          applySnapshot(payload as WorkspaceSnapshot);
          break;
        case 'agent:updated': {
          const incoming = payload as Agent;
          setAgents((prev) => {
            const exists = prev.some((a) => a.id === incoming.id);
            return exists
              ? prev.map((a) => (a.id === incoming.id ? incoming : a))
              : [...prev, incoming];
          });
          break;
        }
        case 'agent:removed': {
          const { id } = payload as { id: string };
          setAgents((prev) => prev.filter((a) => a.id !== id));
          break;
        }
        case 'mission:updated': {
          const incoming = payload as Mission;
          setMissions((prev) => {
            const exists = prev.some((m) => m.id === incoming.id);
            return exists
              ? prev.map((m) => (m.id === incoming.id ? incoming : m))
              : [...prev, incoming];
          });
          break;
        }
        case 'task:updated': {
          const incoming = payload as Task;
          setTasks((prev) => {
            const exists = prev.some((t) => t.id === incoming.id);
            return exists
              ? prev.map((t) => (t.id === incoming.id ? incoming : t))
              : [...prev, incoming];
          });
          break;
        }
        case 'comms:message': {
          const incoming = payload as CommsMessage;
          setComms((prev) => {
            if (prev.some((m) => m.id === incoming.id)) return prev;
            return [...prev.slice(-199), incoming];
          });
          break;
        }
        case 'beam:created': {
          const incoming = payload as CommandBeam;
          const now = Date.now();
          setBeams((prev) => [...prev.filter((b) => b.expiresAt > now), incoming]);
          break;
        }
        case 'settings:updated':
          setSettings(payload as PublicSettings);
          break;
      }
    },
    [applySnapshot]
  );

  // Persist cloud workspace state locally so Vercel cold starts never lose custom bots or history
  useEffect(() => {
    if (transportMode !== 'cloud' || agents.length === 0) return;
    saveJsonStorage(CLOUD_CACHE_KEY, {
      agents,
      missions: missions.slice(-30),
      tasks: tasks.slice(-150),
      comms: comms.slice(-150),
    });
  }, [transportMode, agents, missions, tasks, comms]);

  useEffect(() => {
    let active = true;
    let socket: WebSocket | null = null;

    const connectWebSocket = () => {
      if (!active) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws/ui`;
      socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        if (active) setConnected(true);
      };

      socket.onclose = () => {
        if (!active) return;
        setConnected(false);
        reconnectTimer.current = window.setTimeout(connectWebSocket, 1800);
      };

      socket.onmessage = (evt) => {
        if (!active) return;
        try {
          const msg = JSON.parse(evt.data) as { event: string; payload: unknown };
          applyEvent(msg.event, msg.payload);
        } catch {
          // Ignore malformed WS frame
        }
      };
    };

    const boot = async () => {
      let isServerless = false;
      try {
        const health = await apiJson<{ serverless?: boolean }>('/api/health');
        isServerless = Boolean(health.serverless);
      } catch {
        // Fallback to standard WS attempt
      }

      if (!active) return;

      if (isServerless) {
        transportRef.current = 'cloud';
        setTransportMode('cloud');
        setConnected(true);

        const cached = loadJsonStorage<Partial<WorkspaceSnapshot>>(CLOUD_CACHE_KEY);
        const savedSettings = loadJsonStorage<Record<string, string>>(CLOUD_SETTINGS_KEY);
        try {
          const snap = await apiJson<WorkspaceSnapshot>('/api/state');
          if (!active) return;
          if (cached?.agents && cached.agents.length > 0) {
            applySnapshot({
              ...snap,
              agents: cached.agents,
              missions: cached.missions || snap.missions,
              tasks: cached.tasks || snap.tasks,
              comms: cached.comms && cached.comms.length > 0 ? cached.comms : snap.comms,
              settings: savedSettings?.defaultProvider
                ? {
                    ...snap.settings,
                    defaultProvider: savedSettings.defaultProvider as PublicSettings['defaultProvider'],
                    hasGeminiKey: Boolean(savedSettings.geminiApiKey) || snap.settings.hasGeminiKey,
                    hasOpenaiKey: Boolean(savedSettings.openaiApiKey) || snap.settings.hasOpenaiKey,
                    hasAnthropicKey:
                      Boolean(savedSettings.anthropicApiKey) || snap.settings.hasAnthropicKey,
                  }
                : snap.settings,
            });
          } else {
            applySnapshot(snap);
          }
        } catch {
          if (cached?.agents) {
            applySnapshot({
              agents: cached.agents,
              missions: cached.missions || [],
              tasks: cached.tasks || [],
              comms: cached.comms || [],
              beams: [],
              settings: DEFAULT_SETTINGS,
            });
          }
        }
        return;
      }

      transportRef.current = 'ws';
      setTransportMode('ws');
      connectWebSocket();
      apiJson<WorkspaceSnapshot>('/api/state')
        .then((snap) => {
          if (active) applySnapshot(snap);
        })
        .catch(() => {});
    };

    void boot();

    return () => {
      active = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      socket?.close();
    };
  }, [applyEvent, applySnapshot]);

  // Periodically prune expired beams locally so canvas stays crisp
  useEffect(() => {
    const id = window.setInterval(() => {
      const now = Date.now();
      setBeams((prev) => {
        const filtered = prev.filter((b) => b.expiresAt > now);
        return filtered.length === prev.length ? prev : filtered;
      });
    }, 800);
    return () => clearInterval(id);
  }, []);

  const syncFromMutation = useCallback(
    (res: { snapshot?: WorkspaceSnapshot; agent?: Agent }) => {
      if (transportRef.current !== 'cloud') return;
      if (res.agent) {
        applyEvent('agent:updated', res.agent);
      } else if (res.snapshot) {
        if (res.snapshot.agents) setAgents(res.snapshot.agents);
        if (res.snapshot.settings) setSettings(res.snapshot.settings);
      }
    },
    [applyEvent]
  );

  const launchMission = useCallback(
    async (prompt: string, targetAgentId: string) => {
      if (transportRef.current !== 'cloud') {
        return apiJson<{ mission: Mission }>('/api/missions', {
          method: 'POST',
          body: JSON.stringify({ prompt, targetAgentId }),
        });
      }

      const settingsPatch = loadJsonStorage<Record<string, string>>(CLOUD_SETTINGS_KEY) || undefined;
      const res = await fetch('/api/missions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          prompt,
          targetAgentId,
          stream: true,
          clientContext: {
            agents: agentsRef.current,
            settingsPatch,
          },
        }),
      });

      if (!res.ok || !res.body) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() || '';
        for (const frame of frames) {
          const line = frame.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          try {
            const parsed = JSON.parse(line.slice(6)) as { event: string; payload: unknown };
            if (parsed.event !== 'done') {
              applyEvent(parsed.event, parsed.payload);
            }
          } catch {
            // Ignore partial chunk
          }
        }
      }
      return { ok: true };
    },
    [applyEvent]
  );

  const createAgent = useCallback(
    async (payload: Partial<Agent>) => {
      const res = await apiJson<{ agent: Agent; snapshot?: WorkspaceSnapshot }>('/api/agents', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      syncFromMutation(res);
      return res;
    },
    [syncFromMutation]
  );

  const updateAgent = useCallback(
    async (id: string, patch: Partial<Agent>) => {
      const res = await apiJson<{ agent: Agent; snapshot?: WorkspaceSnapshot }>(
        `/api/agents/${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          body: JSON.stringify(patch),
        }
      );
      syncFromMutation(res);
      return res;
    },
    [syncFromMutation]
  );

  const deleteAgent = useCallback(async (id: string) => {
    const res = await apiJson<{ ok: boolean }>(`/api/agents/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (transportRef.current === 'cloud') {
      setAgents((prev) => prev.filter((a) => a.id !== id));
    }
    return res;
  }, []);

  const moveAgent = useCallback(
    async (id: string, zone: ZoneId) => {
      const res = await apiJson<{ agent: Agent; snapshot?: WorkspaceSnapshot }>(
        `/api/agents/${encodeURIComponent(id)}/move`,
        {
          method: 'POST',
          body: JSON.stringify({ zone }),
        }
      );
      syncFromMutation(res);
      return res;
    },
    [syncFromMutation]
  );

  const sendBotCommand = useCallback(
    async (
      fromAgentId: string,
      toAgentId: string,
      content: string,
      createTask = false,
      title?: string
    ) => {
      const settingsPatch =
        transportRef.current === 'cloud'
          ? loadJsonStorage<Record<string, string>>(CLOUD_SETTINGS_KEY) || undefined
          : undefined;
      const res = await apiJson<{ ok: boolean; snapshot?: WorkspaceSnapshot }>(
        `/api/agents/${encodeURIComponent(fromAgentId)}/chat`,
        {
          method: 'POST',
          body: JSON.stringify({
            toAgentId,
            content,
            createTask,
            title,
            ...(settingsPatch || agentsRef.current.length > 0
              ? { clientContext: { agents: agentsRef.current, settingsPatch } }
              : {}),
          }),
        }
      );
      if (transportRef.current === 'cloud' && res.snapshot) {
        if (res.snapshot.tasks) {
          for (const t of res.snapshot.tasks) applyEvent('task:updated', t);
        }
        if (res.snapshot.comms) {
          for (const c of res.snapshot.comms) applyEvent('comms:message', c);
        }
        if (res.snapshot.beams) setBeams(res.snapshot.beams);
        if (res.snapshot.agents) setAgents(res.snapshot.agents);
      }
      return res;
    },
    [applyEvent]
  );

  const triggerAllHands = useCallback(
    async (mode: 'meeting' | 'desks' | 'lounge') => {
      const res = await apiJson<{ ok: boolean; snapshot?: WorkspaceSnapshot }>(
        '/api/office/all-hands',
        {
          method: 'POST',
          body: JSON.stringify({ mode }),
        }
      );
      if (transportRef.current === 'cloud' && res.snapshot) {
        if (res.snapshot.agents) setAgents(res.snapshot.agents);
        if (res.snapshot.comms) {
          for (const c of res.snapshot.comms) applyEvent('comms:message', c);
        }
      }
      return res;
    },
    [applyEvent]
  );

  const updateSettings = useCallback(async (patch: Record<string, string>) => {
    if (transportRef.current === 'cloud') {
      const existing = loadJsonStorage<Record<string, string>>(CLOUD_SETTINGS_KEY) || {};
      saveJsonStorage(CLOUD_SETTINGS_KEY, { ...existing, ...patch });
    }
    const res = await apiJson<{ settings: PublicSettings }>('/api/settings', {
      method: 'POST',
      body: JSON.stringify(patch),
    });
    if (transportRef.current === 'cloud' && res.settings) {
      setSettings(res.settings);
    }
    return res;
  }, []);

  const clearHistory = useCallback(async () => {
    const res = await apiJson<{ ok: boolean; snapshot?: WorkspaceSnapshot }>('/api/missions/clear', {
      method: 'POST',
    });
    if (transportRef.current === 'cloud') {
      setMissions([]);
      setTasks([]);
      setBeams([]);
      setComms(res.snapshot?.comms || []);
    }
    return res;
  }, []);

  return {
    connected,
    transportMode,
    agents,
    missions,
    tasks,
    comms,
    beams,
    settings,
    launchMission,
    createAgent,
    updateAgent,
    deleteAgent,
    moveAgent,
    sendBotCommand,
    triggerAllHands,
    updateSettings,
    clearHistory,
  };
}
