import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Coffee,
  Compass,
  Flame,
  Maximize2,
  Moon,
  Sun,
  Users,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  BurstParticle,
  FloorRipple,
  RenderBotState,
  createRenderBotState,
  drawEffectsAndBeams,
  drawEnhancedSpeechBubble,
  drawRealisticBot,
  updateBotAnimationState,
} from '../canvas/botRenderer';
import {
  FurnitureDrawable,
  LightingMode,
  MAP_H,
  MAP_W,
  collectOfficeFurniture,
  drawAmbientParticles,
  drawIsometricFloorAndZones,
  drawOfficeWallsAndWindows,
  drawStudioBackdrop,
  findZoneAt,
  isoToScreen,
  screenToIso,
} from '../canvas/officeEnvironment';
import { Agent, CommandBeam, Task, TaskStatus, ZoneId } from '../types';
import { isSoundEnabled, playUiCue, toggleSoundEnabled } from '../utils/soundEffects';

interface OfficeCanvasProps {
  agents: Agent[];
  beams: CommandBeam[];
  tasks?: Task[];
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string | null) => void;
  onMoveAgent: (agentId: string, zone: ZoneId) => void;
  onAllHands: (mode: 'war-room' | 'desks' | 'coffee-lounge') => void;
}

const LIGHTING_STORAGE_KEY = 'musehq_lighting_mode';
const LIGHTING_ORDER: LightingMode[] = ['studio', 'midnight', 'warm'];

const LIGHTING_META: Record<
  LightingMode,
  { label: string; title: string; badgeCls: string }
> = {
  studio: {
    label: 'Studio',
    title: 'Suasana cahaya: Studio Modern (klik untuk ganti)',
    badgeCls: 'border-sky-500/40 bg-slate-900/85 text-sky-200 hover:bg-sky-500/15',
  },
  midnight: {
    label: 'Malam Neon',
    title: 'Suasana cahaya: Malam Neon (klik untuk ganti)',
    badgeCls: 'border-violet-500/45 bg-slate-900/85 text-violet-200 hover:bg-violet-500/20',
  },
  warm: {
    label: 'Hangat',
    title: 'Suasana cahaya: Hangat Kreatif (klik untuk ganti)',
    badgeCls: 'border-amber-500/45 bg-slate-900/85 text-amber-200 hover:bg-amber-500/15',
  },
};

function loadInitialLighting(): LightingMode {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const saved = window.localStorage.getItem(LIGHTING_STORAGE_KEY);
      if (saved === 'studio' || saved === 'midnight' || saved === 'warm') {
        return saved;
      }
    }
  } catch {
    // Ignore storage access errors
  }
  return 'studio';
}

function formatWibTime(): string {
  try {
    return new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
      .format(new Date())
      .replace('.', ':');
  } catch {
    const now = new Date();
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  }
}

export const OfficeCanvas: React.FC<OfficeCanvasProps> = ({
  agents,
  beams,
  tasks = [],
  selectedAgentId,
  onSelectAgent,
  onMoveAgent,
  onAllHands,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [lightingMode, setLightingMode] = useState<LightingMode>(loadInitialLighting);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => isSoundEnabled());
  const [wibTime, setWibTime] = useState<string>(() => formatWibTime());
  const [zoomUi, setZoomUi] = useState(1);

  const agentsRef = useRef(agents);
  agentsRef.current = agents;
  const beamsRef = useRef(beams);
  beamsRef.current = beams;
  const selectedRef = useRef(selectedAgentId);
  selectedRef.current = selectedAgentId;
  const lightingModeRef = useRef<LightingMode>(lightingMode);
  lightingModeRef.current = lightingMode;

  const stuckAgentIdsRef = useRef<Set<string>>(new Set());
  stuckAgentIdsRef.current = new Set(
    tasks.filter((t) => t.status === 'stuck').map((t) => t.assignedToId)
  );

  const hasActiveMissionRef = useRef<boolean>(false);
  hasActiveMissionRef.current =
    agents.some((a) => a.status === 'working' || a.status === 'thinking') ||
    tasks.some(
      (t) =>
        t.status === 'working' ||
        t.status === 'in-progress' ||
        t.status === 'assigned' ||
        t.status === 'delegated'
    );

  const renderPositions = useRef<Map<string, RenderBotState>>(new Map());
  const particlesRef = useRef<BurstParticle[]>([]);
  const ripplesRef = useRef<FloorRipple[]>([]);
  const hoveredAgentRef = useRef<string | null>(null);
  const hoveredZoneRef = useRef<ZoneId | null>(null);

  const cameraRef = useRef({ panX: 0, panY: 0, zoom: 1, initialized: false });
  const cameraTargetRef = useRef({ panX: 0, panY: 0, zoom: 1, initialized: false });
  const dragRef = useRef({
    dragging: false,
    moved: false,
    startX: 0,
    startY: 0,
    origPanX: 0,
    origPanY: 0,
  });

  const seenBeamIdsRef = useRef<Set<string>>(new Set());
  const prevTaskStatusesRef = useRef<Map<string, TaskStatus>>(new Map());

  const activeWorkerCount = agents.filter(
    (a) => a.status === 'working' || a.status === 'thinking'
  ).length;

  // Live WIB clock tick for the studio HUD pill
  useEffect(() => {
    setWibTime(formatWibTime());
    const id = window.setInterval(() => {
      setWibTime(formatWibTime());
    }, 15_000);
    return () => window.clearInterval(id);
  }, []);

  // Trigger floor ripples + subtle sound cues on incoming beams
  useEffect(() => {
    const now = Date.now();
    const seen = seenBeamIdsRef.current;

    for (const beam of beams) {
      if (seen.has(beam.id)) continue;
      seen.add(beam.id);
      if (now - beam.createdAt > 4000) continue;

      const targetState = renderPositions.current.get(beam.toAgentId);
      const targetAgent = agentsRef.current.find((a) => a.id === beam.toAgentId);
      const gx = targetState?.x ?? targetAgent?.position.x;
      const gy = targetState?.y ?? targetAgent?.position.y;
      if (gx !== undefined && gy !== undefined && ripplesRef.current.length < 48) {
        ripplesRef.current.push({
          gx,
          gy,
          color: beam.color || '#38bdf8',
          startedAt: now,
          durationMs: 950,
        });
      }

      if (beam.fromAgentId !== 'user' && beam.fromAgentId !== 'system') {
        playUiCue('delegate');
      }
    }

    if (seen.size > 200) {
      const liveIds = new Set(beams.map((b) => b.id));
      for (const id of seen) {
        if (!liveIds.has(id)) seen.delete(id);
      }
    }
  }, [beams]);

  // Trigger completion celebration sparks/ripples & sound cues when tasks complete or fail
  useEffect(() => {
    const prevMap = prevTaskStatusesRef.current;
    const now = Date.now();
    let playedComplete = false;
    let playedError = false;

    for (const task of tasks) {
      const prevStatus = prevMap.get(task.id);
      const changedFromActive = Boolean(
        prevStatus && prevStatus !== task.status && prevStatus !== 'completed' && prevStatus !== 'failed'
      );
      const completedRecently =
        task.status === 'completed' &&
        task.completedAt &&
        now - Date.parse(task.completedAt) < 5000 &&
        prevStatus !== 'completed';

      if (task.status === 'completed' && (changedFromActive || completedRecently)) {
        if (!playedComplete) {
          playUiCue('complete');
          playedComplete = true;
        }
        const botState = renderPositions.current.get(task.assignedToId);
        const assignee = agentsRef.current.find((a) => a.id === task.assignedToId);
        const gx = botState?.x ?? assignee?.position.x;
        const gy = botState?.y ?? assignee?.position.y;
        if (gx !== undefined && gy !== undefined) {
          if (botState && botState.celebrateUntil <= now) {
            botState.celebrateUntil = now + 2200;
            const sp = isoToScreen(gx, gy);
            const palette = ['#34d399', '#fbbf24', '#38bdf8', '#a78bfa'];
            if (particlesRef.current.length < 180) {
              for (let i = 0; i < 12; i++) {
                const angle = -Math.PI + (Math.PI * i) / 11;
                const speed = 36 + (i % 3) * 18;
                particlesRef.current.push({
                  x: sp.x,
                  y: sp.y - 24,
                  vx: Math.cos(angle) * speed,
                  vy: Math.sin(angle) * speed - 32,
                  color: palette[i % palette.length],
                  life: 0.72,
                  maxLife: 0.72,
                  size: 2.4,
                });
              }
            }
          }
          if (ripplesRef.current.length < 48) {
            ripplesRef.current.push({
              gx,
              gy,
              color: '#34d399',
              startedAt: now,
              durationMs: 1100,
            });
          }
        }
      } else if (task.status === 'failed' && changedFromActive && !playedError) {
        playUiCue('error');
        playedError = true;
      }
      prevMap.set(task.id, task.status);
    }

    if (prevMap.size > 400) {
      const liveIds = new Set(tasks.map((t) => t.id));
      for (const id of prevMap.keys()) {
        if (!liveIds.has(id)) prevMap.delete(id);
      }
    }
  }, [tasks]);

  const computeFitCamera = useCallback(() => {
    const el = containerRef.current;
    if (!el) return null;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (w <= 0 || h <= 0) return null;
    const fitZoom = Math.min(Math.max(Math.min(w / 920, h / 560), 0.78), 1.35);
    const centerIso = isoToScreen(MAP_W / 2 - 0.5, MAP_H / 2 - 0.5);
    return {
      panX: w / 2 - centerIso.x * fitZoom,
      panY: h / 2 - centerIso.y * fitZoom - 16,
      zoom: fitZoom,
      initialized: true,
    };
  }, []);

  const resetCamera = useCallback(
    (immediate = false) => {
      const next = computeFitCamera();
      if (!next) return;
      cameraTargetRef.current = { ...next };
      if (immediate || !cameraRef.current.initialized) {
        cameraRef.current = { ...next };
      }
      setZoomUi(Math.round(next.zoom * 100) / 100);
    },
    [computeFitCamera]
  );

  const focusCameraOnGrid = useCallback((gx: number, gy: number, minZoom?: number) => {
    const el = containerRef.current;
    if (!el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (w <= 0 || h <= 0) return;

    const target = cameraTargetRef.current;
    const nextZoom = minZoom
      ? Math.min(Math.max(target.zoom, minZoom), 1.85)
      : target.zoom;
    const pt = isoToScreen(gx, gy);
    target.zoom = nextZoom;
    target.panX = w / 2 - pt.x * nextZoom;
    target.panY = h / 2 - (pt.y - 16) * nextZoom - 12;
    target.initialized = true;
    setZoomUi(Math.round(nextZoom * 100) / 100);
  }, []);

  // Gently pan camera into view if selected agent (e.g. chosen from RightPanel) is offscreen
  useEffect(() => {
    if (!selectedAgentId) return;
    const el = containerRef.current;
    if (!el || !cameraTargetRef.current.initialized) return;
    const agent = agentsRef.current.find((a) => a.id === selectedAgentId);
    if (!agent) return;
    const rp = renderPositions.current.get(agent.id) || agent.position;
    const sp = isoToScreen(rp.x, rp.y);
    const target = cameraTargetRef.current;
    const screenX = sp.x * target.zoom + target.panX;
    const screenY = sp.y * target.zoom + target.panY;
    const marginX = 56;
    const marginTop = 64;
    const marginBottom = 135;
    if (
      screenX < marginX ||
      screenX > el.clientWidth - marginX ||
      screenY < marginTop ||
      screenY > el.clientHeight - marginBottom
    ) {
      focusCameraOnGrid(rp.x, rp.y);
    }
  }, [selectedAgentId, focusCameraOnGrid]);

  useEffect(() => {
    resetCamera(true);
    const obs = new ResizeObserver(() => {
      if (!cameraRef.current.initialized) {
        resetCamera(true);
      }
    });
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, [resetCamera]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    let rafId = 0;
    let lastTime = performance.now();

    const frame = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;
      const t = now / 1000;
      const nowMs = Date.now();

      const dpr = window.devicePixelRatio || 1;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w <= 0 || h <= 0) {
        rafId = requestAnimationFrame(frame);
        return;
      }

      const targetW = Math.floor(w * dpr);
      const targetH = Math.floor(h * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Smooth spring camera interpolation
      const cam = cameraRef.current;
      const targetCam = cameraTargetRef.current;
      if (cam.initialized && targetCam.initialized && !dragRef.current.dragging) {
        const lerp = 1 - Math.exp(-12 * dt);
        const dxPan = targetCam.panX - cam.panX;
        const dyPan = targetCam.panY - cam.panY;
        const dZoom = targetCam.zoom - cam.zoom;
        if (Math.abs(dxPan) > 0.1 || Math.abs(dyPan) > 0.1 || Math.abs(dZoom) > 0.0005) {
          cam.panX += dxPan * lerp;
          cam.panY += dyPan * lerp;
          cam.zoom += dZoom * lerp;
        } else {
          cam.panX = targetCam.panX;
          cam.panY = targetCam.panY;
          cam.zoom = targetCam.zoom;
        }
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = true;

      const mode = lightingModeRef.current;
      const activeAgents = agentsRef.current;

      // 1. Screen-space studio atmospheric backdrop
      drawStudioBackdrop(ctx, w, h, t, mode);

      ctx.save();
      ctx.translate(cam.panX, cam.panY);
      ctx.scale(cam.zoom, cam.zoom);

      // 2. Isometric floor slab, textured zones, active spotlights & glowing data bus
      drawIsometricFloorAndZones(ctx, t, activeAgents, hoveredZoneRef.current, mode);

      // 3. Architectural walls, windows, city skyline, real-time clock & Kanban board
      drawOfficeWallsAndWindows(ctx, t, activeAgents, mode);

      // 4. Collect furniture props & bots for depth sorting
      const drawables: FurnitureDrawable[] = collectOfficeFurniture(
        activeAgents,
        t,
        hasActiveMissionRef.current
      );

      const currentBotCoords = new Map<string, { sx: number; sy: number }>();
      const activeIds = new Set(activeAgents.map((a) => a.id));
      for (const cachedId of renderPositions.current.keys()) {
        if (!activeIds.has(cachedId)) renderPositions.current.delete(cachedId);
      }
      const claimedDest: Array<{ x: number; y: number }> = [];

      activeAgents.forEach((agent, index) => {
        const rawDest =
          agent.status === 'walking'
            ? agent.targetPosition || agent.position
            : agent.position || agent.targetPosition;
        const baseDest = rawDest || { x: 10, y: 7 };
        let destX = baseDest.x;
        let destY = baseDest.y;

        let collisionCount = 0;
        while (
          claimedDest.some((p) => Math.hypot(p.x - destX, p.y - destY) < 0.25) &&
          collisionCount < 8
        ) {
          collisionCount += 1;
          const angle = collisionCount * 1.1;
          destX = baseDest.x + Math.cos(angle) * 0.45;
          destY = baseDest.y + Math.sin(angle) * 0.35;
        }
        claimedDest.push({ x: destX, y: destY });

        let state = renderPositions.current.get(agent.id);
        if (!state) {
          state = createRenderBotState(agent, index);
          renderPositions.current.set(agent.id, state);
        }

        const isSelected = selectedRef.current === agent.id;
        updateBotAnimationState(
          state,
          agent,
          destX,
          destY,
          dt,
          nowMs,
          particlesRef.current,
          ripplesRef.current,
          isSelected,
          isoToScreen
        );

        const screenPt = isoToScreen(state.x, state.y);
        currentBotCoords.set(agent.id, { sx: screenPt.x, sy: screenPt.y });

        const botStateSnapshot = { ...state };
        const isHovered = hoveredAgentRef.current === agent.id;
        const hasStuckTask = stuckAgentIdsRef.current.has(agent.id);
        drawables.push({
          gx: state.x,
          gy: state.y,
          draw: (c) =>
            drawRealisticBot(
              c,
              agent,
              botStateSnapshot,
              t,
              nowMs,
              isSelected,
              isHovered,
              hasStuckTask,
              isoToScreen
            ),
        });
      });

      // 5. Painter's sort back-to-front (furniture + bots)
      drawables.sort((a, b) => a.gx + a.gy - (b.gx + b.gy));
      for (const item of drawables) {
        const sp = isoToScreen(item.gx, item.gy);
        item.draw(ctx, sp.x, sp.y, t);
      }

      // 6. Ambient floating light dust motes
      drawAmbientParticles(ctx, t, mode);

      // 7. Floor shockwave ripples, command beam arcs, and burst sparks
      const commanderOriginPt = {
        sx: (w * 0.5 - cam.panX) / cam.zoom,
        sy: (h - 90 - cam.panY) / cam.zoom,
      };
      drawEffectsAndBeams(
        ctx,
        beamsRef.current,
        currentBotCoords,
        commanderOriginPt,
        ripplesRef.current,
        particlesRef.current,
        isoToScreen,
        t,
        nowMs,
        dt
      );

      // 8. Frosted speech bubbles above everything
      for (const agent of activeAgents) {
        if (!agent.speechBubble || agent.speechBubble.expiresAt <= nowMs) continue;
        const pt = currentBotCoords.get(agent.id);
        if (!pt) continue;
        drawEnhancedSpeechBubble(
          ctx,
          pt.sx,
          pt.sy,
          agent.speechBubble.text,
          agent.speechBubble.kind
        );
      }

      ctx.restore();
      rafId = requestAnimationFrame(frame);
    };

    rafId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const hitTestAgent = (clientX: number, clientY: number): Agent | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const cam = cameraRef.current;
    const worldX = (clientX - rect.left - cam.panX) / cam.zoom;
    const worldY = (clientY - rect.top - cam.panY) / cam.zoom;

    let closest: { agent: Agent; dist: number } | null = null;
    for (const agent of agentsRef.current) {
      const rp = renderPositions.current.get(agent.id) || {
        x: agent.position.x,
        y: agent.position.y,
      };
      const sp = isoToScreen(rp.x, rp.y);
      const dx = worldX - sp.x;
      const dy = worldY - (sp.y - 18);
      const dist = Math.hypot(dx, dy);
      if (dist < 26 && (!closest || dist < closest.dist)) {
        closest = { agent, dist };
      }
    }
    return closest?.agent ?? null;
  };

  const hitTestZone = (clientX: number, clientY: number): ZoneId | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const cam = cameraRef.current;
    const worldX = (clientX - rect.left - cam.panX) / cam.zoom;
    const worldY = (clientY - rect.top - cam.panY) / cam.zoom;
    const { gx, gy } = screenToIso(worldX, worldY);
    return findZoneAt(gx, gy);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = {
      dragging: true,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
      origPanX: cameraRef.current.panX,
      origPanY: cameraRef.current.panY,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current.dragging) {
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      if (Math.hypot(dx, dy) > 4) {
        dragRef.current.moved = true;
        const nextPanX = dragRef.current.origPanX + dx;
        const nextPanY = dragRef.current.origPanY + dy;
        cameraRef.current.panX = nextPanX;
        cameraRef.current.panY = nextPanY;
        cameraTargetRef.current.panX = nextPanX;
        cameraTargetRef.current.panY = nextPanY;
      }
      return;
    }

    const hitAgent = hitTestAgent(e.clientX, e.clientY);
    hoveredAgentRef.current = hitAgent?.id ?? null;
    hoveredZoneRef.current = hitAgent ? null : hitTestZone(e.clientX, e.clientY);
    if (canvasRef.current) {
      canvasRef.current.style.cursor = hitAgent ? 'pointer' : 'grab';
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const wasDrag = dragRef.current.moved;
    dragRef.current.dragging = false;
    if (wasDrag) return;

    const hit = hitTestAgent(e.clientX, e.clientY);
    if (hit) {
      playUiCue('click');
    }
    onSelectAgent(hit ? hit.id : null);
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const hitAgent = hitTestAgent(e.clientX, e.clientY);
    if (hitAgent) {
      const rp = renderPositions.current.get(hitAgent.id) || hitAgent.position;
      onSelectAgent(hitAgent.id);
      focusCameraOnGrid(rp.x, rp.y, 1.08);
      playUiCue('click');
      return;
    }

    if (!selectedRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cam = cameraRef.current;
    const worldX = (e.clientX - rect.left - cam.panX) / cam.zoom;
    const worldY = (e.clientY - rect.top - cam.panY) / cam.zoom;
    const { gx, gy } = screenToIso(worldX, worldY);
    const zone = findZoneAt(gx, gy);
    if (zone) {
      if (ripplesRef.current.length < 48) {
        ripplesRef.current.push({
          gx,
          gy,
          color: '#fbbf24',
          startedAt: Date.now(),
          durationMs: 850,
        });
      }
      playUiCue('click');
      onMoveAgent(selectedRef.current, zone);
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const target = cameraTargetRef.current;

    const factor = e.deltaY < 0 ? 1.1 : 0.91;
    const nextZoom = Math.min(Math.max(target.zoom * factor, 0.58), 1.85);
    const ratio = nextZoom / target.zoom;
    target.panX = mx - (mx - target.panX) * ratio;
    target.panY = my - (my - target.panY) * ratio;
    target.zoom = nextZoom;
    setZoomUi(Math.round(nextZoom * 100) / 100);
  };

  const adjustZoom = (delta: number) => {
    const el = containerRef.current;
    if (!el) return;
    const cx = el.clientWidth / 2;
    const cy = el.clientHeight / 2;
    const target = cameraTargetRef.current;
    const nextZoom = Math.min(Math.max(target.zoom + delta, 0.58), 1.85);
    const ratio = nextZoom / target.zoom;
    target.panX = cx - (cx - target.panX) * ratio;
    target.panY = cy - (cy - target.panY) * ratio;
    target.zoom = nextZoom;
    setZoomUi(Math.round(nextZoom * 100) / 100);
    playUiCue('click');
  };

  const cycleLightingMode = () => {
    const idx = LIGHTING_ORDER.indexOf(lightingMode);
    const next = LIGHTING_ORDER[(idx + 1) % LIGHTING_ORDER.length];
    setLightingMode(next);
    try {
      window.localStorage.setItem(LIGHTING_STORAGE_KEY, next);
    } catch {
      // Ignore storage failures
    }
    playUiCue('click');
  };

  const handleToggleSound = () => {
    setSoundEnabled(toggleSoundEnabled());
  };

  const lightingInfo = LIGHTING_META[lightingMode];

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden select-none">
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => {
          dragRef.current.dragging = false;
          hoveredAgentRef.current = null;
          hoveredZoneRef.current = null;
        }}
        onDoubleClick={handleDoubleClick}
        onWheel={handleWheel}
        className="block h-full w-full"
      />

      {/* Top Canvas Overlay Bar (prevents overlap between live status/hint pill & controls) */}
      <div className="pointer-events-none absolute top-3 right-3 left-3 flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="flex items-center gap-2 rounded-lg border border-slate-700/75 bg-slate-900/85 px-2.5 py-1.5 text-[11px] text-slate-200 backdrop-blur-md"
            title="Klik bot: inspeksi • 2x klik bot: fokus • 2x klik ruangan: pindah • Drag & Scroll: kamera"
          >
            <span
              className={`h-2 w-2 rounded-full ${
                activeWorkerCount > 0 ? 'bg-emerald-400 animate-pulse' : 'bg-sky-400'
              }`}
            />
            <span className="font-medium">
              {activeWorkerCount > 0 ? `${activeWorkerCount} aktif bekerja` : 'Studio Siap'}
            </span>
            <span className="text-slate-600">•</span>
            <span className="font-mono text-[10px] text-slate-400">{wibTime} WIB</span>
          </div>

          <div className="hidden rounded-lg border border-slate-700/70 bg-slate-900/80 px-3 py-1.5 text-[11px] text-slate-300 backdrop-blur-md 2xl:block">
            Klik bot: inspeksi • 2x klik ruangan: pindah • Drag & Scroll: kamera
          </div>
        </div>

        {/* Room, Atmosphere & Camera Controls */}
        <div className="pointer-events-auto ml-auto flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              playUiCue('click');
              onAllHands('war-room');
            }}
            className="flex items-center gap-1.5 rounded-lg border border-violet-500/40 bg-slate-900/85 px-2.5 py-1.5 text-xs font-medium text-violet-200 backdrop-blur-md transition hover:bg-violet-500/20 cursor-pointer"
            title="Kumpulkan semua bot di War Room"
          >
            <Users className="h-3.5 w-3.5" />
            <span>War Room</span>
          </button>
          <button
            type="button"
            onClick={() => {
              playUiCue('click');
              onAllHands('desks');
            }}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700/80 bg-slate-900/85 px-2.5 py-1.5 text-xs font-medium text-slate-200 backdrop-blur-md transition hover:bg-slate-800 cursor-pointer"
            title="Kembalikan bot ke meja masing-masing"
          >
            <Compass className="h-3.5 w-3.5" />
            <span>Ke Meja</span>
          </button>
          <button
            type="button"
            onClick={() => {
              playUiCue('click');
              onAllHands('coffee-lounge');
            }}
            className="flex items-center gap-1.5 rounded-lg border border-orange-500/35 bg-slate-900/85 px-2.5 py-1.5 text-xs font-medium text-orange-200 backdrop-blur-md transition hover:bg-orange-500/20 cursor-pointer"
            title="Istirahat di Coffee Lounge"
          >
            <Coffee className="h-3.5 w-3.5" />
            <span>Lounge</span>
          </button>

          {/* Lighting Atmosphere Cycle */}
          <button
            type="button"
            onClick={cycleLightingMode}
            className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium backdrop-blur-md transition cursor-pointer ${lightingInfo.badgeCls}`}
            title={lightingInfo.title}
            aria-label={lightingInfo.title}
          >
            {lightingMode === 'studio' ? (
              <Sun className="h-3.5 w-3.5" />
            ) : lightingMode === 'midnight' ? (
              <Moon className="h-3.5 w-3.5" />
            ) : (
              <Flame className="h-3.5 w-3.5" />
            )}
            <span className="hidden sm:inline">{lightingInfo.label}</span>
          </button>

          {/* Studio Sound Toggle */}
          <button
            type="button"
            onClick={handleToggleSound}
            className={`flex items-center gap-1 rounded-lg border px-2 py-1.5 text-xs font-medium backdrop-blur-md transition cursor-pointer ${
              soundEnabled
                ? 'border-emerald-500/40 bg-slate-900/85 text-emerald-200 hover:bg-emerald-500/15'
                : 'border-slate-700/80 bg-slate-900/85 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
            title={soundEnabled ? 'Suara Studio: Aktif (klik untuk bisukan)' : 'Suara Studio: Bisukan (klik untuk aktifkan)'}
            aria-label={soundEnabled ? 'Nonaktifkan suara studio' : 'Aktifkan suara studio'}
          >
            {soundEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
          </button>

          <div className="ml-0.5 flex items-center rounded-lg border border-slate-700/80 bg-slate-900/85 p-0.5 backdrop-blur-md">
            <button
              type="button"
              onClick={() => adjustZoom(-0.15)}
              className="rounded p-1.5 text-slate-300 transition hover:bg-slate-800 hover:text-white cursor-pointer"
              aria-label="Zoom out"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <span className="px-1.5 font-mono text-[11px] text-slate-400">
              {Math.round(zoomUi * 100)}%
            </span>
            <button
              type="button"
              onClick={() => adjustZoom(0.15)}
              className="rounded p-1.5 text-slate-300 transition hover:bg-slate-800 hover:text-white cursor-pointer"
              aria-label="Zoom in"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => {
                playUiCue('click');
                resetCamera(false);
              }}
              className="rounded p-1.5 text-slate-300 transition hover:bg-slate-800 hover:text-white cursor-pointer"
              aria-label="Reset camera"
              title="Reset kamera"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
