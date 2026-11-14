import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Agent,
  CommandBeam,
  CommsMessage,
  Mission,
  PublicSettings,
  SpeechBubble,
  Task,
  WorkspaceSnapshot,
  ZoneId,
  normalizeZoneId,
} from '../types';

export type TransportMode = 'ws' | 'cloud';
export type AuthStatus = 'checking' | 'locked' | 'setup-required' | 'authenticated';

const CLOUD_CACHE_KEY = 'musehq_cloud_workspace_v3';
const CLOUD_SETTINGS_KEY = 'musehq_cloud_settings_v3';

interface CloudSafePreferences {
  defaultProvider?: PublicSettings['defaultProvider'];
  geminiModel?: string;
  openaiModel?: string;
  anthropicModel?: string;
}

function pickSafeCloudPreferences(raw: unknown): CloudSafePreferences | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const safe: CloudSafePreferences = {};
  if (
    typeof obj.defaultProvider === 'string' &&
    ['gemini', 'openai', 'anthropic'].includes(obj.defaultProvider)
  ) {
    safe.defaultProvider = obj.defaultProvider as PublicSettings['defaultProvider'];
  }
  if (typeof obj.geminiModel === 'string' && obj.geminiModel.trim()) {
    safe.geminiModel = obj.geminiModel.trim();
  }
  if (typeof obj.openaiModel === 'string' && obj.openaiModel.trim()) {
    safe.openaiModel = obj.openaiModel.trim();
  }
  if (typeof obj.anthropicModel === 'string' && obj.anthropicModel.trim()) {
    safe.anthropicModel = obj.anthropicModel.trim();
  }
  return Object.keys(safe).length > 0 ? safe : null;
}

function loadSafeCloudPreferences(): CloudSafePreferences | null {
  const raw = loadJsonStorage<Record<string, unknown>>(CLOUD_SETTINGS_KEY);
  if (!raw) return null;
  const safe = pickSafeCloudPreferences(raw);
  // Actively scrub any legacy secret fields from browser storage
  if (
    'geminiApiKey' in raw ||
    'openaiApiKey' in raw ||
    'anthropicApiKey' in raw ||
    'bridgeToken' in raw ||
    'ownerPasscode' in raw
  ) {
    if (safe) {
      saveJsonStorage(CLOUD_SETTINGS_KEY, safe);
    } else {
      removeStorage(CLOUD_SETTINGS_KEY);
    }
  }
  return safe;
}

const DEFAULT_SETTINGS: PublicSettings = {
  defaultProvider: 'gemini',
  hasGeminiKey: false,
  hasOpenaiKey: false,
  hasAnthropicKey: false,
  geminiKeyPreview: '',
  openaiKeyPreview: '',
  anthropicKeyPreview: '',
  geminiModel: 'gemini-2.5-flash',
  openaiModel: 'gpt-4o-mini',
  anthropicModel: 'claude-sonnet-4-5',
  hasBridgeToken: false,
  bridgeTokenPreview: '',
  authConfigured: true,
};

class ApiHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
  }
}

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiHttpError(errBody.error || `HTTP ${res.status}`, res.status);
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

function removeStorage(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // Ignore
  }
}

function normalizeAgentZones(a: Agent): Agent {
  return {
    ...a,
    homeZone: normalizeZoneId(a.homeZone),
    currentZone: normalizeZoneId(a.currentZone),
    targetZone: normalizeZoneId(a.targetZone),
  };
}

function normalizeSnapshotZones(snap: WorkspaceSnapshot): WorkspaceSnapshot {
  return {
    ...snap,
    agents: (snap.agents || []).map(normalizeAgentZones),
  };
}

function isColdServerSnapshot(snap: WorkspaceSnapshot): boolean {
  return (
    (snap.missions?.length || 0) === 0 &&
    (snap.tasks?.length || 0) === 0 &&
    (snap.comms?.length || 0) <= 1 &&
    (snap.agents || []).length === 0
  );
}

export function useMuseSocket() {
  const [authStatus, setAuthStatus] = useState<AuthStatus>('checking');
  const [authError, setAuthError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [transportMode, setTransportMode] = useState<TransportMode>('ws');
  const [isServerless, setIsServerless] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [comms, setComms] = useState<CommsMessage[]>([]);
  const [beams, setBeams] = useState<CommandBeam[]>([]);
  const [settings, setSettings] = useState<PublicSettings>(DEFAULT_SETTINGS);
  const [stateResetNotice, setStateResetNotice] = useState<string | null>(null);

  const reconnectTimer = useRef<number | null>(null);
  const transportRef = useRef<TransportMode>('ws');
  const cursorRef = useRef<number>(1);
  const sseInFlightRef = useRef<boolean>(false);
  const pollInFlightRef = useRef<boolean>(false);
  const cloudBootedRef = useRef<boolean>(false);
  const lastCommandAtRef = useRef<number>(0);
  const hasActiveWorkRef = useRef<boolean>(false);
  const kickCloudPollRef = useRef<() => void>(() => {});
  const agentsRef = useRef<Agent[]>([]);
  agentsRef.current = agents;
  hasActiveWorkRef.current =
    missions.some((m) => m.status === 'running') ||
    tasks.some(
      (t) =>
        t.status === 'working' ||
        t.status === 'in-progress' ||
        t.status === 'assigned' ||
        t.status === 'delegated'
    );

  const markCommandActivity = useCallback(() => {
    lastCommandAtRef.current = Date.now();
    if (transportRef.current === 'cloud') {
      kickCloudPollRef.current();
    }
  }, []);

  const applySnapshot = useCallback((rawSnap: WorkspaceSnapshot) => {
    const snap = normalizeSnapshotZones(rawSnap);
    if (typeof snap.cursor === 'number' && Number.isFinite(snap.cursor)) {
      cursorRef.current = snap.cursor;
    }
    setAgents(snap.agents || []);
    setMissions(snap.missions || []);
    setTasks(snap.tasks || []);
    setComms(snap.comms || []);
    setBeams((snap.beams || []).filter((b) => b.expiresAt > Date.now()));
    setStateResetNotice(snap.stateResetNotice || null);
    if (snap.settings) setSettings(snap.settings);
  }, []);

  const applyEvent = useCallback(
    (event: string, payload: unknown) => {
      switch (event) {
        case 'snapshot':
          applySnapshot(payload as WorkspaceSnapshot);
          break;
        case 'agent:updated': {
          const incoming = normalizeAgentZones(payload as Agent);
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
          setStateResetNotice(null);
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
          setBeams((prev) => [
            ...prev.filter(
              (b) =>
                b.expiresAt > now &&
                !(
                  b.id.startsWith('opt-beam-') &&
                  b.fromAgentId === incoming.fromAgentId &&
                  b.toAgentId === incoming.toAgentId
                )
            ),
            incoming,
          ]);
          break;
        }
        case 'settings:updated':
          setSettings(payload as PublicSettings);
          break;
      }
    },
    [applySnapshot]
  );

  // Check session state first on initial load and clean up retired v2 demo cache keys
  useEffect(() => {
    removeStorage('musehq_cloud_workspace_v2');
    removeStorage('musehq_cloud_settings_v2');
    let active = true;
    const checkSession = async () => {
      try {
        const session = await apiJson<{
          authenticated: boolean;
          authConfigured: boolean;
          serverless: boolean;
        }>('/api/auth/session');
        if (!active) return;
        setIsServerless(Boolean(session.serverless));
        if (!session.authConfigured) {
          setAuthStatus('setup-required');
        } else if (session.authenticated) {
          setAuthStatus('authenticated');
        } else {
          setAuthStatus('locked');
        }
      } catch {
        if (active) setAuthStatus('locked');
      }
    };
    void checkSession();
    return () => {
      active = false;
    };
  }, []);

  // Persist cloud workspace state locally ONLY while authenticated in Cloud mode
  useEffect(() => {
    if (authStatus !== 'authenticated' || transportMode !== 'cloud' || !cloudBootedRef.current) {
      return;
    }
    if (agents.length === 0 && missions.length === 0 && tasks.length === 0) {
      removeStorage(CLOUD_CACHE_KEY);
      return;
    }
    saveJsonStorage(CLOUD_CACHE_KEY, {
      agents,
      missions: missions.slice(-30),
      tasks: tasks.slice(-150),
      comms: comms.slice(-150),
    });
  }, [authStatus, transportMode, agents, missions, tasks, comms]);

  // Connect WebSocket / Cloud Sync once owner session is authenticated
  useEffect(() => {
    if (authStatus !== 'authenticated') {
      setConnected(false);
      return;
    }

    let active = true;
    let socket: WebSocket | null = null;
    let cloudPollTimer: number | null = null;
    let wsRetryDelayMs = 400;
    let catchupInFlight = false;
    let lastFocusSyncAt = 0;

    const connectWebSocket = () => {
      if (!active) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws/ui`;
      socket = new WebSocket(wsUrl);

      socket.onopen = () => {
        wsRetryDelayMs = 400;
        if (active) setConnected(true);
      };

      socket.onclose = (evt) => {
        if (!active) return;
        setConnected(false);
        if (evt.code === 4001) {
          setAuthStatus('locked');
          return;
        }
        const delay = wsRetryDelayMs;
        wsRetryDelayMs = Math.min(2500, wsRetryDelayMs * 2);
        reconnectTimer.current = window.setTimeout(connectWebSocket, delay);
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

    const pollCloudState = async () => {
      if (!active || sseInFlightRef.current || pollInFlightRef.current) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      pollInFlightRef.current = true;
      try {
        const snap = await apiJson<WorkspaceSnapshot>(`/api/state?since=${cursorRef.current}`);
        if (!active) return;
        setConnected(true);

        const remoteCursor = typeof snap.cursor === 'number' ? snap.cursor : cursorRef.current;
        const cold = isColdServerSnapshot(snap);

        if (remoteCursor < cursorRef.current) {
          cursorRef.current = remoteCursor;
          if (!cold) {
            applySnapshot(snap);
          }
          return;
        }

        if (cold && agentsRef.current.length > snap.agents.length) {
          // Preserve locally cached custom agents across a cold serverless instance until next hydration
          return;
        }

        cursorRef.current = remoteCursor;
        setAgents((snap.agents || []).map(normalizeAgentZones));

        if (snap.missions) {
          setMissions(snap.missions);
        }

        if (snap.tasks && snap.tasks.length > 0) {
          setTasks((prev) => {
            const byId = new Map(prev.map((t) => [t.id, t]));
            for (const incoming of snap.tasks) {
              byId.set(incoming.id, incoming);
            }
            return Array.from(byId.values());
          });
        }

        if (snap.comms && snap.comms.length > 0) {
          setComms((prev) => {
            const seen = new Set(prev.map((m) => m.id));
            const additions = snap.comms.filter((m) => !seen.has(m.id));
            return additions.length > 0 ? [...prev, ...additions].slice(-200) : prev;
          });
        }

        setBeams((snap.beams || []).filter((b) => b.expiresAt > Date.now()));
        setStateResetNotice(snap.stateResetNotice || null);
        if (snap.settings) {
          const safePrefs = loadSafeCloudPreferences();
          setSettings(
            cold && safePrefs?.defaultProvider
              ? { ...snap.settings, ...safePrefs }
              : snap.settings
          );
        }
      } catch (err) {
        if (!active) return;
        if (err instanceof ApiHttpError && err.status === 401) {
          setAuthStatus('locked');
          return;
        }
        setConnected(false);
      } finally {
        pollInFlightRef.current = false;
      }
    };

    const boot = async () => {
      let serverless = false;
      try {
        const health = await apiJson<{ serverless?: boolean }>('/api/health');
        serverless = Boolean(health.serverless);
      } catch {
        // Fallback to standard WS attempt
      }

      if (!active) return;
      setIsServerless(serverless);

      if (serverless) {
        transportRef.current = 'cloud';
        setTransportMode('cloud');
        setConnected(true);

        const cached = loadJsonStorage<Partial<WorkspaceSnapshot>>(CLOUD_CACHE_KEY);
        const safePrefs = loadSafeCloudPreferences();
        try {
          const snap = await apiJson<WorkspaceSnapshot>('/api/state');
          if (!active) return;
          const cold = isColdServerSnapshot(snap);

          if (cold && cached?.agents && cached.agents.length > 0) {
            const serverIds = new Set(snap.agents.map((a) => a.id));
            const cachedById = new Map(cached.agents.map((a) => [a.id, a]));
            const mergedAgents = [
              ...snap.agents.map((srv) => {
                const prev = cachedById.get(srv.id);
                return prev && srv.type === 'builtin' ? { ...srv, ...prev } : srv;
              }),
              ...cached.agents.filter(
                (a) => !serverIds.has(a.id) && (a.type === 'builtin' || a.type === 'external-webhook')
              ),
            ];
            applySnapshot({
              ...snap,
              agents: mergedAgents,
              missions: cached.missions && cached.missions.length > 0 ? cached.missions : snap.missions,
              tasks: cached.tasks && cached.tasks.length > 0 ? cached.tasks : snap.tasks,
              comms: cached.comms && cached.comms.length > 0 ? cached.comms : snap.comms,
              settings: safePrefs ? { ...snap.settings, ...safePrefs } : snap.settings,
            });
          } else {
            applySnapshot({
              ...snap,
              settings: cold && safePrefs ? { ...snap.settings, ...safePrefs } : snap.settings,
            });
          }
        } catch (err) {
          if (err instanceof ApiHttpError && err.status === 401) {
            setAuthStatus('locked');
            return;
          }
          if (cached?.agents) {
            applySnapshot({
              agents: cached.agents,
              missions: cached.missions || [],
              tasks: cached.tasks || [],
              comms: cached.comms || [],
              beams: [],
              settings: safePrefs ? { ...DEFAULT_SETTINGS, ...safePrefs } : DEFAULT_SETTINGS,
            });
          }
        } finally {
          cloudBootedRef.current = true;
        }

        const scheduleNextCloudPoll = () => {
          if (!active) return;
          if (cloudPollTimer !== null) {
            clearTimeout(cloudPollTimer);
            cloudPollTimer = null;
          }
          const isHot =
            hasActiveWorkRef.current || Date.now() - lastCommandAtRef.current < 10_000;
          const intervalMs = isHot ? 900 : 2500;
          cloudPollTimer = window.setTimeout(() => {
            cloudPollTimer = null;
            void pollCloudState().finally(() => {
              scheduleNextCloudPoll();
            });
          }, intervalMs);
        };

        kickCloudPollRef.current = () => {
          if (active && cloudBootedRef.current && transportRef.current === 'cloud') {
            scheduleNextCloudPoll();
          }
        };

        if (active) {
          scheduleNextCloudPoll();
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
        .catch((err) => {
          if (active && err instanceof ApiHttpError && err.status === 401) {
            setAuthStatus('locked');
          }
        });
    };

    const handleVisibilityOrFocus = () => {
      if (!active) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - lastFocusSyncAt < 250) return;
      lastFocusSyncAt = now;

      if (transportRef.current === 'cloud') {
        if (cloudBootedRef.current) {
          void pollCloudState();
        }
        return;
      }

      if (
        !socket ||
        (socket.readyState !== WebSocket.OPEN && socket.readyState !== WebSocket.CONNECTING)
      ) {
        if (reconnectTimer.current) {
          clearTimeout(reconnectTimer.current);
          reconnectTimer.current = null;
        }
        wsRetryDelayMs = 400;
        connectWebSocket();
      }

      if (catchupInFlight) return;
      catchupInFlight = true;
      apiJson<WorkspaceSnapshot>('/api/state')
        .then((snap) => {
          if (active) applySnapshot(snap);
        })
        .catch((err) => {
          if (active && err instanceof ApiHttpError && err.status === 401) {
            setAuthStatus('locked');
          }
        })
        .finally(() => {
          catchupInFlight = false;
        });
    };

    document.addEventListener('visibilitychange', handleVisibilityOrFocus);
    window.addEventListener('focus', handleVisibilityOrFocus);

    void boot();

    return () => {
      active = false;
      kickCloudPollRef.current = () => {};
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (cloudPollTimer !== null) clearTimeout(cloudPollTimer);
      socket?.close();
    };
  }, [authStatus, applyEvent, applySnapshot]);

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

  const login = useCallback(async (passcode: string) => {
    setAuthError(null);
    try {
      await apiJson<{ ok: boolean }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ passcode }),
      });
      setAuthStatus('authenticated');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Login gagal';
      setAuthError(msg);
      throw err;
    }
  }, []);

  const logout = useCallback(async () => {
    await apiJson('/api/auth/logout', { method: 'POST' }).catch(() => {});
    removeStorage(CLOUD_CACHE_KEY);
    cursorRef.current = 1;
    setAgents([]);
    setMissions([]);
    setTasks([]);
    setComms([]);
    setBeams([]);
    setSettings(DEFAULT_SETTINGS);
    setConnected(false);
    setAuthStatus('locked');
  }, []);

  const handleAuthGuard = (err: unknown): never => {
    if (err instanceof ApiHttpError && err.status === 401) {
      setAuthStatus('locked');
    }
    throw err;
  };

  const syncFromMutation = useCallback(
    (res: { snapshot?: WorkspaceSnapshot; agent?: Agent }) => {
      if (transportRef.current !== 'cloud') return;
      if (res.snapshot) {
        if (typeof res.snapshot.cursor === 'number') {
          cursorRef.current = res.snapshot.cursor;
        }
        const snap = normalizeSnapshotZones(res.snapshot);
        if (snap.agents) setAgents(snap.agents);
        if (snap.comms) setComms(snap.comms);
        if (snap.settings) setSettings(snap.settings);
      } else if (res.agent) {
        applyEvent('agent:updated', res.agent);
      }
    },
    [applyEvent]
  );

  const launchMission = useCallback(
    async (prompt: string, targetAgentId: string) => {
      markCommandActivity();
      const now = Date.now();
      const targetAgent = agentsRef.current.find((a) => a.id === targetAgentId);
      const optBeamId = `opt-beam-${now}-${Math.random().toString(36).slice(2, 6)}`;
      const optBubble: SpeechBubble = {
        text: 'Menerima perintah...',
        kind: 'command',
        expiresAt: now + 3200,
      };
      const prevBubble = targetAgent?.speechBubble ?? null;

      if (targetAgentId) {
        const optBeam: CommandBeam = {
          id: optBeamId,
          fromAgentId: 'user',
          toAgentId: targetAgentId,
          label: 'Perintah baru',
          color: targetAgent?.color || '#f59e0b',
          createdAt: now,
          expiresAt: now + 3200,
        };
        setBeams((prev) => [...prev.filter((b) => b.expiresAt > now), optBeam]);
        setAgents((prev) =>
          prev.map((a) => (a.id === targetAgentId ? { ...a, speechBubble: optBubble } : a))
        );
      }

      const revertOptimisticLaunch = () => {
        const ts = Date.now();
        setBeams((prev) => prev.filter((b) => b.id !== optBeamId));
        if (targetAgentId) {
          setAgents((prev) =>
            prev.map((a) =>
              a.id === targetAgentId && a.speechBubble === optBubble
                ? {
                    ...a,
                    speechBubble: prevBubble && prevBubble.expiresAt > ts ? prevBubble : null,
                  }
                : a
            )
          );
        }
      };

      if (transportRef.current !== 'cloud') {
        try {
          const res = await apiJson<{ mission: Mission; snapshot?: WorkspaceSnapshot }>(
            '/api/missions',
            {
              method: 'POST',
              body: JSON.stringify({ prompt, targetAgentId }),
            }
          );
          if (res.snapshot) {
            applySnapshot(res.snapshot);
          } else if (res.mission) {
            setMissions((prev) =>
              prev.some((m) => m.id === res.mission.id)
                ? prev.map((m) => (m.id === res.mission.id ? res.mission : m))
                : [...prev, res.mission]
            );
          }
          return res;
        } catch (err) {
          revertOptimisticLaunch();
          return handleAuthGuard(err);
        }
      }

      const settingsPatch = loadSafeCloudPreferences() || undefined;
      sseInFlightRef.current = true;
      try {
        const res = await fetch('/api/missions', {
          method: 'POST',
          credentials: 'same-origin',
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

        if (res.status === 401) {
          setAuthStatus('locked');
          throw new Error('Sesi berakhir, silakan login ulang.');
        }

        if (!res.ok || !res.body) {
          const errBody = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(errBody.error || `HTTP ${res.status}`);
        }

        setConnected(true);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        let sseErrorMessage: string | null = null;

        const processFrame = (frame: string) => {
          const dataLines = frame
            .split(/\r?\n/)
            .filter((l) => l.startsWith('data: '))
            .map((l) => l.slice(6));
          if (dataLines.length === 0) return;
          let parsed: { event: string; payload: unknown };
          try {
            parsed = JSON.parse(dataLines.join('\n')) as { event: string; payload: unknown };
          } catch {
            return;
          }
          if (parsed.event === 'done') {
            if (parsed.payload && typeof parsed.payload === 'object') {
              applySnapshot(parsed.payload as WorkspaceSnapshot);
            }
          } else if (parsed.event === 'error') {
            const msg = (parsed.payload as { message?: string } | null)?.message;
            sseErrorMessage = msg || 'Gagal menjalankan misi';
          } else {
            applyEvent(parsed.event, parsed.payload);
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split(/\r?\n\r?\n/);
          buffer = frames.pop() || '';
          for (const frame of frames) {
            processFrame(frame);
          }
        }
        buffer += decoder.decode();
        if (buffer.trim()) {
          processFrame(buffer);
        }
        if (sseErrorMessage) {
          throw new Error(sseErrorMessage);
        }
        return { ok: true };
      } catch (err) {
        revertOptimisticLaunch();
        throw err;
      } finally {
        sseInFlightRef.current = false;
      }
    },
    [applyEvent, applySnapshot, markCommandActivity]
  );

  const createAgent = useCallback(
    async (payload: Partial<Agent>) => {
      const res = await apiJson<{ agent: Agent; snapshot?: WorkspaceSnapshot }>('/api/agents', {
        method: 'POST',
        body: JSON.stringify(payload),
      }).catch(handleAuthGuard);
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
      ).catch(handleAuthGuard);
      syncFromMutation(res);
      return res;
    },
    [syncFromMutation]
  );

  const deleteAgent = useCallback(async (id: string) => {
    const res = await apiJson<{ ok: boolean }>(`/api/agents/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }).catch(handleAuthGuard);
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
      ).catch(handleAuthGuard);
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
      markCommandActivity();
      const isCloud = transportRef.current === 'cloud';
      const settingsPatch = isCloud ? loadSafeCloudPreferences() || undefined : undefined;

      const now = Date.now();
      const fromAgent = agentsRef.current.find((a) => a.id === fromAgentId);
      const toAgent =
        toAgentId !== 'all' ? agentsRef.current.find((a) => a.id === toAgentId) : undefined;
      const optBeamId = `opt-beam-${now}-${Math.random().toString(36).slice(2, 6)}`;
      const optSenderBubble: SpeechBubble = {
        text: createTask
          ? `Delegasi: ${title?.trim() || content.trim().slice(0, 48)}`
          : content.trim().slice(0, 72),
        kind: createTask ? 'command' : 'chat',
        expiresAt: now + 3000,
      };
      const optReceiverBubble: SpeechBubble | null =
        createTask && toAgent
          ? { text: 'Menerima perintah...', kind: 'command', expiresAt: now + 3000 }
          : null;
      const prevSenderBubble = fromAgent?.speechBubble ?? null;
      const prevReceiverBubble = toAgent?.speechBubble ?? null;

      if (toAgent) {
        setBeams((prev) => [
          ...prev.filter((b) => b.expiresAt > now),
          {
            id: optBeamId,
            fromAgentId,
            toAgentId,
            label: createTask ? title?.trim() || 'Perintah baru' : content.trim().slice(0, 32),
            color: fromAgent?.color || '#38bdf8',
            createdAt: now,
            expiresAt: now + 3000,
          },
        ]);
      }
      setAgents((prev) =>
        prev.map((a) => {
          if (a.id === fromAgentId) return { ...a, speechBubble: optSenderBubble };
          if (optReceiverBubble && toAgent && a.id === toAgent.id) {
            return { ...a, speechBubble: optReceiverBubble };
          }
          return a;
        })
      );

      try {
        const res = await apiJson<{ ok: boolean; snapshot?: WorkspaceSnapshot }>(
          `/api/agents/${encodeURIComponent(fromAgentId)}/chat`,
          {
            method: 'POST',
            body: JSON.stringify({
              toAgentId,
              content,
              createTask,
              title,
              ...(isCloud && (settingsPatch || agentsRef.current.length > 0)
                ? { clientContext: { agents: agentsRef.current, settingsPatch } }
                : {}),
            }),
          }
        );
        if (res.snapshot) {
          if (typeof res.snapshot.cursor === 'number') {
            cursorRef.current = res.snapshot.cursor;
          }
          if (!isCloud) {
            applySnapshot(res.snapshot);
          } else {
            if (res.snapshot.missions) {
              setMissions(res.snapshot.missions);
            }
            if (res.snapshot.tasks) {
              for (const t of res.snapshot.tasks) applyEvent('task:updated', t);
            }
            if (res.snapshot.comms) {
              for (const c of res.snapshot.comms) applyEvent('comms:message', c);
            }
            if (res.snapshot.beams) {
              setBeams(res.snapshot.beams.filter((b) => b.expiresAt > Date.now()));
            }
            if (res.snapshot.agents) setAgents(res.snapshot.agents.map(normalizeAgentZones));
          }
        }
        return res;
      } catch (err) {
        const ts = Date.now();
        setBeams((prev) => prev.filter((b) => b.id !== optBeamId));
        setAgents((prev) =>
          prev.map((a) => {
            if (a.id === fromAgentId && a.speechBubble === optSenderBubble) {
              return {
                ...a,
                speechBubble:
                  prevSenderBubble && prevSenderBubble.expiresAt > ts ? prevSenderBubble : null,
              };
            }
            if (optReceiverBubble && toAgent && a.id === toAgent.id && a.speechBubble === optReceiverBubble) {
              return {
                ...a,
                speechBubble:
                  prevReceiverBubble && prevReceiverBubble.expiresAt > ts ? prevReceiverBubble : null,
              };
            }
            return a;
          })
        );
        return handleAuthGuard(err);
      }
    },
    [applyEvent, applySnapshot, markCommandActivity]
  );

  const triggerAllHands = useCallback(
    async (mode: 'war-room' | 'desks' | 'coffee-lounge') => {
      const res = await apiJson<{ ok: boolean; snapshot?: WorkspaceSnapshot }>(
        '/api/office/all-hands',
        {
          method: 'POST',
          body: JSON.stringify({ mode }),
        }
      ).catch(handleAuthGuard);
      if (transportRef.current === 'cloud' && res.snapshot) {
        if (typeof res.snapshot.cursor === 'number') {
          cursorRef.current = res.snapshot.cursor;
        }
        if (res.snapshot.agents) setAgents(res.snapshot.agents.map(normalizeAgentZones));
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
      // Never cache sensitive API keys, bridgeToken, or ownerPasscode in browser localStorage
      const safePatch = pickSafeCloudPreferences(patch);
      if (safePatch) {
        const existing = loadSafeCloudPreferences() || {};
        saveJsonStorage(CLOUD_SETTINGS_KEY, { ...existing, ...safePatch });
      }
    }
    const res = await apiJson<{ settings: PublicSettings }>('/api/settings', {
      method: 'POST',
      body: JSON.stringify(patch),
    }).catch(handleAuthGuard);
    if (transportRef.current === 'cloud' && res.settings) {
      setSettings(res.settings);
    }
    return res;
  }, []);

  const clearHistory = useCallback(async () => {
    const res = await apiJson<{ ok: boolean; snapshot?: WorkspaceSnapshot }>('/api/missions/clear', {
      method: 'POST',
    }).catch(handleAuthGuard);
    if (transportRef.current === 'cloud') {
      if (typeof res.snapshot?.cursor === 'number') {
        cursorRef.current = res.snapshot.cursor;
      }
      setMissions([]);
      setTasks([]);
      setBeams([]);
      setComms(res.snapshot?.comms || []);
    }
    return res;
  }, []);

  const resetWorkspace = useCallback(async () => {
    const res = await apiJson<{ ok: boolean; snapshot?: WorkspaceSnapshot }>(
      '/api/workspace/reset',
      { method: 'POST' }
    ).catch(handleAuthGuard);
    if (transportRef.current === 'cloud') {
      removeStorage(CLOUD_CACHE_KEY);
    }
        if (res.snapshot) {
          applySnapshot(res.snapshot);
        }
        return res;
      },
      [applySnapshot]
    );

  const cancelTask = useCallback(
    async (taskId: string) => {
      const res = await apiJson<{ ok: boolean; snapshot?: WorkspaceSnapshot }>(
        `/api/tasks/${encodeURIComponent(taskId)}/cancel`,
        { method: 'POST' }
      ).catch(handleAuthGuard);
      if (transportRef.current === 'cloud' && res.snapshot) {
        applySnapshot(res.snapshot);
      }
      return res;
    },
    [applySnapshot]
  );

  const markTaskFailed = useCallback(
    async (taskId: string, reason?: string) => {
      const res = await apiJson<{ ok: boolean; snapshot?: WorkspaceSnapshot }>(
        `/api/tasks/${encodeURIComponent(taskId)}/fail`,
        {
          method: 'POST',
          body: JSON.stringify(reason ? { reason } : {}),
        }
      ).catch(handleAuthGuard);
      if (transportRef.current === 'cloud' && res.snapshot) {
        applySnapshot(res.snapshot);
      }
      return res;
    },
    [applySnapshot]
  );

  const reassignTask = useCallback(
    async (taskId: string, targetAgentId?: string) => {
      const res = await apiJson<{ ok: boolean; snapshot?: WorkspaceSnapshot }>(
        `/api/tasks/${encodeURIComponent(taskId)}/reassign`,
        {
          method: 'POST',
          body: JSON.stringify(targetAgentId ? { targetAgentId } : {}),
        }
      ).catch(handleAuthGuard);
      if (transportRef.current === 'cloud' && res.snapshot) {
        applySnapshot(res.snapshot);
      }
      return res;
    },
    [applySnapshot]
  );

  const dismissResetNotice = useCallback(() => {
    setStateResetNotice(null);
  }, []);

  return {
    authStatus,
    authError,
    isServerless,
    connected,
    transportMode,
    agents,
    missions,
    tasks,
    comms,
    beams,
    settings,
    stateResetNotice,
    dismissResetNotice,
    login,
    logout,
    launchMission,
    createAgent,
    updateAgent,
    deleteAgent,
    moveAgent,
    sendBotCommand,
    triggerAllHands,
    updateSettings,
    clearHistory,
    resetWorkspace,
    cancelTask,
    markTaskFailed,
    reassignTask,
  };
}
