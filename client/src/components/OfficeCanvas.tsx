import React, { useEffect, useRef, useState } from 'react';
import { Coffee, Compass, Maximize2, Users, ZoomIn, ZoomOut } from 'lucide-react';
import { Agent, CommandBeam, ZONES_META, ZoneId } from '../types';

interface OfficeCanvasProps {
  agents: Agent[];
  beams: CommandBeam[];
  selectedAgentId: string | null;
  onSelectAgent: (agentId: string | null) => void;
  onMoveAgent: (agentId: string, zone: ZoneId) => void;
  onAllHands: (mode: 'war-room' | 'desks' | 'coffee-lounge') => void;
}

const MAP_W = 20;
const MAP_H = 14;
const TILE_W = 58;
const TILE_H = 29;

interface RenderBotState {
  x: number;
  y: number;
  facing: number;
  walkPhase: number;
}

interface PropItem {
  gx: number;
  gy: number;
  draw: (ctx: CanvasRenderingContext2D, sx: number, sy: number, t: number) => void;
}

function isoToScreen(gx: number, gy: number): { x: number; y: number } {
  return {
    x: (gx - gy) * (TILE_W / 2),
    y: (gx + gy) * (TILE_H / 2),
  };
}

function screenToIso(sx: number, sy: number): { gx: number; gy: number } {
  const halfW = TILE_W / 2;
  const halfH = TILE_H / 2;
  const gx = (sx / halfW + sy / halfH) / 2;
  const gy = (sy / halfH - sx / halfW) / 2;
  return { gx, gy };
}

function findZoneAt(gx: number, gy: number): ZoneId | null {
  for (const z of ZONES_META) {
    const { x, y, w, h } = z.bounds;
    if (gx >= x && gx < x + w && gy >= y && gy < y + h) {
      return z.id;
    }
  }
  return null;
}

function drawIsoTile(
  ctx: CanvasRenderingContext2D,
  gx: number,
  gy: number,
  fill: string,
  stroke?: string,
  inset = 0
) {
  const top = isoToScreen(gx + inset, gy + inset);
  const right = isoToScreen(gx + 1 - inset, gy + inset);
  const bottom = isoToScreen(gx + 1 - inset, gy + 1 - inset);
  const left = isoToScreen(gx + inset, gy + 1 - inset);

  ctx.beginPath();
  ctx.moveTo(top.x, top.y);
  ctx.lineTo(right.x, right.y);
  ctx.lineTo(bottom.x, bottom.y);
  ctx.lineTo(left.x, left.y);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function drawIsoBox(
  ctx: CanvasRenderingContext2D,
  gx: number,
  gy: number,
  gw: number,
  gh: number,
  heightPx: number,
  topColor: string,
  leftColor: string,
  rightColor: string
) {
  const p0 = isoToScreen(gx, gy);
  const p1 = isoToScreen(gx + gw, gy);
  const p2 = isoToScreen(gx + gw, gy + gh);
  const p3 = isoToScreen(gx, gy + gh);

  // Top face
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y - heightPx);
  ctx.lineTo(p1.x, p1.y - heightPx);
  ctx.lineTo(p2.x, p2.y - heightPx);
  ctx.lineTo(p3.x, p3.y - heightPx);
  ctx.closePath();
  ctx.fillStyle = topColor;
  ctx.fill();

  // Left-front face (p3 -> p2)
  ctx.beginPath();
  ctx.moveTo(p3.x, p3.y - heightPx);
  ctx.lineTo(p2.x, p2.y - heightPx);
  ctx.lineTo(p2.x, p2.y);
  ctx.lineTo(p3.x, p3.y);
  ctx.closePath();
  ctx.fillStyle = leftColor;
  ctx.fill();

  // Right-front face (p2 -> p1)
  ctx.beginPath();
  ctx.moveTo(p2.x, p2.y - heightPx);
  ctx.lineTo(p1.x, p1.y - heightPx);
  ctx.lineTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.closePath();
  ctx.fillStyle = rightColor;
  ctx.fill();
}

function drawDeskProp(
  ctx: CanvasRenderingContext2D,
  gx: number,
  gy: number,
  screenColor: string,
  t: number,
  active: boolean
) {
  drawIsoBox(ctx, gx - 0.55, gy - 0.35, 1.1, 0.6, 13, '#475569', '#334155', '#1e293b');
  // Dual glowing monitors
  const pulse = active ? 0.8 + 0.2 * Math.sin(t * 7) : 0.45;
  const m1 = isoToScreen(gx - 0.35, gy - 0.25);
  const m2 = isoToScreen(gx + 0.15, gy - 0.25);

  for (const m of [m1, m2]) {
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(m.x - 8, m.y - 26, 16, 11);
    ctx.fillStyle = screenColor;
    ctx.globalAlpha = pulse;
    ctx.fillRect(m.x - 7, m.y - 25, 14, 9);
    ctx.globalAlpha = 1;
    // Monitor stand
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(m.x - 1, m.y - 15, 2, 3);
  }
}

function drawPlantProp(ctx: CanvasRenderingContext2D, sx: number, sy: number, t: number) {
  // Terracotta pot
  ctx.fillStyle = '#9a3412';
  ctx.fillRect(sx - 6, sy - 8, 12, 8);
  ctx.fillStyle = '#c2410c';
  ctx.fillRect(sx - 7, sy - 10, 14, 3);
  // Leaves swaying lightly
  const sway = Math.sin(t * 2 + sx) * 1.2;
  ctx.fillStyle = '#15803d';
  ctx.fillRect(sx - 9 + sway, sy - 20, 8, 8);
  ctx.fillRect(sx + 1 - sway, sy - 22, 8, 9);
  ctx.fillStyle = '#22c55e';
  ctx.fillRect(sx - 5 + sway * 0.5, sy - 26, 10, 9);
}

function drawPixelBot(
  ctx: CanvasRenderingContext2D,
  agent: Agent,
  renderState: RenderBotState,
  t: number,
  isSelected: boolean,
  isHovered: boolean
) {
  const { x: sx, y: sy } = isoToScreen(renderState.x, renderState.y);
  const isWalking =
    agent.status === 'walking' ||
    Math.hypot(agent.targetPosition.x - renderState.x, agent.targetPosition.y - renderState.y) > 0.1;
  const isWorking = agent.status === 'working';
  const isThinking = agent.status === 'thinking';
  const isTalking = agent.status === 'talking';
  const isOffline = agent.status === 'offline';

  const bob = isWalking
    ? Math.abs(Math.sin(renderState.walkPhase * 8)) * 4
    : isWorking
      ? Math.sin(t * 10) * 1
      : isTalking
        ? Math.abs(Math.sin(t * 8)) * 1.6
        : Math.sin(t * 2.5 + sx * 0.05) * 1.2;

  ctx.save();
  if (isOffline) ctx.globalAlpha = 0.52;

  // Selection or hover highlight ring on floor
  if (isSelected || isHovered) {
    ctx.beginPath();
    ctx.ellipse(sx, sy + 2, 18, 9, 0, 0, Math.PI * 2);
    ctx.strokeStyle = isSelected ? '#fbbf24' : '#e2e8f0';
    ctx.lineWidth = isSelected ? 2.5 : 1.5;
    if (isSelected) ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Soft floor shadow
  ctx.beginPath();
  ctx.ellipse(sx, sy + 2, 12, 6, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(2, 6, 23, 0.55)';
  ctx.fill();

  const baseY = sy - bob;

  // Legs
  const legOffset = isWalking ? Math.sin(renderState.walkPhase * 8) * 3 : 0;
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(sx - 5, baseY - 6 + legOffset, 4, 7);
  ctx.fillRect(sx + 1, baseY - 6 - legOffset, 4, 7);

  // Body / Hoodie
  ctx.fillStyle = agent.color || '#38bdf8';
  ctx.fillRect(sx - 8, baseY - 19, 16, 13);
  // Shading on right side of torso
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fillRect(sx + 3, baseY - 19, 5, 13);
  // Chest core badge
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(sx - 2, baseY - 15, 4, 4);

  // Arms (animated typing when working)
  const armBounce = isWorking ? Math.sin(t * 18) * 2 : 0;
  ctx.fillStyle = agent.color || '#38bdf8';
  ctx.fillRect(sx - 11, baseY - 18 + armBounce, 3, 9);
  ctx.fillRect(sx + 8, baseY - 18 - armBounce, 3, 9);

  // Head chassis
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(sx - 9, baseY - 33, 18, 14);
  ctx.fillStyle = '#cbd5e1';
  ctx.fillRect(sx + 5, baseY - 33, 4, 14);

  // Screen visor
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(sx - 7, baseY - 30, 14, 9);

  // Eyes inside visor
  const blinking = Math.sin(t * 1.7 + sx * 0.1) > 0.96;
  if (isOffline) {
    ctx.fillStyle = '#ef4444';
    ctx.fillRect(sx - 5, baseY - 26, 3, 2);
    ctx.fillRect(sx + 2, baseY - 26, 3, 2);
  } else if (blinking) {
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(sx - 5, baseY - 25, 3, 1);
    ctx.fillRect(sx + 2, baseY - 25, 3, 1);
  } else {
    ctx.fillStyle = isWorking
      ? '#34d399'
      : isThinking
        ? '#fbbf24'
        : isTalking
          ? '#22d3ee'
          : '#38bdf8';
    const lookX = isThinking ? Math.round(Math.sin(t * 4)) : 0;
    ctx.fillRect(sx - 5 + lookX, baseY - 27, 3, 3);
    ctx.fillRect(sx + 2 + lookX, baseY - 27, 3, 3);
    if (isTalking) {
      const mouthW = Math.floor(t * 9) % 2 === 0 ? 6 : 3;
      ctx.fillStyle = '#67e8f9';
      ctx.fillRect(sx - mouthW / 2, baseY - 23, mouthW, 1.5);
    }
  }

  // Role Accessory
  if (agent.avatarVariant === 'lead') {
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(sx - 6, baseY - 36, 12, 3);
    ctx.fillRect(sx - 2, baseY - 39, 4, 3);
  } else if (agent.avatarVariant === 'coder') {
    ctx.fillStyle = '#10b981';
    ctx.fillRect(sx - 10, baseY - 28, 2, 5);
    ctx.fillRect(sx + 8, baseY - 28, 2, 5);
  } else if (agent.avatarVariant === 'creative') {
    ctx.fillStyle = '#ec4899';
    ctx.fillRect(sx - 7, baseY - 36, 11, 3);
  } else if (agent.avatarVariant === 'external') {
    ctx.fillStyle = '#a855f7';
    ctx.fillRect(sx - 7, baseY - 38, 2, 5);
    ctx.fillRect(sx + 5, baseY - 38, 2, 5);
    ctx.fillStyle = '#e879f9';
    ctx.fillRect(sx - 7, baseY - 40, 2, 2);
    ctx.fillRect(sx + 5, baseY - 40, 2, 2);
  } else {
    // Antenna
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(sx - 1, baseY - 37, 2, 4);
    ctx.fillStyle = agent.color;
    ctx.fillRect(sx - 2, baseY - 39, 4, 2);
  }

  // Working / Thinking / Talking overhead icon
  if (isWorking) {
    ctx.fillStyle = '#10b981';
    ctx.font = 'bold 10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    const spark = Math.floor(t * 4) % 2 === 0 ? '< >' : '{ }';
    ctx.fillText(spark, sx, baseY - 43);
  } else if (isThinking) {
    ctx.fillStyle = '#fbbf24';
    const dot = Math.floor(t * 3) % 3;
    for (let i = 0; i < 3; i++) {
      ctx.globalAlpha = i === dot ? 1 : 0.35;
      ctx.fillRect(sx - 6 + i * 5, baseY - 46, 3, 3);
    }
    ctx.globalAlpha = 1;
  } else if (isTalking) {
    ctx.fillStyle = '#22d3ee';
    for (let i = 0; i < 3; i++) {
      const barH = 3 + Math.round(Math.abs(Math.sin(t * 10 + i * 1.3)) * 5);
      ctx.fillRect(sx - 5 + i * 4, baseY - 42 - barH, 2.5, barH);
    }
  }

  // Nameplate Pill
  ctx.font = '600 10px "Inter", sans-serif';
  const labelText = agent.name;
  const textW = ctx.measureText(labelText).width;
  const pillW = textW + 18;
  const pillX = sx - pillW / 2;
  const pillY = baseY + 8;

  ctx.fillStyle = isSelected ? 'rgba(245, 158, 11, 0.92)' : 'rgba(15, 23, 42, 0.88)';
  ctx.beginPath();
  ctx.roundRect(pillX, pillY, pillW, 16, 5);
  ctx.fill();
  ctx.strokeStyle = isSelected ? '#fde68a' : 'rgba(148, 163, 184, 0.32)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Status dot inside nameplate
  const statusColor =
    agent.status === 'working'
      ? '#10b981'
      : agent.status === 'online'
        ? '#22c55e'
        : agent.status === 'talking'
          ? '#06b6d4'
          : agent.status === 'thinking' || agent.status === 'meeting'
            ? '#fbbf24'
            : agent.status === 'offline' || agent.status === 'error'
              ? '#ef4444'
              : '#38bdf8';
  ctx.fillStyle = statusColor;
  ctx.beginPath();
  ctx.arc(pillX + 7, pillY + 8, 2.7, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = isSelected ? '#0f172a' : '#f1f5f9';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(labelText, pillX + 13, pillY + 8.5);

  // Subtle Role Sub-tag beneath Nameplate
  const shortRole = agent.role.length > 26 ? `${agent.role.slice(0, 24)}..` : agent.role;
  ctx.font = '500 8px "JetBrains Mono", monospace';
  const roleW = ctx.measureText(shortRole).width + 10;
  ctx.fillStyle = 'rgba(2, 6, 23, 0.72)';
  ctx.beginPath();
  ctx.roundRect(sx - roleW / 2, pillY + 17.5, roleW, 11.5, 3);
  ctx.fill();
  ctx.fillStyle = isOffline ? '#64748b' : '#94a3b8';
  ctx.textAlign = 'center';
  ctx.fillText(shortRole, sx, pillY + 23.5);

  if (agent.brainMode) {
    const isFallback = agent.brainMode === 'fallback';
    const brainTag = isFallback ? 'Tanpa otak' : agent.brainMode;
    ctx.font = '600 7.5px "JetBrains Mono", monospace';
    const brainW = ctx.measureText(brainTag).width + 10;
    ctx.fillStyle = isFallback
      ? 'rgba(225, 29, 72, 0.9)'
      : agent.brainMode === 'muse-langsung'
        ? 'rgba(8, 145, 178, 0.85)'
        : 'rgba(15, 23, 42, 0.85)';
    ctx.beginPath();
    ctx.roundRect(sx - brainW / 2, pillY + 30.5, brainW, 10.5, 3);
    ctx.fill();
    ctx.fillStyle = isFallback ? '#ffe4e6' : '#bae6fd';
    ctx.fillText(brainTag, sx, pillY + 35.8);
  }

  ctx.restore();
}

function drawSpeechBubble(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  text: string,
  kind: 'chat' | 'command' | 'report' | 'error'
) {
  ctx.save();
  ctx.font = '500 11px "Inter", sans-serif';

  // Wrap text into max 2 lines
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > 165 && line) {
      lines.push(line);
      line = w;
      if (lines.length === 2) break;
    } else {
      line = next;
    }
  }
  if (line && lines.length < 3) lines.push(line);
  if (lines.length > 2) lines.length = 2;

  const contentW = Math.max(...lines.map((l) => ctx.measureText(l).width), 48);
  const boxW = contentW + 18;
  const boxH = lines.length * 14 + 12;
  const bx = sx - boxW / 2;
  const by = sy - 58 - boxH;

  const border =
    kind === 'command'
      ? '#f59e0b'
      : kind === 'report'
        ? '#10b981'
        : kind === 'error'
          ? '#ef4444'
          : '#38bdf8';

  ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
  ctx.beginPath();
  ctx.roundRect(bx, by, boxW, boxH, 7);
  ctx.fill();
  ctx.strokeStyle = border;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Pointer triangle
  ctx.beginPath();
  ctx.moveTo(sx - 5, by + boxH);
  ctx.lineTo(sx + 5, by + boxH);
  ctx.lineTo(sx, by + boxH + 6);
  ctx.closePath();
  ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
  ctx.fill();
  ctx.strokeStyle = border;
  ctx.stroke();

  ctx.fillStyle = '#f8fafc';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  lines.forEach((ln, idx) => {
    ctx.fillText(ln, bx + 9, by + 6 + idx * 14);
  });
  ctx.restore();
}

export const OfficeCanvas: React.FC<OfficeCanvasProps> = ({
  agents,
  beams,
  selectedAgentId,
  onSelectAgent,
  onMoveAgent,
  onAllHands,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const agentsRef = useRef(agents);
  agentsRef.current = agents;
  const beamsRef = useRef(beams);
  beamsRef.current = beams;
  const selectedRef = useRef(selectedAgentId);
  selectedRef.current = selectedAgentId;

  const renderPositions = useRef<Map<string, RenderBotState>>(new Map());
  const hoveredAgentRef = useRef<string | null>(null);
  const hoveredZoneRef = useRef<ZoneId | null>(null);

  const cameraRef = useRef({ panX: 0, panY: 0, zoom: 1, initialized: false });
  const dragRef = useRef({ dragging: false, moved: false, startX: 0, startY: 0, origPanX: 0, origPanY: 0 });
  const [zoomUi, setZoomUi] = useState(1);

  const resetCamera = () => {
    const el = containerRef.current;
    if (!el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    const fitZoom = Math.min(Math.max(Math.min(w / 920, h / 560), 0.78), 1.35);
    const centerIso = isoToScreen(MAP_W / 2 - 0.5, MAP_H / 2 - 0.5);
    cameraRef.current = {
      panX: w / 2 - centerIso.x * fitZoom,
      panY: h / 2 - centerIso.y * fitZoom - 16,
      zoom: fitZoom,
      initialized: true,
    };
    setZoomUi(Math.round(fitZoom * 100) / 100);
  };

  useEffect(() => {
    resetCamera();
    const obs = new ResizeObserver(() => {
      if (!cameraRef.current.initialized) resetCamera();
    });
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

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

      const dpr = window.devicePixelRatio || 1;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.imageSmoothingEnabled = false;

      // Clear ambient studio backdrop
      const bgGrad = ctx.createRadialGradient(w * 0.5, h * 0.45, 40, w * 0.5, h * 0.5, Math.max(w, h) * 0.8);
      bgGrad.addColorStop(0, '#131d33');
      bgGrad.addColorStop(1, '#070b14');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, w, h);

      const cam = cameraRef.current;
      ctx.save();
      ctx.translate(cam.panX, cam.panY);
      ctx.scale(cam.zoom, cam.zoom);

      // 1. Isometric Floor Tiles
      for (let gx = 0; gx < MAP_W; gx++) {
        for (let gy = 0; gy < MAP_H; gy++) {
          const checker = (gx + gy) % 2 === 0;
          const isHallway = gx === 6 || gx === 13 || gy === 5 || gy === 9;
          const fill = isHallway
            ? checker
              ? '#243047'
              : '#202b40'
            : checker
              ? '#182235'
              : '#151e30';
          drawIsoTile(ctx, gx, gy, fill, 'rgba(148, 163, 184, 0.06)');
        }
      }

      // 2. Room Zone Rugs & Perimeter Glow
      for (const zone of ZONES_META) {
        const { x, y, w: zw, h: zh } = zone.bounds;
        for (let gx = x; gx < x + zw; gx++) {
          for (let gy = y; gy < y + zh; gy++) {
            drawIsoTile(ctx, gx, gy, zone.floorTint, undefined, 0.04);
          }
        }

        // Zone outline
        const p0 = isoToScreen(x, y);
        const p1 = isoToScreen(x + zw, y);
        const p2 = isoToScreen(x + zw, y + zh);
        const p3 = isoToScreen(x, y + zh);
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(p3.x, p3.y);
        ctx.closePath();
        ctx.strokeStyle =
          hoveredZoneRef.current === zone.id ? '#f8fafc' : `${zone.accent}66`;
        ctx.lineWidth = hoveredZoneRef.current === zone.id ? 2 : 1.2;
        ctx.stroke();

        // Zone label badge at front-bottom edge so desks never cover it
        const labelPos = isoToScreen(x + 0.3, y + zh - 0.25);
        ctx.font = '700 9px "JetBrains Mono", monospace';
        ctx.fillStyle = zone.accent;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${zone.shortLabel} · ${zone.label.toUpperCase()}`, labelPos.x + 6, labelPos.y - 2);
      }

      // 3. Floor Data Bus Lines connecting central War Room to zones
      const hub = isoToScreen(10, 7);
      const zoneHubTargets: Array<{ x: number; y: number; color: string }> = [
        { x: 3.5, y: 3, color: '#f59e0b' },
        { x: 10, y: 3, color: '#06b6d4' },
        { x: 16, y: 3.5, color: '#10b981' },
        { x: 3.5, y: 8.5, color: '#ec4899' },
        { x: 16, y: 8.5, color: '#3b82f6' },
        { x: 10, y: 11, color: '#f97316' },
      ];
      ctx.save();
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 6]);
      ctx.lineDashOffset = -t * 14;
      for (const tgt of zoneHubTargets) {
        const pt = isoToScreen(tgt.x, tgt.y);
        ctx.strokeStyle = `${tgt.color}44`;
        ctx.beginPath();
        ctx.moveTo(hub.x, hub.y);
        ctx.lineTo(pt.x, pt.y);
        ctx.stroke();
      }
      ctx.restore();

      // 4. Back Isometric Walls (y=0 and x=0)
      const wallH = 44;
      const topCorner = isoToScreen(0, 0);
      const rightCorner = isoToScreen(MAP_W, 0);
      const leftCorner = isoToScreen(0, MAP_H);

      // Left-back wall (x=0, y=0..MAP_H)
      ctx.beginPath();
      ctx.moveTo(topCorner.x, topCorner.y - wallH);
      ctx.lineTo(leftCorner.x, leftCorner.y - wallH);
      ctx.lineTo(leftCorner.x, leftCorner.y);
      ctx.lineTo(topCorner.x, topCorner.y);
      ctx.closePath();
      ctx.fillStyle = '#1e293b';
      ctx.fill();
      ctx.strokeStyle = '#334155';
      ctx.stroke();

      // Right-back wall (y=0, x=0..MAP_W)
      ctx.beginPath();
      ctx.moveTo(topCorner.x, topCorner.y - wallH);
      ctx.lineTo(rightCorner.x, rightCorner.y - wallH);
      ctx.lineTo(rightCorner.x, rightCorner.y);
      ctx.lineTo(topCorner.x, topCorner.y);
      ctx.closePath();
      ctx.fillStyle = '#273549';
      ctx.fill();
      ctx.strokeStyle = '#334155';
      ctx.stroke();

      // Wall panoramic night windows along back walls
      for (let i = 2; i < MAP_W - 2; i += 4) {
        const w0 = isoToScreen(i, 0);
        const w1 = isoToScreen(i + 2.4, 0);
        ctx.beginPath();
        ctx.moveTo(w0.x, w0.y - 34);
        ctx.lineTo(w1.x, w1.y - 34);
        ctx.lineTo(w1.x, w1.y - 12);
        ctx.lineTo(w0.x, w0.y - 12);
        ctx.closePath();
        ctx.fillStyle = '#0c192c';
        ctx.fill();
        ctx.strokeStyle = '#38bdf844';
        ctx.stroke();
      }

      // 5. Smoothly interpolate bot positions and collect depth-sorted props + bots
      const activeAgents = agentsRef.current;
      const drawables: PropItem[] = [];

      // Furniture props
      const deskCheck = (zoneId: ZoneId) =>
        activeAgents.some((a) => a.currentZone === zoneId && a.status === 'working');

      drawables.push({
        gx: 3,
        gy: 2.2,
        draw: (c) => drawDeskProp(c, 3, 2.2, '#f59e0b', t, deskCheck('command-desk')),
      });
      drawables.push({
        gx: 10,
        gy: 2.1,
        draw: (c) => drawDeskProp(c, 10, 2.1, '#06b6d4', t, deskCheck('research-library')),
      });
      drawables.push({
        gx: 16.2,
        gy: 2.3,
        draw: (c) => drawDeskProp(c, 16.2, 2.3, '#10b981', t, deskCheck('engineering-bay')),
      });
      // Server Rack in Dev Bay
      drawables.push({
        gx: 18,
        gy: 1.5,
        draw: (c) => {
          drawIsoBox(c, 17.5, 1.1, 0.8, 0.8, 34, '#334155', '#0f172a', '#1e293b');
          const sp = isoToScreen(17.9, 1.9);
          for (let row = 0; row < 4; row++) {
            c.fillStyle = (Math.floor(t * 5) + row) % 3 === 0 ? '#10b981' : '#38bdf8';
            c.fillRect(sp.x - 10, sp.y - 28 + row * 6, 4, 2);
          }
        },
      });
      drawables.push({
        gx: 3,
        gy: 7.2,
        draw: (c) => drawDeskProp(c, 3, 7.2, '#ec4899', t, deskCheck('creative-studio')),
      });
      drawables.push({
        gx: 16.2,
        gy: 8.1,
        draw: (c) => drawDeskProp(c, 16.2, 8.1, '#3b82f6', t, deskCheck('qa-bench')),
      });

      // Central War Room Conference Table + Floating Hologram Core
      drawables.push({
        gx: 9.8,
        gy: 7,
        draw: (c) => {
          drawIsoBox(c, 8.9, 6.2, 2.0, 1.5, 12, '#3b2d66', '#2e1f56', '#221642');
          const core = isoToScreen(9.9, 7.0);
          const floatY = Math.sin(t * 3) * 3;
          c.save();
          c.globalAlpha = 0.85;
          c.fillStyle = '#a78bfa';
          c.beginPath();
          c.moveTo(core.x, core.y - 32 + floatY);
          c.lineTo(core.x + 10, core.y - 24 + floatY);
          c.lineTo(core.x, core.y - 16 + floatY);
          c.lineTo(core.x - 10, core.y - 24 + floatY);
          c.closePath();
          c.fill();
          c.strokeStyle = '#ddd6fe';
          c.lineWidth = 1.2;
          c.stroke();
          c.restore();
        },
      });

      // Coffee Lounge Bar
      drawables.push({
        gx: 9.5,
        gy: 11.8,
        draw: (c) => {
          drawIsoBox(c, 8.6, 11.3, 1.8, 0.7, 14, '#78350f', '#451a03', '#5c2408');
          const bar = isoToScreen(9.3, 11.6);
          c.fillStyle = '#e2e8f0';
          c.fillRect(bar.x - 5, bar.y - 24, 10, 10);
          // Animated coffee steam
          c.fillStyle = 'rgba(248, 250, 252, 0.45)';
          const steamY = ((t * 14) % 10);
          c.fillRect(bar.x - 1, bar.y - 28 - steamY, 2, 3);
        },
      });

      // Potted Plants
      for (const [px, py] of [
        [1.2, 1.2],
        [13.4, 1.2],
        [1.2, 10.6],
        [18.5, 10.6],
      ]) {
        drawables.push({
          gx: px,
          gy: py,
          draw: (c, sx, sy) => drawPlantProp(c, sx, sy, t),
        });
      }

      // Update & queue bots for depth sorting (with anti-stacking offset if spots collide)
      const currentBotCoords = new Map<string, { sx: number; sy: number }>();
      const activeIds = new Set(activeAgents.map((a) => a.id));
      for (const cachedId of renderPositions.current.keys()) {
        if (!activeIds.has(cachedId)) renderPositions.current.delete(cachedId);
      }
      const claimedDest: Array<{ x: number; y: number }> = [];

      for (const agent of activeAgents) {
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
          state = { x: destX, y: destY, facing: 1, walkPhase: 0 };
          renderPositions.current.set(agent.id, state);
        }

        const dx = destX - state.x;
        const dy = destY - state.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 0.04) {
          const step = Math.min(dist, dt * 4.5);
          state.x += (dx / dist) * step;
          state.y += (dy / dist) * step;
          state.walkPhase += dt * 1.4;
          state.facing = dx >= dy ? 1 : -1;
        } else {
          state.x = destX;
          state.y = destY;
        }

        const screenPt = isoToScreen(state.x, state.y);
        currentBotCoords.set(agent.id, { sx: screenPt.x, sy: screenPt.y });

        const botStateSnapshot = { ...state };
        drawables.push({
          gx: state.x,
          gy: state.y,
          draw: (c) =>
            drawPixelBot(
              c,
              agent,
              botStateSnapshot,
              t,
              selectedRef.current === agent.id,
              hoveredAgentRef.current === agent.id
            ),
        });
      }

      // Painter's sort back-to-front
      drawables.sort((a, b) => a.gx + a.gy - (b.gx + b.gy));
      for (const item of drawables) {
        const sp = isoToScreen(item.gx, item.gy);
        item.draw(ctx, sp.x, sp.y, t);
      }

      // 6. Command Beams (Bot-to-Bot animated arcs)
      const realNow = Date.now();
      const activeBeams = beamsRef.current;
      for (const beam of activeBeams) {
        if (beam.expiresAt <= realNow) continue;
        const fromPt = currentBotCoords.get(beam.fromAgentId);
        const toPt = currentBotCoords.get(beam.toAgentId);
        if (!fromPt || !toPt) continue;

        const startX = fromPt.sx;
        const startY = fromPt.sy - 26;
        const endX = toPt.sx;
        const endY = toPt.sy - 26;
        const ctrlX = (startX + endX) / 2;
        const ctrlY = Math.min(startY, endY) - 52;

        ctx.save();
        ctx.strokeStyle = beam.color;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 5]);
        ctx.lineDashOffset = -t * 36;
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.quadraticCurveTo(ctrlX, ctrlY, endX, endY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Traveling glowing packet orb along quadratic curve
        const elapsed = Math.max(0, realNow - beam.createdAt);
        const prog = (elapsed % 1200) / 1200;
        const u = 1 - prog;
        const orbX = u * u * startX + 2 * u * prog * ctrlX + prog * prog * endX;
        const orbY = u * u * startY + 2 * u * prog * ctrlY + prog * prog * endY;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(orbX, orbY, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = beam.color;
        ctx.beginPath();
        ctx.arc(orbX, orbY, 7, 0, Math.PI * 2);
        ctx.globalAlpha = 0.35;
        ctx.fill();
        ctx.globalAlpha = 1;

        // Beam task tag at apex
        ctx.font = '600 9px "JetBrains Mono", monospace';
        const tagW = ctx.measureText(beam.label).width + 12;
        const apexY = 0.25 * startY + 0.5 * ctrlY + 0.25 * endY;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
        ctx.beginPath();
        ctx.roundRect(ctrlX - tagW / 2, apexY - 16, tagW, 16, 4);
        ctx.fill();
        ctx.strokeStyle = beam.color;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = '#f8fafc';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(beam.label, ctrlX, apexY - 8);
        ctx.restore();
      }

      // 7. Speech Bubbles on top
      for (const agent of activeAgents) {
        if (!agent.speechBubble || agent.speechBubble.expiresAt <= realNow) continue;
        const pt = currentBotCoords.get(agent.id);
        if (!pt) continue;
        drawSpeechBubble(ctx, pt.sx, pt.sy, agent.speechBubble.text, agent.speechBubble.kind);
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
        cameraRef.current.panX = dragRef.current.origPanX + dx;
        cameraRef.current.panY = dragRef.current.origPanY + dy;
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
    onSelectAgent(hit ? hit.id : null);
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!selectedRef.current) return;
    const zone = hitTestZone(e.clientX, e.clientY);
    if (zone) {
      onMoveAgent(selectedRef.current, zone);
    }
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const cam = cameraRef.current;

    const factor = e.deltaY < 0 ? 1.09 : 0.92;
    const nextZoom = Math.min(Math.max(cam.zoom * factor, 0.58), 1.85);
    const ratio = nextZoom / cam.zoom;
    cam.panX = mx - (mx - cam.panX) * ratio;
    cam.panY = my - (my - cam.panY) * ratio;
    cam.zoom = nextZoom;
    setZoomUi(Math.round(nextZoom * 100) / 100);
  };

  const adjustZoom = (delta: number) => {
    const el = containerRef.current;
    if (!el) return;
    const cx = el.clientWidth / 2;
    const cy = el.clientHeight / 2;
    const cam = cameraRef.current;
    const nextZoom = Math.min(Math.max(cam.zoom + delta, 0.58), 1.85);
    const ratio = nextZoom / cam.zoom;
    cam.panX = cx - (cx - cam.panX) * ratio;
    cam.panY = cy - (cy - cam.panY) * ratio;
    cam.zoom = nextZoom;
    setZoomUi(Math.round(nextZoom * 100) / 100);
  };

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

      {/* Top Canvas Overlay Bar (prevents overlap between hint pill & controls) */}
      <div className="pointer-events-none absolute top-3 right-3 left-3 flex flex-wrap items-start justify-between gap-2">
        <div className="hidden rounded-lg border border-slate-700/70 bg-slate-900/80 px-3 py-1.5 text-[11px] text-slate-300 backdrop-blur-md xl:block">
          Klik bot: inspeksi • 2x klik ruangan: pindah • Drag & Scroll: kamera
        </div>

        {/* Room & Camera Controls */}
        <div className="pointer-events-auto ml-auto flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => onAllHands('war-room')}
            className="flex items-center gap-1.5 rounded-lg border border-violet-500/40 bg-slate-900/85 px-2.5 py-1.5 text-xs font-medium text-violet-200 backdrop-blur-md transition hover:bg-violet-500/20 cursor-pointer"
            title="Kumpulkan semua bot di War Room"
          >
            <Users className="h-3.5 w-3.5" />
            <span>War Room</span>
          </button>
          <button
            type="button"
            onClick={() => onAllHands('desks')}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700/80 bg-slate-900/85 px-2.5 py-1.5 text-xs font-medium text-slate-200 backdrop-blur-md transition hover:bg-slate-800 cursor-pointer"
            title="Kembalikan bot ke meja masing-masing"
          >
            <Compass className="h-3.5 w-3.5" />
            <span>Ke Meja</span>
          </button>
          <button
            type="button"
            onClick={() => onAllHands('coffee-lounge')}
            className="flex items-center gap-1.5 rounded-lg border border-orange-500/35 bg-slate-900/85 px-2.5 py-1.5 text-xs font-medium text-orange-200 backdrop-blur-md transition hover:bg-orange-500/20 cursor-pointer"
            title="Istirahat di Coffee Lounge"
          >
            <Coffee className="h-3.5 w-3.5" />
            <span>Lounge</span>
          </button>

          <div className="ml-1 flex items-center rounded-lg border border-slate-700/80 bg-slate-900/85 p-0.5 backdrop-blur-md">
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
              onClick={resetCamera}
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
