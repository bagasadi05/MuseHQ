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

export function useMuseSocket() {
  const [connected, setConnected] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [comms, setComms] = useState<CommsMessage[]>([]);
  const [beams, setBeams] = useState<CommandBeam[]>([]);
  const [settings, setSettings] = useState<PublicSettings>(DEFAULT_SETTINGS);
  const reconnectTimer = useRef<number | null>(null);

  const applySnapshot = useCallback((snap: WorkspaceSnapshot) => {
    setAgents(snap.agents || []);
    setMissions(snap.missions || []);
    setTasks(snap.tasks || []);
    setComms(snap.comms || []);
    setBeams(snap.beams || []);
    if (snap.settings) setSettings(snap.settings);
  }, []);

  useEffect(() => {
    let active = true;
    let socket: WebSocket | null = null;

    const connect = () => {
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
        reconnectTimer.current = window.setTimeout(connect, 1800);
      };

      socket.onmessage = (evt) => {
        if (!active) return;
        try {
          const msg = JSON.parse(evt.data) as { event: string; payload: unknown };
          switch (msg.event) {
            case 'snapshot':
              applySnapshot(msg.payload as WorkspaceSnapshot);
              break;
            case 'agent:updated': {
              const incoming = msg.payload as Agent;
              setAgents((prev) => {
                const exists = prev.some((a) => a.id === incoming.id);
                return exists
                  ? prev.map((a) => (a.id === incoming.id ? incoming : a))
                  : [...prev, incoming];
              });
              break;
            }
            case 'agent:removed': {
              const { id } = msg.payload as { id: string };
              setAgents((prev) => prev.filter((a) => a.id !== id));
              break;
            }
            case 'mission:updated': {
              const incoming = msg.payload as Mission;
              setMissions((prev) => {
                const exists = prev.some((m) => m.id === incoming.id);
                return exists
                  ? prev.map((m) => (m.id === incoming.id ? incoming : m))
                  : [...prev, incoming];
              });
              break;
            }
            case 'task:updated': {
              const incoming = msg.payload as Task;
              setTasks((prev) => {
                const exists = prev.some((t) => t.id === incoming.id);
                return exists
                  ? prev.map((t) => (t.id === incoming.id ? incoming : t))
                  : [...prev, incoming];
              });
              break;
            }
            case 'comms:message': {
              const incoming = msg.payload as CommsMessage;
              setComms((prev) => [...prev.slice(-199), incoming]);
              break;
            }
            case 'beam:created': {
              const incoming = msg.payload as CommandBeam;
              const now = Date.now();
              setBeams((prev) => [...prev.filter((b) => b.expiresAt > now), incoming]);
              break;
            }
            case 'settings:updated':
              setSettings(msg.payload as PublicSettings);
              break;
          }
        } catch {
          // Ignore malformed WS frame
        }
      };
    };

    connect();
    // Initial HTTP hydrate fallback
    apiJson<WorkspaceSnapshot>('/api/state')
      .then((snap) => {
        if (active) applySnapshot(snap);
      })
      .catch(() => {});

    return () => {
      active = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      socket?.close();
    };
  }, [applySnapshot]);

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

  const launchMission = useCallback(async (prompt: string, targetAgentId: string) => {
    return apiJson<{ mission: Mission }>('/api/missions', {
      method: 'POST',
      body: JSON.stringify({ prompt, targetAgentId }),
    });
  }, []);

  const createAgent = useCallback(async (payload: Partial<Agent>) => {
    return apiJson<{ agent: Agent }>('/api/agents', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }, []);

  const updateAgent = useCallback(async (id: string, patch: Partial<Agent>) => {
    return apiJson<{ agent: Agent }>(`/api/agents/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  }, []);

  const deleteAgent = useCallback(async (id: string) => {
    return apiJson<{ ok: boolean }>(`/api/agents/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }, []);

  const moveAgent = useCallback(async (id: string, zone: ZoneId) => {
    return apiJson<{ agent: Agent }>(`/api/agents/${encodeURIComponent(id)}/move`, {
      method: 'POST',
      body: JSON.stringify({ zone }),
    });
  }, []);

  const sendBotCommand = useCallback(
    async (
      fromAgentId: string,
      toAgentId: string,
      content: string,
      createTask = false,
      title?: string
    ) => {
      return apiJson<{ ok: boolean }>(`/api/agents/${encodeURIComponent(fromAgentId)}/chat`, {
        method: 'POST',
        body: JSON.stringify({ toAgentId, content, createTask, title }),
      });
    },
    []
  );

  const triggerAllHands = useCallback(async (mode: 'meeting' | 'desks' | 'lounge') => {
    return apiJson<{ ok: boolean }>('/api/office/all-hands', {
      method: 'POST',
      body: JSON.stringify({ mode }),
    });
  }, []);

  const updateSettings = useCallback(async (patch: Record<string, string>) => {
    return apiJson<{ settings: PublicSettings }>('/api/settings', {
      method: 'POST',
      body: JSON.stringify(patch),
    });
  }, []);

  const clearHistory = useCallback(async () => {
    return apiJson<{ ok: boolean }>('/api/missions/clear', { method: 'POST' });
  }, []);

  return {
    connected,
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
