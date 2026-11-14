import { Agent, ZONES_META, ZoneId } from '../types';

export type LightingMode = 'studio' | 'midnight' | 'warm';

export interface FurnitureDrawable {
  gx: number;
  gy: number;
  draw: (ctx: CanvasRenderingContext2D, sx: number, sy: number, t: number) => void;
}

export const MAP_W = 20;
export const MAP_H = 14;
export const TILE_W = 58;
export const TILE_H = 29;

const HALF_W = TILE_W / 2;
const HALF_H = TILE_H / 2;
const WALL_H = 56;
const WALL_THICK = 0.24;

export function isoToScreen(gx: number, gy: number): { x: number; y: number } {
  return {
    x: (gx - gy) * HALF_W,
    y: (gx + gy) * HALF_H,
  };
}

export function screenToIso(sx: number, sy: number): { gx: number; gy: number } {
  const gx = (sx / HALF_W + sy / HALF_H) / 2;
  const gy = (sy / HALF_H - sx / HALF_W) / 2;
  return { gx, gy };
}

export function findZoneAt(gx: number, gy: number): ZoneId | null {
  for (const z of ZONES_META) {
    const { x, y, w, h } = z.bounds;
    if (gx >= x && gx < x + w && gy >= y && gy < y + h) {
      return z.id;
    }
  }
  return null;
}

// ============================================================================
// Deterministic Theme Palettes & Precomputed Visual Data (Zero frame allocs)
// ============================================================================

interface LightingPalette {
  bgCenter: string;
  bgMid: string;
  bgEdge: string;
  horizonGlow: string;
  starColor: string;
  slabTop: string;
  slabLeft: string;
  slabRight: string;
  slabTrim: string;
  hallwayBase: string;
  hallwayLine: string;
  wallLeft: string;
  wallRight: string;
  wallCap: string;
  wallBaseboard: string;
  wallRail: string;
  wallStroke: string;
  skyTop: string;
  skyBottom: string;
  skylineFar: string;
  skylineNear: string;
  windowShaft: string;
  windowFrame: string;
  lampTint: string;
  lampCore: string;
  particleColors: readonly [string, string, string];
  spotlightBoost: number;
}

const LIGHTING_PALETTES: Record<LightingMode, LightingPalette> = {
  studio: {
    bgCenter: '#132038',
    bgMid: '#0b1324',
    bgEdge: '#050811',
    horizonGlow: 'rgba(56, 189, 248, 0.08)',
    starColor: 'rgba(226, 232, 240, 0.72)',
    slabTop: '#192338',
    slabLeft: '#0f1729',
    slabRight: '#162033',
    slabTrim: 'rgba(148, 163, 184, 0.22)',
    hallwayBase: '#1d283f',
    hallwayLine: 'rgba(148, 163, 184, 0.08)',
    wallLeft: '#1b263b',
    wallRight: '#24324a',
    wallCap: '#334155',
    wallBaseboard: '#0f172a',
    wallRail: '#2e3e59',
    wallStroke: 'rgba(148, 163, 184, 0.22)',
    skyTop: '#071022',
    skyBottom: '#132744',
    skylineFar: '#0d1a30',
    skylineNear: '#091224',
    windowShaft: 'rgba(125, 211, 252, 0.075)',
    windowFrame: '#475569',
    lampTint: 'rgba(251, 191, 36, 0.16)',
    lampCore: '#fde68a',
    particleColors: ['#e2e8f0', '#bae6fd', '#cbd5e1'],
    spotlightBoost: 1,
  },
  midnight: {
    bgCenter: '#0d142c',
    bgMid: '#070b1a',
    bgEdge: '#02040a',
    horizonGlow: 'rgba(139, 92, 246, 0.12)',
    starColor: 'rgba(165, 243, 252, 0.85)',
    slabTop: '#101729',
    slabLeft: '#070b17',
    slabRight: '#0c1222',
    slabTrim: 'rgba(56, 189, 248, 0.28)',
    hallwayBase: '#131b30',
    hallwayLine: 'rgba(56, 189, 248, 0.09)',
    wallLeft: '#12192b',
    wallRight: '#182238',
    wallCap: '#273554',
    wallBaseboard: '#070b15',
    wallRail: '#1e2c49',
    wallStroke: 'rgba(56, 189, 248, 0.24)',
    skyTop: '#040714',
    skyBottom: '#111c3a',
    skylineFar: '#0a1228',
    skylineNear: '#060b1a',
    windowShaft: 'rgba(99, 102, 241, 0.10)',
    windowFrame: '#334155',
    lampTint: 'rgba(245, 158, 11, 0.18)',
    lampCore: '#fbbf24',
    particleColors: ['#67e8f9', '#c4b5fd', '#a5f3fc'],
    spotlightBoost: 1.35,
  },
  warm: {
    bgCenter: '#231a26',
    bgMid: '#15101a',
    bgEdge: '#09070c',
    horizonGlow: 'rgba(251, 146, 60, 0.11)',
    starColor: 'rgba(254, 240, 138, 0.65)',
    slabTop: '#211c27',
    slabLeft: '#130f18',
    slabRight: '#1c1722',
    slabTrim: 'rgba(251, 191, 36, 0.22)',
    hallwayBase: '#26202e',
    hallwayLine: 'rgba(253, 186, 116, 0.08)',
    wallLeft: '#241f2c',
    wallRight: '#2e2738',
    wallCap: '#453a4e',
    wallBaseboard: '#15111a',
    wallRail: '#3a3145',
    wallStroke: 'rgba(251, 191, 36, 0.20)',
    skyTop: '#161024',
    skyBottom: '#3b2434',
    skylineFar: '#211728',
    skylineNear: '#150e1c',
    windowShaft: 'rgba(251, 191, 36, 0.09)',
    windowFrame: '#574a5d',
    lampTint: 'rgba(251, 191, 36, 0.24)',
    lampCore: '#fef08a',
    particleColors: ['#fde68a', '#fed7aa', '#fef3c7'],
    spotlightBoost: 1.1,
  },
};

const BACKDROP_STARS = Array.from({ length: 44 }, (_, i) => {
  const s1 = Math.sin(i * 12.9898 + 4.14) * 43758.5453;
  const s2 = Math.sin(i * 78.233 + 1.73) * 43758.5453;
  const s3 = Math.sin(i * 39.425 + 9.21) * 43758.5453;
  return {
    nx: s1 - Math.floor(s1),
    ny: (s2 - Math.floor(s2)) * 0.72,
    r: 0.7 + (s3 - Math.floor(s3)) * 1.4,
    phase: i * 0.9,
    speed: 0.8 + (i % 5) * 0.35,
  };
});

interface SkylineBuilding {
  uFrac: number;
  wFrac: number;
  hFrac: number;
  layer: 0 | 1;
  beacon: boolean;
  windowTone: string;
}

const SKYLINE_BUILDINGS: readonly SkylineBuilding[] = [
  { uFrac: 0.02, wFrac: 0.11, hFrac: 0.54, layer: 0, beacon: false, windowTone: '#38bdf8' },
  { uFrac: 0.12, wFrac: 0.13, hFrac: 0.74, layer: 1, beacon: true, windowTone: '#fbbf24' },
  { uFrac: 0.24, wFrac: 0.09, hFrac: 0.45, layer: 0, beacon: false, windowTone: '#a78bfa' },
  { uFrac: 0.33, wFrac: 0.14, hFrac: 0.82, layer: 1, beacon: true, windowTone: '#38bdf8' },
  { uFrac: 0.46, wFrac: 0.11, hFrac: 0.60, layer: 0, beacon: false, windowTone: '#f472b6' },
  { uFrac: 0.56, wFrac: 0.13, hFrac: 0.68, layer: 1, beacon: false, windowTone: '#fde68a' },
  { uFrac: 0.68, wFrac: 0.10, hFrac: 0.86, layer: 1, beacon: true, windowTone: '#22d3ee' },
  { uFrac: 0.78, wFrac: 0.12, hFrac: 0.52, layer: 0, beacon: false, windowTone: '#fbbf24' },
  { uFrac: 0.89, wFrac: 0.10, hFrac: 0.64, layer: 1, beacon: false, windowTone: '#38bdf8' },
];

const AMBIENT_MOTES = Array.from({ length: 34 }, (_, i) => {
  const s1 = Math.sin(i * 19.31 + 2.7) * 19453.21;
  const s2 = Math.sin(i * 43.17 + 7.4) * 28311.67;
  const s3 = Math.sin(i * 11.83 + 5.1) * 15729.43;
  return {
    baseGx: 0.8 + (s1 - Math.floor(s1)) * (MAP_W - 1.6),
    baseGy: 0.8 + (s2 - Math.floor(s2)) * (MAP_H - 1.6),
    lift: 10 + (s3 - Math.floor(s3)) * 42,
    driftX: 0.12 + (i % 4) * 0.05,
    driftY: 0.08 + (i % 3) * 0.04,
    phase: i * 0.77,
    size: 1.0 + (i % 3) * 0.55,
    colorIdx: (i % 3) as 0 | 1 | 2,
  };
});

const BOOK_COLORS = [
  '#ef4444',
  '#38bdf8',
  '#f59e0b',
  '#10b981',
  '#a78bfa',
  '#f472b6',
  '#e2e8f0',
  '#fb923c',
  '#14b8a6',
];

const DATA_BUS_LINKS: ReadonlyArray<{
  zoneId: ZoneId;
  tx: number;
  ty: number;
  midX: number;
  midY: number;
  color: string;
}> = [
  { zoneId: 'command-desk', tx: 3.5, ty: 3.2, midX: 6.5, midY: 5.0, color: '#f59e0b' },
  { zoneId: 'research-library', tx: 10.0, ty: 3.2, midX: 10.0, midY: 5.0, color: '#06b6d4' },
  { zoneId: 'engineering-bay', tx: 16.0, ty: 3.6, midX: 13.5, midY: 5.4, color: '#10b981' },
  { zoneId: 'creative-studio', tx: 3.5, ty: 8.4, midX: 6.5, midY: 7.4, color: '#ec4899' },
  { zoneId: 'qa-bench', tx: 16.0, ty: 8.6, midX: 13.5, midY: 7.8, color: '#3b82f6' },
  { zoneId: 'coffee-lounge', tx: 10.0, ty: 11.2, midX: 10.0, midY: 9.2, color: '#f97316' },
];

// ============================================================================
// Low-Level Isometric Geometry & Gradient Helpers
// ============================================================================

function traceIsoQuad(
  ctx: CanvasRenderingContext2D,
  gx: number,
  gy: number,
  gw: number,
  gh: number
): void {
  const p0 = isoToScreen(gx, gy);
  const p1 = isoToScreen(gx + gw, gy);
  const p2 = isoToScreen(gx + gw, gy + gh);
  const p3 = isoToScreen(gx, gy + gh);
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.lineTo(p3.x, p3.y);
  ctx.closePath();
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
  rightColor: string,
  strokeColor?: string,
  baseZ = 0
): void {
  const p0 = isoToScreen(gx, gy);
  const p1 = isoToScreen(gx + gw, gy);
  const p2 = isoToScreen(gx + gw, gy + gh);
  const p3 = isoToScreen(gx, gy + gh);
  const topZ = baseZ + heightPx;

  // Top face
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y - topZ);
  ctx.lineTo(p1.x, p1.y - topZ);
  ctx.lineTo(p2.x, p2.y - topZ);
  ctx.lineTo(p3.x, p3.y - topZ);
  ctx.closePath();
  ctx.fillStyle = topColor;
  ctx.fill();
  if (strokeColor) {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  // Left-front face (p3 -> p2)
  ctx.beginPath();
  ctx.moveTo(p3.x, p3.y - topZ);
  ctx.lineTo(p2.x, p2.y - topZ);
  ctx.lineTo(p2.x, p2.y - baseZ);
  ctx.lineTo(p3.x, p3.y - baseZ);
  ctx.closePath();
  ctx.fillStyle = leftColor;
  ctx.fill();
  if (strokeColor) {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 0.7;
    ctx.stroke();
  }

  // Right-front face (p2 -> p1)
  ctx.beginPath();
  ctx.moveTo(p2.x, p2.y - topZ);
  ctx.lineTo(p1.x, p1.y - topZ);
  ctx.lineTo(p1.x, p1.y - baseZ);
  ctx.lineTo(p2.x, p2.y - baseZ);
  ctx.closePath();
  ctx.fillStyle = rightColor;
  ctx.fill();
  if (strokeColor) {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 0.7;
    ctx.stroke();
  }
}

function drawSoftFloorGlow(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  rx: number,
  ry: number,
  innerColor: string,
  outerColor = 'rgba(0,0,0,0)'
): void {
  ctx.save();
  ctx.translate(sx, sy);
  ctx.scale(1, ry / rx);
  const grad = ctx.createRadialGradient(0, 0, 1, 0, 0, rx);
  grad.addColorStop(0, innerColor);
  grad.addColorStop(1, outerColor);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function isZoneActive(agents: Agent[], zoneId: ZoneId): boolean {
  for (let i = 0; i < agents.length; i++) {
    const a = agents[i];
    if (
      a.currentZone === zoneId &&
      (a.status === 'working' ||
        a.status === 'thinking' ||
        a.status === 'talking' ||
        a.status === 'meeting')
    ) {
      return true;
    }
  }
  return false;
}

// ============================================================================
// 1. Studio Backdrop (Screen-Space before Camera Transform)
// ============================================================================

export function drawStudioBackdrop(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  lightingMode: LightingMode
): void {
  const pal = LIGHTING_PALETTES[lightingMode] ?? LIGHTING_PALETTES.studio;

  const bgGrad = ctx.createRadialGradient(
    w * 0.5,
    h * 0.44,
    24,
    w * 0.5,
    h * 0.5,
    Math.max(w, h) * 0.82
  );
  bgGrad.addColorStop(0, pal.bgCenter);
  bgGrad.addColorStop(0.55, pal.bgMid);
  bgGrad.addColorStop(1, pal.bgEdge);
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, w, h);

  // Subtle architectural horizon band glow
  const horizonGrad = ctx.createLinearGradient(0, h * 0.15, 0, h * 0.7);
  horizonGrad.addColorStop(0, 'rgba(0,0,0,0)');
  horizonGrad.addColorStop(0.5, pal.horizonGlow);
  horizonGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = horizonGrad;
  ctx.fillRect(0, 0, w, h);

  // Faint blueprint architectural grid in far outer backdrop
  ctx.save();
  ctx.strokeStyle =
    lightingMode === 'warm'
      ? 'rgba(251, 191, 36, 0.025)'
      : 'rgba(148, 163, 184, 0.03)';
  ctx.lineWidth = 1;
  const gridStep = 56;
  ctx.beginPath();
  for (let x = (w % gridStep) * 0.5; x < w; x += gridStep) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  for (let y = (h % gridStep) * 0.5; y < h; y += gridStep) {
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();

  // Distant atmospheric stars / skyline specks
  ctx.fillStyle = pal.starColor;
  for (let i = 0; i < BACKDROP_STARS.length; i++) {
    const st = BACKDROP_STARS[i];
    const twinkle = 0.2 + 0.55 * (0.5 + 0.5 * Math.sin(t * st.speed + st.phase));
    ctx.globalAlpha = twinkle;
    ctx.beginPath();
    ctx.arc(st.nx * w, st.ny * h, st.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Soft outer vignette
  const vig = ctx.createRadialGradient(
    w * 0.5,
    h * 0.5,
    Math.min(w, h) * 0.35,
    w * 0.5,
    h * 0.5,
    Math.max(w, h) * 0.78
  );
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(2, 6, 23, 0.52)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

// ============================================================================
// 2. Isometric Floor Slab, Material Zone Surfaces, AO, Buses & Spotlights
// ============================================================================

function drawZoneMaterialTexture(
  ctx: CanvasRenderingContext2D,
  zoneId: ZoneId,
  bx: number,
  by: number,
  bw: number,
  bh: number,
  floorTint: string,
  lightingMode: LightingMode
): void {
  ctx.save();
  traceIsoQuad(ctx, bx, by, bw, bh);
  ctx.clip();

  if (zoneId === 'coffee-lounge') {
    // Warm oak/walnut hardwood planks
    ctx.fillStyle = lightingMode === 'warm' ? '#2c1d16' : '#261a16';
    ctx.fill();
    const plankStep = 0.35;
    let idx = 0;
    for (let gy = by; gy < by + bh; gy += plankStep) {
      idx++;
      const a0 = isoToScreen(bx, gy);
      const a1 = isoToScreen(bx + bw, gy);
      const a2 = isoToScreen(bx + bw, Math.min(by + bh, gy + plankStep));
      const a3 = isoToScreen(bx, Math.min(by + bh, gy + plankStep));
      ctx.fillStyle =
        idx % 3 === 0
          ? 'rgba(180, 105, 52, 0.14)'
          : idx % 2 === 0
            ? 'rgba(120, 62, 28, 0.16)'
            : 'rgba(217, 138, 78, 0.08)';
      ctx.beginPath();
      ctx.moveTo(a0.x, a0.y);
      ctx.lineTo(a1.x, a1.y);
      ctx.lineTo(a2.x, a2.y);
      ctx.lineTo(a3.x, a3.y);
      ctx.closePath();
      ctx.fill();

      // Plank longitudinal seam
      ctx.strokeStyle = 'rgba(15, 8, 4, 0.42)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(a0.x, a0.y);
      ctx.lineTo(a1.x, a1.y);
      ctx.stroke();

      // Staggered plank butt joints
      const offset = (idx % 3) * 0.75 + 0.6;
      for (let gx = bx + offset; gx < bx + bw; gx += 1.9) {
        const j0 = isoToScreen(gx, gy);
        const j1 = isoToScreen(gx, gy + plankStep);
        ctx.beginPath();
        ctx.moveTo(j0.x, j0.y);
        ctx.lineTo(j1.x, j1.y);
        ctx.stroke();
      }
    }

    // Soft woven lounge rug under sofa/seating
    traceIsoQuad(ctx, bx + 0.35, by + 0.25, 2.3, 1.5);
    ctx.fillStyle = 'rgba(249, 115, 22, 0.12)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(251, 146, 60, 0.28)';
    ctx.lineWidth = 1;
    ctx.stroke();
  } else if (zoneId === 'engineering-bay' || zoneId === 'qa-bench') {
    // Dark matte raised server-tile grid
    ctx.fillStyle = lightingMode === 'midnight' ? '#0d1526' : '#121b2c';
    ctx.fill();

    // Subtle matte checker tiles
    for (let gx = bx; gx < bx + bw; gx++) {
      for (let gy = by; gy < by + bh; gy++) {
        if ((gx + gy) % 2 === 0) {
          traceIsoQuad(ctx, gx, gy, 1, 1);
          ctx.fillStyle = 'rgba(30, 41, 59, 0.42)';
          ctx.fill();
        }
      }
    }

    // Crisp raised-floor panel seams + corner grommets
    ctx.strokeStyle =
      zoneId === 'engineering-bay'
        ? 'rgba(16, 185, 129, 0.14)'
        : 'rgba(59, 130, 246, 0.14)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let gx = bx; gx <= bx + bw; gx += 1) {
      const p0 = isoToScreen(gx, by);
      const p1 = isoToScreen(gx, by + bh);
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
    }
    for (let gy = by; gy <= by + bh; gy += 1) {
      const p0 = isoToScreen(bx, gy);
      const p1 = isoToScreen(bx + bw, gy);
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
    }
    ctx.stroke();

    // Corner fastener micro-dots at grid intersections
    ctx.fillStyle = 'rgba(148, 163, 184, 0.25)';
    for (let gx = bx + 1; gx < bx + bw; gx++) {
      for (let gy = by + 1; gy < by + bh; gy++) {
        const pt = isoToScreen(gx, gy);
        ctx.fillRect(pt.x - 1, pt.y - 0.5, 2, 1);
      }
    }
  } else if (zoneId === 'command-desk' || zoneId === 'research-library') {
    // Warm acoustic carpet texture with bordered inlay
    ctx.fillStyle =
      zoneId === 'command-desk'
        ? lightingMode === 'warm'
          ? '#221e2d'
          : '#192235'
        : lightingMode === 'warm'
          ? '#1e212e'
          : '#162235';
    ctx.fill();

    // Fine acoustic weave stripes
    ctx.strokeStyle =
      zoneId === 'command-desk'
        ? 'rgba(245, 158, 11, 0.065)'
        : 'rgba(6, 182, 212, 0.065)';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    for (let gx = bx + 0.25; gx < bx + bw; gx += 0.25) {
      const p0 = isoToScreen(gx, by);
      const p1 = isoToScreen(gx, by + bh);
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
    }
    ctx.stroke();

    // Inner acoustic carpet border inlay
    traceIsoQuad(ctx, bx + 0.35, by + 0.35, bw - 0.7, bh - 0.7);
    ctx.fillStyle = floorTint;
    ctx.fill();
    ctx.strokeStyle =
      zoneId === 'command-desk'
        ? 'rgba(245, 158, 11, 0.22)'
        : 'rgba(6, 182, 212, 0.22)';
    ctx.lineWidth = 1;
    ctx.stroke();
  } else {
    // Studio slate (war-room & creative-studio)
    ctx.fillStyle = zoneId === 'war-room' ? '#191b30' : '#1b1a2d';
    ctx.fill();

    // Honed large-format slate slabs (2x2 or 1x1)
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.09)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let gx = bx; gx <= bx + bw; gx += 1.5) {
      const p0 = isoToScreen(gx, by);
      const p1 = isoToScreen(gx, by + bh);
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
    }
    for (let gy = by; gy <= by + bh; gy += 1.5) {
      const p0 = isoToScreen(bx, gy);
      const p1 = isoToScreen(bx + bw, gy);
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
    }
    ctx.stroke();

    if (zoneId === 'war-room') {
      // Tactical concentric ring inlay around War Room center
      const center = isoToScreen(9.85, 7.0);
      ctx.save();
      ctx.translate(center.x, center.y);
      ctx.scale(1, 0.5);
      ctx.strokeStyle = 'rgba(139, 92, 246, 0.26)';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(0, 0, 74, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(167, 139, 250, 0.16)';
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.arc(0, 0, 56, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else {
      // Creative studio splatter-safe vinyl mat under easel/tablet
      traceIsoQuad(ctx, bx + 0.5, by + 0.4, bw - 1.1, bh - 1.3);
      ctx.fillStyle = floorTint;
      ctx.fill();
    }
  }

  ctx.restore();
}

export function drawIsometricFloorAndZones(
  ctx: CanvasRenderingContext2D,
  t: number,
  agents: Agent[],
  hoveredZone: ZoneId | null,
  lightingMode: LightingMode
): void {
  const pal = LIGHTING_PALETTES[lightingMode] ?? LIGHTING_PALETTES.studio;

  const p0 = isoToScreen(0, 0);
  const p1 = isoToScreen(MAP_W, 0);
  const p2 = isoToScreen(MAP_W, MAP_H);
  const p3 = isoToScreen(0, MAP_H);

  // 1. Soft architectural drop shadow beneath entire floating diorama slab
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y + 20);
  ctx.lineTo(p1.x + 12, p1.y + 22);
  ctx.lineTo(p2.x, p2.y + 30);
  ctx.lineTo(p3.x - 12, p3.y + 22);
  ctx.closePath();
  ctx.fillStyle = 'rgba(2, 4, 12, 0.65)';
  ctx.fill();
  ctx.restore();

  // 2. 3D Floor Slab Platform with Extruded Thickness & Bevel Trim
  const slabH = 14;
  drawIsoBox(
    ctx,
    0,
    0,
    MAP_W,
    MAP_H,
    slabH,
    pal.slabTop,
    pal.slabLeft,
    pal.slabRight,
    undefined,
    -slabH
  );

  // Slab rim edge bevel highlight
  ctx.beginPath();
  ctx.moveTo(p3.x, p3.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.strokeStyle = pal.slabTrim;
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // Subtle metallic floor plate strip along slab front edge
  ctx.beginPath();
  ctx.moveTo(p3.x, p3.y + 5);
  ctx.lineTo(p2.x, p2.y + 5);
  ctx.lineTo(p1.x, p1.y + 5);
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.14)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // 3. Base Hallway Grid (single batched stroke for 60fps performance)
  traceIsoQuad(ctx, 0, 0, MAP_W, MAP_H);
  ctx.fillStyle = pal.hallwayBase;
  ctx.fill();

  ctx.strokeStyle = pal.hallwayLine;
  ctx.lineWidth = 0.9;
  ctx.beginPath();
  for (let gx = 0; gx <= MAP_W; gx++) {
    const a = isoToScreen(gx, 0);
    const b = isoToScreen(gx, MAP_H);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  for (let gy = 0; gy <= MAP_H; gy++) {
    const a = isoToScreen(0, gy);
    const b = isoToScreen(MAP_W, gy);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();

  // Subtle hallway walkway runner accent lines along x=6.5 and x=13.5
  ctx.save();
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.13)';
  ctx.lineWidth = 1.2;
  ctx.setLineDash([6, 8]);
  for (const cx of [6.5, 13.5]) {
    const c0 = isoToScreen(cx, 0.8);
    const c1 = isoToScreen(cx, MAP_H - 0.8);
    ctx.beginPath();
    ctx.moveTo(c0.x, c0.y);
    ctx.lineTo(c1.x, c1.y);
    ctx.stroke();
  }
  ctx.restore();

  // 4. Distinct Material Floor Textures per Canonical Zone
  for (const zone of ZONES_META) {
    const { x, y, w, h } = zone.bounds;
    drawZoneMaterialTexture(ctx, zone.id, x, y, w, h, zone.floorTint, lightingMode);
  }

  // 5. Subtle Floor Ambient Occlusion along Back Walls (x=0 and y=0)
  // Right-back wall AO (y=0..0.9)
  const aoRight0 = isoToScreen(0, 0);
  const aoRight1 = isoToScreen(0, 1.0);
  const aoGradRight = ctx.createLinearGradient(aoRight0.x, aoRight0.y, aoRight1.x, aoRight1.y);
  aoGradRight.addColorStop(0, 'rgba(2, 6, 23, 0.55)');
  aoGradRight.addColorStop(1, 'rgba(2, 6, 23, 0)');
  traceIsoQuad(ctx, 0, 0, MAP_W, 1.0);
  ctx.fillStyle = aoGradRight;
  ctx.fill();

  // Left-back wall AO (x=0..1.0)
  const aoLeft0 = isoToScreen(0, 0);
  const aoLeft1 = isoToScreen(1.0, 0);
  const aoGradLeft = ctx.createLinearGradient(aoLeft0.x, aoLeft0.y, aoLeft1.x, aoLeft1.y);
  aoGradLeft.addColorStop(0, 'rgba(2, 6, 23, 0.58)');
  aoGradLeft.addColorStop(1, 'rgba(2, 6, 23, 0)');
  traceIsoQuad(ctx, 0, 0, 1.0, MAP_H);
  ctx.fillStyle = aoGradLeft;
  ctx.fill();

  // 6. Diagonal Moonlight / Window Floor Light Shafts
  ctx.save();
  for (const [wx0, wx1] of [
    [1.4, 4.3],
    [14.3, 18.4],
  ]) {
    const f0 = isoToScreen(wx0, 0.05);
    const f1 = isoToScreen(wx1, 0.05);
    const f2 = isoToScreen(wx1 + 0.5, 2.35);
    const f3 = isoToScreen(wx0 + 0.5, 2.35);
    const shaftGrad = ctx.createLinearGradient(f0.x, f0.y, f3.x, f3.y);
    shaftGrad.addColorStop(0, pal.windowShaft);
    shaftGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = shaftGrad;
    ctx.beginPath();
    ctx.moveTo(f0.x, f0.y);
    ctx.lineTo(f1.x, f1.y);
    ctx.lineTo(f2.x, f2.y);
    ctx.lineTo(f3.x, f3.y);
    ctx.closePath();
    ctx.fill();
  }
  for (const [wy0, wy1] of [
    [1.5, 4.3],
    [11.0, 13.0],
  ]) {
    const f0 = isoToScreen(0.05, wy0);
    const f1 = isoToScreen(0.05, wy1);
    const f2 = isoToScreen(2.2, wy1 + 0.45);
    const f3 = isoToScreen(2.2, wy0 + 0.45);
    const shaftGrad = ctx.createLinearGradient(f0.x, f0.y, f3.x, f3.y);
    shaftGrad.addColorStop(0, pal.windowShaft);
    shaftGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = shaftGrad;
    ctx.beginPath();
    ctx.moveTo(f0.x, f0.y);
    ctx.lineTo(f1.x, f1.y);
    ctx.lineTo(f2.x, f2.y);
    ctx.lineTo(f3.x, f3.y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  // 7. Animated Glowing Data Bus Conduits from War Room (10,7) to Zones
  const hubPt = isoToScreen(10, 7);
  const warRoomActive = isZoneActive(agents, 'war-room');

  for (let i = 0; i < DATA_BUS_LINKS.length; i++) {
    const link = DATA_BUS_LINKS[i];
    const active = isZoneActive(agents, link.zoneId) || warRoomActive;
    const midPt = isoToScreen(link.midX, link.midY);
    const endPt = isoToScreen(link.tx, link.ty);

    // Dark floor conduit groove
    ctx.save();
    ctx.strokeStyle = 'rgba(2, 6, 23, 0.6)';
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.moveTo(hubPt.x, hubPt.y);
    ctx.lineTo(midPt.x, midPt.y);
    ctx.lineTo(endPt.x, endPt.y);
    ctx.stroke();

    // Base trace
    ctx.strokeStyle = active ? `${link.color}66` : `${link.color}29`;
    ctx.lineWidth = active ? 1.6 : 1.1;
    ctx.setLineDash([5, 6]);
    ctx.lineDashOffset = -t * (active ? 28 : 10);
    ctx.beginPath();
    ctx.moveTo(hubPt.x, hubPt.y);
    ctx.lineTo(midPt.x, midPt.y);
    ctx.lineTo(endPt.x, endPt.y);
    ctx.stroke();
    ctx.setLineDash([]);

    // Traveling glowing signal pulse when zone or war-room is active
    if (active) {
      const prog = (t * 0.68 + i * 0.17) % 1;
      let px: number;
      let py: number;
      if (prog < 0.45) {
        const u = prog / 0.45;
        px = hubPt.x + (midPt.x - hubPt.x) * u;
        py = hubPt.y + (midPt.y - hubPt.y) * u;
      } else {
        const u = (prog - 0.45) / 0.55;
        px = midPt.x + (endPt.x - midPt.x) * u;
        py = midPt.y + (endPt.y - midPt.y) * u;
      }

      drawSoftFloorGlow(ctx, px, py, 14, 7, `${link.color}66`);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(px, py, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // 8. Soft Volumetric Floor Spotlights over Active Zones + Crisp Zone Borders & Labels
  for (const zone of ZONES_META) {
    const { x, y, w, h } = zone.bounds;
    const active = isZoneActive(agents, zone.id);
    const hovered = hoveredZone === zone.id;

    if (active || hovered) {
      const center = isoToScreen(x + w * 0.5, y + h * 0.5);
      const pulse = active ? 0.88 + 0.12 * Math.sin(t * 2.8 + x) : 0.9;
      const rx = w * 22;
      const ry = h * 15;
      const alphaHex = active
        ? Math.round(Math.min(0.32, 0.16 * pal.spotlightBoost * pulse) * 255)
            .toString(16)
            .padStart(2, '0')
        : '24';
      drawSoftFloorGlow(ctx, center.x, center.y, rx, ry, `${zone.accent}${alphaHex}`);
    }

    // Zone perimeter outline
    traceIsoQuad(ctx, x, y, w, h);
    ctx.strokeStyle = hovered
      ? '#f8fafc'
      : active
        ? `${zone.accent}aa`
        : `${zone.accent}55`;
    ctx.lineWidth = hovered ? 2.1 : active ? 1.6 : 1.15;
    ctx.stroke();

    // Subtle crisp corner tick accents on outer tile corners
    if (hovered || active) {
      const c0 = isoToScreen(x, y);
      const c2 = isoToScreen(x + w, y + h);
      ctx.fillStyle = hovered ? '#f8fafc' : zone.accent;
      ctx.fillRect(c0.x - 1.5, c0.y - 1.5, 3, 3);
      ctx.fillRect(c2.x - 1.5, c2.y - 1.5, 3, 3);
    }

    // Zone Label Pill at front-bottom edge so desks never cover it
    const labelPos = isoToScreen(x + 0.25, y + h - 0.24);
    const labelText = `${zone.shortLabel} · ${zone.label.toUpperCase()}`;
    ctx.save();
    ctx.font = '700 8.5px "JetBrains Mono", monospace';
    const textW = ctx.measureText(labelText).width;
    const pillX = labelPos.x + 2;
    const pillY = labelPos.y - 9;
    ctx.fillStyle = hovered ? 'rgba(15, 23, 42, 0.94)' : 'rgba(7, 11, 22, 0.78)';
    ctx.beginPath();
    ctx.roundRect(pillX, pillY, textW + 14, 14, 4);
    ctx.fill();
    ctx.strokeStyle = hovered ? '#f8fafc' : `${zone.accent}55`;
    ctx.lineWidth = 0.8;
    ctx.stroke();

    ctx.fillStyle = hovered ? '#ffffff' : zone.accent;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(labelText, pillX + 7, pillY + 7.5);
    ctx.restore();
  }
}

// ============================================================================
// 3. Architectural Isometric Walls, Panoramic Windows, Clock, Kanban & Art
// ============================================================================

function drawPanoramicWindow(
  ctx: CanvasRenderingContext2D,
  axis: 'right' | 'left',
  startCoord: number,
  endCoord: number,
  t: number,
  pal: LightingPalette,
  lightingMode: LightingMode
): void {
  const b0 = axis === 'right' ? isoToScreen(startCoord, 0) : isoToScreen(0, startCoord);
  const b1 = axis === 'right' ? isoToScreen(endCoord, 0) : isoToScreen(0, endCoord);
  const zLow = 13;
  const zHigh = 45;

  // Outer recessed dark window casing
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(b0.x, b0.y - zHigh);
  ctx.lineTo(b1.x, b1.y - zHigh);
  ctx.lineTo(b1.x, b1.y - zLow);
  ctx.lineTo(b0.x, b0.y - zLow);
  ctx.closePath();
  ctx.fillStyle = '#09111f';
  ctx.fill();
  ctx.strokeStyle = pal.windowFrame;
  ctx.lineWidth = 1.6;
  ctx.stroke();

  // Clip interior night sky & skyline
  ctx.clip();

  const minY = Math.min(b0.y, b1.y) - zHigh;
  const maxY = Math.max(b0.y, b1.y) - zLow;
  const skyGrad = ctx.createLinearGradient(b0.x, minY, b0.x, maxY);
  skyGrad.addColorStop(0, pal.skyTop);
  skyGrad.addColorStop(1, pal.skyBottom);
  ctx.fillStyle = skyGrad;
  ctx.fillRect(
    Math.min(b0.x, b1.x) - 2,
    minY - 2,
    Math.abs(b1.x - b0.x) + 4,
    maxY - minY + 4
  );

  // Subtle city horizon haze + skyline silhouettes along wall slope
  const dx = b1.x - b0.x;
  const dy = b1.y - b0.y;
  const spanH = zHigh - zLow;

  for (let layer = 0; layer <= 1; layer++) {
    for (let bi = 0; bi < SKYLINE_BUILDINGS.length; bi++) {
      const bld = SKYLINE_BUILDINGS[bi];
      if (bld.layer !== layer) continue;

      const u0 = bld.uFrac;
      const u1 = bld.uFrac + bld.wFrac;
      const bh = spanH * bld.hFrac * (layer === 0 ? 0.72 : 0.85);
      const bx0 = b0.x + dx * u0;
      const by0 = b0.y + dy * u0 - zLow;
      const bx1 = b0.x + dx * u1;
      const by1 = b0.y + dy * u1 - zLow;

      ctx.fillStyle = layer === 0 ? pal.skylineFar : pal.skylineNear;
      ctx.beginPath();
      ctx.moveTo(bx0, by0 - bh);
      ctx.lineTo(bx1, by1 - bh);
      ctx.lineTo(bx1, by1 + 4);
      ctx.lineTo(bx0, by0 + 4);
      ctx.closePath();
      ctx.fill();

      // Tiny lit skyscraper window bokeh dots
      if (layer === 1) {
        const winAlpha = lightingMode === 'midnight' ? 0.82 : 0.62;
        ctx.fillStyle = bld.windowTone;
        for (let r = 0; r < 3; r++) {
          const fracY = 0.25 + r * 0.22;
          const wx = bx0 + (bx1 - bx0) * (0.35 + ((bi + r) % 2) * 0.3);
          const wy = by0 + (by1 - by0) * 0.5 - bh * fracY;
          const twinkle =
            (bi + r) % 3 === 0 ? 0.35 + 0.65 * Math.sin(t * 1.4 + bi + r) : 1;
          ctx.globalAlpha = Math.max(0.15, winAlpha * twinkle);
          ctx.fillRect(wx - 1, wy - 1, 2, 1.5);
        }
        ctx.globalAlpha = 1;
      }

      // Blinking aircraft warning beacons on tallest towers
      if (bld.beacon) {
        const blink = Math.sin(t * 2.6 + bi * 1.9) > 0.35;
        if (blink) {
          const tx = (bx0 + bx1) * 0.5;
          const ty = (by0 + by1) * 0.5 - bh - 2;
          ctx.fillStyle = '#fb7185';
          ctx.beginPath();
          ctx.arc(tx, ty, 1.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  // Diagonal specular glass sheen
  ctx.fillStyle = 'rgba(226, 232, 240, 0.05)';
  ctx.beginPath();
  ctx.moveTo(b0.x + dx * 0.14, b0.y + dy * 0.14 - zHigh);
  ctx.lineTo(b0.x + dx * 0.30, b0.y + dy * 0.30 - zHigh);
  ctx.lineTo(b0.x + dx * 0.12, b0.y + dy * 0.12 - zLow);
  ctx.lineTo(b0.x + dx * 0.02, b0.y + dy * 0.02 - zLow);
  ctx.closePath();
  ctx.fill();

  // Vertical mullions (dividing panorama into sleek architectural panes)
  ctx.strokeStyle = 'rgba(71, 85, 105, 0.72)';
  ctx.lineWidth = 1.2;
  for (const frac of [0.33, 0.67]) {
    const mx = b0.x + dx * frac;
    const my = b0.y + dy * frac;
    ctx.beginPath();
    ctx.moveTo(mx, my - zHigh);
    ctx.lineTo(mx, my - zLow);
    ctx.stroke();
  }
  ctx.restore();

  // Bright lower window sill ledge
  ctx.beginPath();
  ctx.moveTo(b0.x, b0.y - zLow);
  ctx.lineTo(b1.x, b1.y - zLow);
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawWallStudioClock(
  ctx: CanvasRenderingContext2D,
  gx: number
): void {
  const anchor = isoToScreen(gx, 0);
  const now = new Date();
  const secs = now.getSeconds() + now.getMilliseconds() / 1000;
  const mins = now.getMinutes() + secs / 60;
  const hrs = (now.getHours() % 12) + mins / 60;

  ctx.save();
  ctx.translate(anchor.x, anchor.y - 35);
  // Skew onto right-back wall plane (dy/dx = +0.5)
  ctx.transform(1, 0.5, 0, 1, 0, 0);

  // Brushed gunmetal housing
  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.arc(0, 0, 10.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // Dial tick marks
  ctx.strokeStyle = 'rgba(226, 232, 240, 0.45)';
  ctx.lineWidth = 0.8;
  for (let i = 0; i < 4; i++) {
    const ang = (i * Math.PI) / 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(ang) * 7, Math.sin(ang) * 7);
    ctx.lineTo(Math.cos(ang) * 9, Math.sin(ang) * 9);
    ctx.stroke();
  }

  // Hour hand
  const hrAng = (hrs / 12) * Math.PI * 2 - Math.PI / 2;
  ctx.strokeStyle = '#f8fafc';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(Math.cos(hrAng) * 5, Math.sin(hrAng) * 5);
  ctx.stroke();

  // Minute hand
  const minAng = (mins / 60) * Math.PI * 2 - Math.PI / 2;
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(Math.cos(minAng) * 7.5, Math.sin(minAng) * 7.5);
  ctx.stroke();

  // Second hand
  const secAng = (secs / 60) * Math.PI * 2 - Math.PI / 2;
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(Math.cos(secAng) * 8.2, Math.sin(secAng) * 8.2);
  ctx.stroke();

  // Digital HH:MM LED ticker plaque right beneath analog dial
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const colon = Math.floor(secs) % 2 === 0 ? ':' : ' ';
  ctx.fillStyle = '#020617';
  ctx.beginPath();
  ctx.roundRect(-12, 12.5, 24, 9, 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
  ctx.lineWidth = 0.7;
  ctx.stroke();
  ctx.fillStyle = '#38bdf8';
  ctx.font = '700 6px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${hh}${colon}${mm}`, 0, 17);

  ctx.restore();
}

function drawWallKanbanBoard(
  ctx: CanvasRenderingContext2D,
  gx: number,
  t: number,
  agents: Agent[]
): void {
  const anchor = isoToScreen(gx, 0);
  const workingCount = agents.filter(
    (a) => a.status === 'working' || a.status === 'thinking'
  ).length;

  ctx.save();
  ctx.translate(anchor.x, anchor.y - 43);
  ctx.transform(1, 0.5, 0, 1, 0, 0);

  // Dark glass Kanban board frame
  ctx.fillStyle = '#0b1220';
  ctx.beginPath();
  ctx.roundRect(0, 0, 62, 29, 2.5);
  ctx.fill();
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Header bar
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(1.5, 1.5, 59, 5);
  ctx.fillStyle = '#a78bfa';
  ctx.fillRect(3.5, 3, 14, 1.8);

  // 3 Kanban column headers & cards
  const colColors = ['#64748b', '#f59e0b', '#10b981'];
  for (let c = 0; c < 3; c++) {
    const cx = 3 + c * 19.5;
    ctx.fillStyle = 'rgba(30, 41, 59, 0.65)';
    ctx.fillRect(cx, 8, 17, 18.5);
    ctx.fillStyle = colColors[c];
    ctx.fillRect(cx + 1.5, 9, 14, 1.6);

    const cardCount = c === 1 ? Math.min(3, Math.max(2, workingCount + 1)) : 2;
    for (let r = 0; r < cardCount; r++) {
      const cy = 12.2 + r * 4.6;
      const activePulse =
        c === 1 && workingCount > 0
          ? 0.65 + 0.35 * Math.sin(t * 4 + r)
          : 0.78;
      ctx.globalAlpha = activePulse;
      ctx.fillStyle = c === 0 ? '#38bdf8' : c === 1 ? '#fbbf24' : '#34d399';
      ctx.fillRect(cx + 1.8, cy, 13.4, 3.2);
    }
    ctx.globalAlpha = 1;
  }

  // Animated progress dot sliding across header
  const scanX = 24 + ((t * 14) % 34);
  ctx.fillStyle = '#38bdf8';
  ctx.fillRect(scanX, 3, 4, 1.8);

  ctx.restore();
}

function drawWallBlueprintArt(
  ctx: CanvasRenderingContext2D,
  gx: number,
  t: number
): void {
  const anchor = isoToScreen(gx, 0);

  ctx.save();
  ctx.translate(anchor.x, anchor.y - 42);
  ctx.transform(1, 0.5, 0, 1, 0, 0);

  // Framed architectural blueprint
  ctx.fillStyle = '#0a192f';
  ctx.fillRect(0, 0, 40, 26);
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 1.2;
  ctx.strokeRect(0, 0, 40, 26);

  // Inner blueprint grid
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.22)';
  ctx.lineWidth = 0.5;
  for (let x = 5; x < 40; x += 5) {
    ctx.beginPath();
    ctx.moveTo(x, 2);
    ctx.lineTo(x, 24);
    ctx.stroke();
  }
  for (let y = 5; y < 26; y += 5) {
    ctx.beginPath();
    ctx.moveTo(2, y);
    ctx.lineTo(38, y);
    ctx.stroke();
  }

  // Floorplan / core schematic lines
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 0.9;
  ctx.strokeRect(5, 5, 11, 7);
  ctx.strokeRect(18, 5, 17, 7);
  ctx.strokeRect(5, 14, 14, 7);
  ctx.strokeRect(21, 14, 14, 7);

  // Pulsing focal node
  ctx.fillStyle = `rgba(245, 158, 11, ${0.55 + 0.4 * Math.sin(t * 2.5)})`;
  ctx.beginPath();
  ctx.arc(20, 13, 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawAcousticPanels(
  ctx: CanvasRenderingContext2D,
  gyStart: number,
  gyEnd: number,
  lightingMode: LightingMode
): void {
  const p0 = isoToScreen(0, gyStart);
  const p1 = isoToScreen(0, gyEnd);

  // Backing felt mount + warm/magenta studio trim
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y - 45);
  ctx.lineTo(p1.x, p1.y - 45);
  ctx.lineTo(p1.x, p1.y - 10);
  ctx.lineTo(p0.x, p0.y - 10);
  ctx.closePath();
  ctx.fillStyle = '#0f172a';
  ctx.fill();
  ctx.strokeStyle =
    lightingMode === 'warm'
      ? 'rgba(251, 191, 36, 0.35)'
      : 'rgba(236, 72, 153, 0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Vertical acoustic walnut slats
  const slatCount = 12;
  for (let i = 1; i < slatCount; i++) {
    const frac = i / slatCount;
    const sx = p0.x + (p1.x - p0.x) * frac;
    const sy = p0.y + (p1.y - p0.y) * frac;
    ctx.strokeStyle = i % 2 === 0 ? '#78350f' : '#92400e';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(sx, sy - 43);
    ctx.lineTo(sx, sy - 12);
    ctx.stroke();
  }

  // Top cove LED strip
  ctx.strokeStyle =
    lightingMode === 'warm'
      ? 'rgba(251, 191, 36, 0.65)'
      : 'rgba(236, 72, 153, 0.65)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y - 46);
  ctx.lineTo(p1.x, p1.y - 46);
  ctx.stroke();
  ctx.restore();
}

export function drawOfficeWallsAndWindows(
  ctx: CanvasRenderingContext2D,
  t: number,
  agents: Agent[],
  lightingMode: LightingMode
): void {
  const pal = LIGHTING_PALETTES[lightingMode] ?? LIGHTING_PALETTES.studio;

  const topIn = isoToScreen(0, 0);
  const topOut = isoToScreen(-WALL_THICK, -WALL_THICK);
  const rightIn = isoToScreen(MAP_W, 0);
  const rightOut = isoToScreen(MAP_W, -WALL_THICK);
  const leftIn = isoToScreen(0, MAP_H);
  const leftOut = isoToScreen(-WALL_THICK, MAP_H);

  // 1. Left-back wall outer end-cap + main inner face (x=0, y=0..MAP_H)
  ctx.beginPath();
  ctx.moveTo(leftOut.x, leftOut.y - WALL_H);
  ctx.lineTo(leftIn.x, leftIn.y - WALL_H);
  ctx.lineTo(leftIn.x, leftIn.y);
  ctx.lineTo(leftOut.x, leftOut.y);
  ctx.closePath();
  ctx.fillStyle = pal.slabLeft;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(topIn.x, topIn.y - WALL_H);
  ctx.lineTo(leftIn.x, leftIn.y - WALL_H);
  ctx.lineTo(leftIn.x, leftIn.y);
  ctx.lineTo(topIn.x, topIn.y);
  ctx.closePath();
  ctx.fillStyle = pal.wallLeft;
  ctx.fill();
  ctx.strokeStyle = pal.wallStroke;
  ctx.lineWidth = 1;
  ctx.stroke();

  // 2. Right-back wall outer end-cap + main inner face (y=0, x=0..MAP_W)
  ctx.beginPath();
  ctx.moveTo(rightIn.x, rightIn.y - WALL_H);
  ctx.lineTo(rightOut.x, rightOut.y - WALL_H);
  ctx.lineTo(rightOut.x, rightOut.y);
  ctx.lineTo(rightIn.x, rightIn.y);
  ctx.closePath();
  ctx.fillStyle = pal.slabRight;
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(topIn.x, topIn.y - WALL_H);
  ctx.lineTo(rightIn.x, rightIn.y - WALL_H);
  ctx.lineTo(rightIn.x, rightIn.y);
  ctx.lineTo(topIn.x, topIn.y);
  ctx.closePath();
  ctx.fillStyle = pal.wallRight;
  ctx.fill();
  ctx.strokeStyle = pal.wallStroke;
  ctx.lineWidth = 1;
  ctx.stroke();

  // 3. Architectural 3D Wall Coping Cap (L-shaped top rim)
  ctx.fillStyle = pal.wallCap;
  ctx.beginPath();
  ctx.moveTo(topOut.x, topOut.y - WALL_H);
  ctx.lineTo(rightOut.x, rightOut.y - WALL_H);
  ctx.lineTo(rightIn.x, rightIn.y - WALL_H);
  ctx.lineTo(topIn.x, topIn.y - WALL_H);
  ctx.lineTo(leftIn.x, leftIn.y - WALL_H);
  ctx.lineTo(leftOut.x, leftOut.y - WALL_H);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = pal.wallStroke;
  ctx.lineWidth = 0.9;
  ctx.stroke();

  // 4. Baseboards & Dado Rail Trim along both walls
  for (const [a, b] of [
    [topIn, leftIn],
    [topIn, rightIn],
  ]) {
    // Baseboard
    ctx.beginPath();
    ctx.moveTo(a.x, a.y - 5);
    ctx.lineTo(b.x, b.y - 5);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(a.x, a.y);
    ctx.closePath();
    ctx.fillStyle = pal.wallBaseboard;
    ctx.fill();

    // Dado rail line
    ctx.beginPath();
    ctx.moveTo(a.x, a.y - 12);
    ctx.lineTo(b.x, b.y - 12);
    ctx.strokeStyle = pal.wallRail;
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }

  // Corner architectural pillar seam with subtle LED vertical accent
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(topIn.x, topIn.y - WALL_H + 4);
  ctx.lineTo(topIn.x, topIn.y - 6);
  ctx.stroke();

  // 5. Recessed Panoramic Night Windows
  drawPanoramicWindow(ctx, 'right', 1.4, 4.3, t, pal, lightingMode);
  drawPanoramicWindow(ctx, 'right', 14.3, 18.4, t, pal, lightingMode);
  drawPanoramicWindow(ctx, 'left', 1.5, 4.3, t, pal, lightingMode);
  drawPanoramicWindow(ctx, 'left', 11.0, 13.0, t, pal, lightingMode);

  // 6. Acoustic Wood-Slat Panels beside Creative Studio (y = 6.7 .. 10.3)
  drawAcousticPanels(ctx, 6.7, 10.3, lightingMode);

  // 7. Blueprint Wall Art, Animated Kanban Board & Live Studio Clock
  drawWallBlueprintArt(ctx, 4.75, t);
  drawWallKanbanBoard(ctx, 7.35, t, agents);
  drawWallStudioClock(ctx, 10.65);

  // Secondary blueprint schematic between War/Research and Engineering
  drawWallBlueprintArt(ctx, 11.95, t + 1.4);

  // 8. Architectural Wall Sconce Lights (cast subtle mode-aware glow)
  for (const [sxCoord, axis] of [
    [6.72, 'right'] as const,
    [13.8, 'right'] as const,
    [5.5, 'left'] as const,
  ]) {
    const sp = axis === 'right' ? isoToScreen(sxCoord, 0) : isoToScreen(0, sxCoord);
    drawSoftFloorGlow(ctx, sp.x, sp.y - 24, 18, 22, pal.lampTint);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(sp.x - 2, sp.y - 36, 4, 5);
    ctx.fillStyle = pal.lampCore;
    ctx.fillRect(sp.x - 1.5, sp.y - 31.5, 3, 1.5);
  }
}

// ============================================================================
// 4. Detailed Multi-Part Furniture Props across All 7 Zones
// ============================================================================

function drawExecutiveChair(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  accent: string
): void {
  // Floor contact shadow
  ctx.fillStyle = 'rgba(2, 6, 23, 0.45)';
  ctx.beginPath();
  ctx.ellipse(sx, sy + 1, 9, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // 5-star caster base
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(sx - 6, sy + 1);
  ctx.lineTo(sx + 6, sy + 1);
  ctx.moveTo(sx - 3, sy - 2);
  ctx.lineTo(sx + 3, sy + 3);
  ctx.stroke();

  // Pneumatic stem
  ctx.fillStyle = '#334155';
  ctx.fillRect(sx - 1.5, sy - 7, 3, 7);

  // Contoured seat cushion
  ctx.fillStyle = '#1e293b';
  ctx.beginPath();
  ctx.ellipse(sx, sy - 8, 7.5, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 0.8;
  ctx.stroke();

  // Mesh backrest + headrest + armrests
  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.roundRect(sx - 6, sy - 21, 12, 13, 3);
  ctx.fill();
  ctx.strokeStyle = accent;
  ctx.lineWidth = 0.9;
  ctx.stroke();

  ctx.fillStyle = '#334155';
  ctx.fillRect(sx - 4, sy - 24, 8, 2.5);
  ctx.fillRect(sx - 8, sy - 12, 2, 4);
  ctx.fillRect(sx + 6, sy - 12, 2, 4);
}

function drawCommandDeskProp(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  t: number,
  active: boolean
): void {
  // Soft warm amber light pool cast from desk lamp
  drawSoftFloorGlow(
    ctx,
    sx - 18,
    sy - 6,
    38,
    20,
    active ? 'rgba(251, 191, 36, 0.22)' : 'rgba(251, 191, 36, 0.12)'
  );

  // Executive desk main body + angled right wing
  drawIsoBox(ctx, 2.15, 1.75, 1.75, 0.68, 13, '#475569', '#293548', '#1e293b', 'rgba(148,163,184,0.18)');
  drawIsoBox(ctx, 3.65, 1.9, 0.65, 0.72, 13, '#475569', '#293548', '#1e293b', 'rgba(148,163,184,0.16)');

  // Walnut surface inlay
  const d0 = isoToScreen(2.25, 1.83);
  const d1 = isoToScreen(3.8, 1.83);
  const d2 = isoToScreen(3.8, 2.35);
  const d3 = isoToScreen(2.25, 2.35);
  ctx.beginPath();
  ctx.moveTo(d0.x, d0.y - 13.5);
  ctx.lineTo(d1.x, d1.y - 13.5);
  ctx.lineTo(d2.x, d2.y - 13.5);
  ctx.lineTo(d3.x, d3.y - 13.5);
  ctx.closePath();
  ctx.fillStyle = '#3b2b23';
  ctx.fill();

  // Curved Ultrawide Command Display (3 angled facets)
  const mon = isoToScreen(2.95, 1.98);
  ctx.fillStyle = '#94a3b8';
  ctx.fillRect(mon.x - 1.5, mon.y - 18, 3, 5);

  ctx.fillStyle = '#090f1d';
  ctx.beginPath();
  ctx.moveTo(mon.x - 18, mon.y - 31);
  ctx.lineTo(mon.x - 7, mon.y - 29);
  ctx.lineTo(mon.x + 7, mon.y - 29);
  ctx.lineTo(mon.x + 18, mon.y - 31);
  ctx.lineTo(mon.x + 18, mon.y - 18);
  ctx.lineTo(mon.x + 7, mon.y - 16);
  ctx.lineTo(mon.x - 7, mon.y - 16);
  ctx.lineTo(mon.x - 18, mon.y - 18);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 0.9;
  ctx.stroke();

  // Animated mission bars & telemetry inside ultrawide
  const pulse = active ? 0.85 + 0.15 * Math.sin(t * 6) : 0.6;
  ctx.globalAlpha = pulse;
  for (let i = 0; i < 3; i++) {
    const bw = 5 + ((Math.sin(t * (active ? 3.5 : 1.1) + i * 1.6) + 1) * 0.5) * 8;
    ctx.fillStyle = i === 0 ? '#f59e0b' : i === 1 ? '#38bdf8' : '#10b981';
    ctx.fillRect(mon.x - 14, mon.y - 27 + i * 3.5, bw, 2);
  }
  // Right wing mini wave bars
  for (let i = 0; i < 4; i++) {
    const hBar = 2 + Math.abs(Math.sin(t * 4 + i)) * 6;
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(mon.x + 6 + i * 2.5, mon.y - 20 - hBar, 1.6, hBar);
  }
  ctx.globalAlpha = 1;

  // Warm amber architect desk lamp on left side
  const lamp = isoToScreen(2.25, 2.05);
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(lamp.x, lamp.y - 14);
  ctx.lineTo(lamp.x - 3, lamp.y - 24);
  ctx.lineTo(lamp.x + 4, lamp.y - 27);
  ctx.stroke();
  ctx.fillStyle = '#fbbf24';
  ctx.beginPath();
  ctx.arc(lamp.x + 5, lamp.y - 26, 3, 0, Math.PI * 2);
  ctx.fill();
}

function drawBookshelfProp(
  ctx: CanvasRenderingContext2D,
  gx: number,
  gy: number
): void {
  drawIsoBox(ctx, gx - 0.55, gy - 0.22, 1.1, 0.44, 34, '#78350f', '#451a03', '#5c2408', 'rgba(251,191,36,0.16)');
  const base = isoToScreen(gx, gy + 0.22);

  // 4 shelves packed with varied colored book spines
  for (let shelf = 0; shelf < 4; shelf++) {
    const syTop = base.y - 8 - shelf * 7;
    ctx.fillStyle = '#1c0f08';
    ctx.fillRect(base.x - 13, syTop - 4.5, 26, 5);
    let bx = base.x - 12;
    for (let b = 0; b < 8; b++) {
      const bw = b % 3 === 0 ? 3 : 2.3;
      const bh = 3.5 + ((b + shelf) % 3) * 0.7;
      ctx.fillStyle = BOOK_COLORS[(shelf * 5 + b * 3) % BOOK_COLORS.length];
      ctx.fillRect(bx, syTop - bh + 0.5, bw, bh);
      bx += bw + 0.7;
    }
  }
}

function drawLibraryDeskProp(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  t: number,
  active: boolean
): void {
  // Banker's lamp warm emerald-gold light pool
  drawSoftFloorGlow(
    ctx,
    sx - 10,
    sy - 8,
    34,
    18,
    active ? 'rgba(52, 211, 153, 0.18)' : 'rgba(251, 191, 36, 0.14)'
  );

  drawIsoBox(ctx, 9.25, 1.82, 1.5, 0.65, 13, '#7c3f1d', '#4a210d', '#5e2c12', 'rgba(251,191,36,0.15)');

  // Open research tome + stacked reference books
  const book = isoToScreen(10.2, 2.1);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(book.x - 6, book.y - 16, 11, 5);
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(book.x - 0.5, book.y - 16);
  ctx.lineTo(book.x - 0.5, book.y - 11);
  ctx.stroke();

  // Banker's Lamp (brass base + iconic emerald glass shade)
  const lamp = isoToScreen(9.55, 2.0);
  ctx.fillStyle = '#d97706';
  ctx.fillRect(lamp.x - 2.5, lamp.y - 15, 5, 2);
  ctx.fillRect(lamp.x - 0.8, lamp.y - 22, 1.6, 7);
  ctx.fillStyle = '#10b981';
  ctx.beginPath();
  ctx.roundRect(lamp.x - 4.5, lamp.y - 25, 9, 4, 2);
  ctx.fill();
  ctx.fillStyle = `rgba(254, 240, 138, ${active ? 0.8 + 0.2 * Math.sin(t * 4) : 0.65})`;
  ctx.fillRect(lamp.x - 3, lamp.y - 21.5, 6, 1.2);
}

function drawLibraryArmchair(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number
): void {
  ctx.fillStyle = 'rgba(2, 6, 23, 0.45)';
  ctx.beginPath();
  ctx.ellipse(sx, sy + 2, 11, 5.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Cozy tufted cognac-leather armchair
  drawIsoBox(ctx, 11.75, 1.75, 0.72, 0.68, 9, '#9a3412', '#6c220c', '#7c2d12');
  // Plush back & arms
  ctx.fillStyle = '#b45309';
  ctx.beginPath();
  ctx.roundRect(sx - 9, sy - 20, 18, 11, 3.5);
  ctx.fill();
  ctx.fillStyle = '#7c2d12';
  ctx.fillRect(sx - 10, sy - 13, 3.5, 6);
  ctx.fillRect(sx + 6.5, sy - 13, 3.5, 6);
}

function drawEngineeringDeskProp(
  ctx: CanvasRenderingContext2D,
  t: number,
  active: boolean
): void {
  // Dual-tier L-desk (tucked clear of workSpot (15, 3))
  drawIsoBox(ctx, 15.35, 1.68, 1.6, 0.62, 13, '#334155', '#1e293b', '#0f172a', 'rgba(16,185,129,0.2)');
  drawIsoBox(ctx, 15.1, 1.9, 0.48, 0.65, 13, '#334155', '#1e293b', '#0f172a', 'rgba(16,185,129,0.16)');
  // Riser shelf
  drawIsoBox(ctx, 15.48, 1.72, 1.32, 0.24, 4, '#475569', '#1e293b', '#0f172a', undefined, 13);

  // Dual Coding Monitors with live scrolling syntax code lines
  const m1 = isoToScreen(15.82, 1.86);
  const m2 = isoToScreen(16.42, 1.86);
  const scrollOffset = active ? t * 18 : t * 3;

  for (let mIdx = 0; mIdx < 2; mIdx++) {
    const m = mIdx === 0 ? m1 : m2;
    ctx.fillStyle = '#64748b';
    ctx.fillRect(m.x - 1, m.y - 19, 2, 3);
    ctx.fillStyle = '#020617';
    ctx.fillRect(m.x - 9, m.y - 32, 18, 13);
    ctx.strokeStyle = active ? '#10b981' : '#334155';
    ctx.lineWidth = 0.9;
    ctx.strokeRect(m.x - 9, m.y - 32, 18, 13);

    // Clip syntax lines
    ctx.save();
    ctx.beginPath();
    ctx.rect(m.x - 8, m.y - 31, 16, 11);
    ctx.clip();
    for (let row = 0; row < 5; row++) {
      const ly = m.y - 30 + ((row * 3 + scrollOffset) % 13) - 1;
      const lw = 4 + ((row * 5 + mIdx * 3) % 8);
      ctx.fillStyle =
        row % 3 === 0 ? '#34d399' : row % 3 === 1 ? '#38bdf8' : '#fbbf24';
      ctx.fillRect(m.x - 7 + (row % 2) * 2, ly, lw, 1.3);
    }
    ctx.restore();
  }
}

function drawServerRackProp(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  t: number
): void {
  drawSoftFloorGlow(ctx, sx, sy + 2, 24, 12, 'rgba(16, 185, 129, 0.18)');

  // Main brushed-dark server rack chassis
  drawIsoBox(ctx, 17.55, 1.1, 0.85, 0.82, 38, '#334155', '#090f1d', '#141e30', 'rgba(56,189,248,0.22)');

  const front = isoToScreen(17.98, 1.92);

  // Smoked glass front door panel
  ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
  ctx.fillRect(front.x - 12, front.y - 35, 16, 30);
  ctx.strokeStyle = 'rgba(56, 189, 248, 0.35)';
  ctx.lineWidth = 0.8;
  ctx.strokeRect(front.x - 12, front.y - 35, 16, 30);

  // Liquid cooling vertical manifold tube on right side
  ctx.fillStyle = '#06b6d4';
  ctx.fillRect(front.x + 2, front.y - 34, 1.5, 28);
  const bubbleY = front.y - 8 - ((t * 16) % 24);
  ctx.fillStyle = '#e0f2fe';
  ctx.fillRect(front.x + 2, bubbleY, 1.5, 2.5);

  // Multi-row blinking blade activity LEDs
  for (let row = 0; row < 5; row++) {
    const ry = front.y - 32 + row * 4.5;
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(front.x - 10.5, ry, 11, 3);
    for (let led = 0; led < 3; led++) {
      const on = (Math.floor(t * (4 + row) + led * 2) % 3) !== 0;
      ctx.fillStyle = !on
        ? '#1e293b'
        : led === 0
          ? '#10b981'
          : led === 1
            ? '#38bdf8'
            : '#fbbf24';
      ctx.fillRect(front.x - 9.5 + led * 3.4, ry + 0.8, 2, 1.4);
    }
  }

  // Twin spinning cooling fans at bottom of rack
  for (let f = 0; f < 2; f++) {
    const fx = front.x - 7.5 + f * 6.5;
    const fy = front.y - 8;
    ctx.fillStyle = '#020617';
    ctx.beginPath();
    ctx.arc(fx, fy, 2.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 0.9;
    const ang = t * 9 + f * 1.1;
    ctx.beginPath();
    ctx.moveTo(fx - Math.cos(ang) * 2.3, fy - Math.sin(ang) * 2.3);
    ctx.lineTo(fx + Math.cos(ang) * 2.3, fy + Math.sin(ang) * 2.3);
    ctx.moveTo(fx - Math.sin(ang) * 2.3, fy + Math.cos(ang) * 2.3);
    ctx.lineTo(fx + Math.sin(ang) * 2.3, fy - Math.cos(ang) * 2.3);
    ctx.stroke();
  }
}

function drawWarRoomTableAndHolo(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  t: number,
  energized: boolean
): void {
  // Floor holographic emitter ring & glow
  const ringIntensity = energized ? 0.34 : 0.14;
  drawSoftFloorGlow(
    ctx,
    sx,
    sy,
    56,
    28,
    `rgba(139, 92, 246, ${ringIntensity})`
  );

  // Table pedestal shadow + central support column
  ctx.fillStyle = 'rgba(2, 6, 23, 0.52)';
  ctx.beginPath();
  ctx.ellipse(sx, sy + 2, 34, 17, 0, 0, Math.PI * 2);
  ctx.fill();

  drawIsoBox(ctx, 9.45, 6.65, 0.8, 0.7, 9, '#1e1b4b', '#0f172a', '#1e293b');

  // Octagonal beveled walnut conference tabletop
  const pts = [
    isoToScreen(9.15, 6.2),
    isoToScreen(10.55, 6.2),
    isoToScreen(10.95, 6.6),
    isoToScreen(10.95, 7.4),
    isoToScreen(10.55, 7.8),
    isoToScreen(9.15, 7.8),
    isoToScreen(8.75, 7.4),
    isoToScreen(8.75, 6.6),
  ];

  // Tabletop rim thickness (extruded 4px)
  ctx.fillStyle = '#2e1d14';
  ctx.beginPath();
  ctx.moveTo(pts[6].x, pts[6].y - 13);
  ctx.lineTo(pts[5].x, pts[5].y - 13);
  ctx.lineTo(pts[4].x, pts[4].y - 13);
  ctx.lineTo(pts[3].x, pts[3].y - 13);
  ctx.lineTo(pts[2].x, pts[2].y - 13);
  ctx.lineTo(pts[2].x, pts[2].y - 9);
  ctx.lineTo(pts[3].x, pts[3].y - 9);
  ctx.lineTo(pts[4].x, pts[4].y - 9);
  ctx.lineTo(pts[5].x, pts[5].y - 9);
  ctx.lineTo(pts[6].x, pts[6].y - 9);
  ctx.closePath();
  ctx.fill();

  // Walnut tabletop surface
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y - 13);
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i].x, pts[i].y - 13);
  }
  ctx.closePath();
  ctx.fillStyle = '#4c2c1f';
  ctx.fill();
  ctx.strokeStyle = energized ? '#a78bfa' : '#78350f';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Recessed holographic emitter aperture in table center
  const coreBase = isoToScreen(9.85, 7.0);
  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.ellipse(coreBase.x, coreBase.y - 13, 14, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = energized ? '#c4b5fd' : '#6366f1';
  ctx.lineWidth = 1.1;
  ctx.stroke();

  // Vertical Holographic Scan Beam Cone
  const beamH = energized ? 46 : 28;
  const beamGrad = ctx.createLinearGradient(
    coreBase.x,
    coreBase.y - 13,
    coreBase.x,
    coreBase.y - 13 - beamH
  );
  beamGrad.addColorStop(0, energized ? 'rgba(167, 139, 250, 0.45)' : 'rgba(139, 92, 246, 0.22)');
  beamGrad.addColorStop(1, 'rgba(139, 92, 246, 0)');
  ctx.fillStyle = beamGrad;
  ctx.beginPath();
  ctx.moveTo(coreBase.x - 10, coreBase.y - 13);
  ctx.lineTo(coreBase.x + 10, coreBase.y - 13);
  ctx.lineTo(coreBase.x + 22, coreBase.y - 13 - beamH);
  ctx.lineTo(coreBase.x - 22, coreBase.y - 13 - beamH);
  ctx.closePath();
  ctx.fill();

  // Multi-ring rotating 3D holographic core
  const speed = energized ? 2.8 : 1.1;
  const floatY = coreBase.y - 31 + Math.sin(t * 2.5) * 2.5;

  ctx.save();
  // Outer orbital ring 1
  ctx.strokeStyle = energized ? 'rgba(196, 181, 253, 0.85)' : 'rgba(139, 92, 246, 0.55)';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.ellipse(coreBase.x, floatY, 17, 6.5, Math.sin(t * speed) * 0.32, 0, Math.PI * 2);
  ctx.stroke();

  // Outer orbital ring 2 (counter-tilted)
  ctx.strokeStyle = energized ? 'rgba(56, 189, 248, 0.85)' : 'rgba(56, 189, 248, 0.45)';
  ctx.beginPath();
  ctx.ellipse(coreBase.x, floatY, 14, 5.5, -Math.cos(t * speed) * 0.42, 0, Math.PI * 2);
  ctx.stroke();

  // Rotating 3D wireframe octahedron crystal
  const rx = 8.5 * Math.cos(t * speed * 0.8);
  const ry = 8.5 * Math.sin(t * speed * 0.8);
  ctx.fillStyle = energized ? 'rgba(167, 139, 250, 0.65)' : 'rgba(139, 92, 246, 0.42)';
  ctx.strokeStyle = '#ede9fe';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(coreBase.x, floatY - 10);
  ctx.lineTo(coreBase.x + rx, floatY);
  ctx.lineTo(coreBase.x, floatY + 10);
  ctx.lineTo(coreBase.x - rx, floatY);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(coreBase.x, floatY - 10);
  ctx.lineTo(coreBase.x + ry * 0.65, floatY + 1.5);
  ctx.lineTo(coreBase.x, floatY + 10);
  ctx.stroke();

  // Scanning horizontal pulse ring rising through beam when energized
  if (energized) {
    const scanProg = (t * 0.9) % 1;
    const scanY = coreBase.y - 15 - scanProg * 34;
    ctx.globalAlpha = 1 - scanProg;
    ctx.strokeStyle = '#38bdf8';
    ctx.beginPath();
    ctx.ellipse(coreBase.x, scanY, 12 + scanProg * 8, 4.5 + scanProg * 3, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

function drawStudioRingLight(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  active: boolean
): void {
  drawSoftFloorGlow(
    ctx,
    sx,
    sy + 4,
    34,
    17,
    active ? 'rgba(236, 72, 153, 0.24)' : 'rgba(244, 114, 182, 0.14)'
  );

  // Studio Softbox / Ring Light Stand
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(sx - 5, sy + 1);
  ctx.lineTo(sx, sy - 8);
  ctx.lineTo(sx + 5, sy + 1);
  ctx.moveTo(sx, sy - 8);
  ctx.lineTo(sx, sy - 26);
  ctx.stroke();
  ctx.strokeStyle = '#f9a8d4';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.arc(sx, sy - 31, 5.5, 0, Math.PI * 2);
  ctx.stroke();
}

function drawCreativeStudioProp(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  t: number,
  active: boolean
): void {
  drawSoftFloorGlow(
    ctx,
    sx,
    sy - 4,
    30,
    15,
    active ? 'rgba(236, 72, 153, 0.18)' : 'rgba(244, 114, 182, 0.10)'
  );

  // Drafting Tablet Workstation Desk (clear of workSpot (2.2, 7.5))
  drawIsoBox(ctx, 2.55, 6.45, 1.4, 0.6, 13, '#475569', '#293548', '#1e293b', 'rgba(236,72,153,0.18)');

  // Tilted Pen Display Tablet + Color Swatch Display
  const tab = isoToScreen(3.0, 6.72);
  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.moveTo(tab.x - 10, tab.y - 22);
  ctx.lineTo(tab.x + 3, tab.y - 24);
  ctx.lineTo(tab.x + 5, tab.y - 14);
  ctx.lineTo(tab.x - 8, tab.y - 12);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#ec4899';
  ctx.lineWidth = 0.9;
  ctx.stroke();

  // Animated colorful design stroke inside tablet
  ctx.strokeStyle = '#f472b6';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(tab.x - 6, tab.y - 16);
  ctx.quadraticCurveTo(
    tab.x - 1,
    tab.y - 22 + Math.sin(t * 3) * 2,
    tab.x + 2,
    tab.y - 17
  );
  ctx.stroke();

  // Color Swatch Display monitor on right side of desk
  const sw = isoToScreen(3.65, 6.68);
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(sw.x - 6, sw.y - 27, 13, 11);
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 0.8;
  ctx.strokeRect(sw.x - 6, sw.y - 27, 13, 11);
  const swatches = ['#ec4899', '#f59e0b', '#06b6d4', '#8b5cf6'];
  const hi = Math.floor(t * 2) % 4;
  for (let i = 0; i < 4; i++) {
    ctx.fillStyle = swatches[i];
    ctx.globalAlpha = i === hi ? 1 : 0.72;
    ctx.fillRect(sw.x - 4.5 + (i % 2) * 5.2, sw.y - 25.5 + Math.floor(i / 2) * 4.5, 4.2, 3.5);
  }
  ctx.globalAlpha = 1;
}

function drawArtistEasel(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number
): void {
  // Soft shadow
  ctx.fillStyle = 'rgba(2, 6, 23, 0.45)';
  ctx.beginPath();
  ctx.ellipse(sx, sy + 2, 10, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Wooden tripod easel legs
  ctx.strokeStyle = '#92400e';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(sx - 6, sy + 1);
  ctx.lineTo(sx, sy - 29);
  ctx.lineTo(sx + 6, sy + 1);
  ctx.moveTo(sx, sy - 29);
  ctx.lineTo(sx + 2, sy - 4);
  ctx.stroke();

  // Stretched canvas artwork
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(sx - 8, sy - 27, 16, 13);
  ctx.strokeStyle = '#b45309';
  ctx.lineWidth = 1;
  ctx.strokeRect(sx - 8, sy - 27, 16, 13);

  // Expressive abstract painting strokes
  ctx.fillStyle = '#ec4899';
  ctx.fillRect(sx - 6, sy - 24, 6, 5);
  ctx.fillStyle = '#38bdf8';
  ctx.fillRect(sx - 1, sy - 21, 7, 4);
  ctx.fillStyle = '#fbbf24';
  ctx.beginPath();
  ctx.arc(sx + 2, sy - 23, 2.2, 0, Math.PI * 2);
  ctx.fill();
}

function drawQaBenchProp(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  t: number,
  active: boolean
): void {
  drawSoftFloorGlow(
    ctx,
    sx,
    sy - 4,
    36,
    18,
    active ? 'rgba(59, 130, 246, 0.22)' : 'rgba(59, 130, 246, 0.11)'
  );

  // Steel-framed ESD Instrumentation Workbench
  drawIsoBox(ctx, 15.35, 7.45, 1.65, 0.68, 13, '#334155', '#1e293b', '#0f172a', 'rgba(59,130,246,0.22)');

  // Oscilloscope Display (live scrolling sine/pulse waveform)
  const osc = isoToScreen(15.85, 7.72);
  ctx.fillStyle = '#020617';
  ctx.fillRect(osc.x - 11, osc.y - 31, 20, 14);
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 1;
  ctx.strokeRect(osc.x - 11, osc.y - 31, 20, 14);

  // Calibration grid
  ctx.strokeStyle = 'rgba(59, 130, 246, 0.2)';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(osc.x - 10, osc.y - 24);
  ctx.lineTo(osc.x + 8, osc.y - 24);
  ctx.moveTo(osc.x - 1, osc.y - 30);
  ctx.lineTo(osc.x - 1, osc.y - 18);
  ctx.stroke();

  // Animated scrolling oscilloscope waveform
  ctx.strokeStyle = active ? '#34d399' : '#38bdf8';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  const freq = active ? 0.55 : 0.35;
  const speed = active ? 8 : 3.5;
  for (let px = 0; px <= 16; px += 2) {
    const wy =
      osc.y -
      24 +
      Math.sin(px * freq - t * speed) * (active ? 4.2 : 2.5) +
      (px % 6 === 0 && active ? -1.5 : 0);
    if (px === 0) ctx.moveTo(osc.x - 9 + px, wy);
    else ctx.lineTo(osc.x - 9 + px, wy);
  }
  ctx.stroke();

  // Bridge Router Appliance on right side of QA bench
  const router = isoToScreen(16.65, 7.75);
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(router.x - 7, router.y - 21, 14, 7);
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 0.8;
  ctx.strokeRect(router.x - 7, router.y - 21, 14, 7);

  // Twin antennas
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(router.x - 4.5, router.y - 21);
  ctx.lineTo(router.x - 5.5, router.y - 29);
  ctx.moveTo(router.x + 4.5, router.y - 21);
  ctx.lineTo(router.x + 5.5, router.y - 29);
  ctx.stroke();

  // Emerald / Amber Link LEDs
  const blink = Math.floor(t * 6) % 2 === 0;
  ctx.fillStyle = '#10b981';
  ctx.fillRect(router.x - 5, router.y - 18.5, 2, 1.5);
  ctx.fillStyle = blink ? '#fbbf24' : '#38bdf8';
  ctx.fillRect(router.x - 1.5, router.y - 18.5, 2, 1.5);
  ctx.fillStyle = blink ? '#10b981' : '#065f46';
  ctx.fillRect(router.x + 2, router.y - 18.5, 2, 1.5);
}

function drawCoffeeBarProp(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  t: number
): void {
  drawSoftFloorGlow(ctx, sx, sy - 6, 36, 18, 'rgba(249, 115, 22, 0.16)');

  // Warm oak barista counter (clear of workSpot (9, 12))
  drawIsoBox(ctx, 8.72, 11.18, 1.65, 0.56, 15, '#9a5b2c', '#5c2d14', '#753b1a', 'rgba(253,186,116,0.2)');

  // Chrome Espresso Machine
  const esp = isoToScreen(9.25, 11.45);
  ctx.fillStyle = '#cbd5e1';
  ctx.fillRect(esp.x - 7, esp.y - 28, 13, 12);
  ctx.fillStyle = '#64748b';
  ctx.fillRect(esp.x + 2, esp.y - 28, 4, 12);
  // Group head & recessed brew chamber
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(esp.x - 5, esp.y - 21, 7, 5);
  // Glowing indicator light
  ctx.fillStyle = Math.sin(t * 3) > 0 ? '#f97316' : '#fbbf24';
  ctx.fillRect(esp.x - 5, esp.y - 26, 2.5, 1.5);
  ctx.fillStyle = '#10b981';
  ctx.fillRect(esp.x - 1, esp.y - 26, 2, 1.5);

  // Ceramic coffee mugs on counter
  const mug = isoToScreen(9.88, 11.48);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(mug.x - 2, mug.y - 19, 4, 4);
  ctx.fillStyle = '#fb923c';
  ctx.fillRect(mug.x + 4, mug.y - 18, 3.5, 3.5);

  // Multi-strand curling translucent steam wisps rising smoothly
  ctx.save();
  ctx.strokeStyle = 'rgba(248, 250, 252, 0.42)';
  ctx.lineWidth = 1.1;
  for (let s = 0; s < 3; s++) {
    const phase = (t * 0.85 + s * 0.34) % 1;
    const baseX = esp.x - 2 + s * 4;
    const baseY = esp.y - 29;
    const rise = phase * 14;
    ctx.globalAlpha = (1 - phase) * 0.55;
    ctx.beginPath();
    ctx.moveTo(baseX, baseY - rise);
    ctx.quadraticCurveTo(
      baseX + Math.sin(t * 3 + s) * 3,
      baseY - rise - 4,
      baseX - Math.cos(t * 2.4 + s) * 2,
      baseY - rise - 8
    );
    ctx.stroke();
  }
  ctx.restore();
}

function drawLoungeSofa(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number
): void {
  ctx.fillStyle = 'rgba(2, 6, 23, 0.45)';
  ctx.beginPath();
  ctx.ellipse(sx, sy + 2, 18, 9, 0, 0, Math.PI * 2);
  ctx.fill();

  // Comfy tufted velvet sofa
  drawIsoBox(ctx, 7.25, 10.18, 1.2, 0.62, 8, '#c2410c', '#7c2d12', '#9a3412', 'rgba(253,186,116,0.16)');
  // Tufted backrest along top edge
  drawIsoBox(ctx, 7.25, 10.15, 1.2, 0.2, 15, '#ea580c', '#9a3412', '#b45309');

  // Cozy accent throw pillow
  const p = isoToScreen(7.55, 10.45);
  ctx.fillStyle = '#fde68a';
  ctx.beginPath();
  ctx.roundRect(p.x - 3, p.y - 13, 6, 5, 1.5);
  ctx.fill();
}

function drawPottedPlant(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  t: number,
  variant: 'fiddle' | 'palm'
): void {
  // Soft shadow
  ctx.fillStyle = 'rgba(2, 6, 23, 0.45)';
  ctx.beginPath();
  ctx.ellipse(sx, sy + 1, 9, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Tapered ceramic/terracotta planter
  ctx.fillStyle = variant === 'fiddle' ? '#9a3412' : '#475569';
  ctx.beginPath();
  ctx.moveTo(sx - 6.5, sy - 9);
  ctx.lineTo(sx + 6.5, sy - 9);
  ctx.lineTo(sx + 5, sy);
  ctx.lineTo(sx - 5, sy);
  ctx.closePath();
  ctx.fill();

  // Planter rim
  ctx.fillStyle = variant === 'fiddle' ? '#c2410c' : '#64748b';
  ctx.fillRect(sx - 7, sy - 11, 14, 2.5);

  const sway = Math.sin(t * 1.9 + sx * 0.08) * 1.6;
  // Trunk / stems
  ctx.strokeStyle = '#5c4033';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(sx, sy - 10);
  ctx.lineTo(sx + sway * 0.4, sy - 22);
  ctx.stroke();

  if (variant === 'fiddle') {
    // Broad glossy fiddle-leaf blades
    const leaves: ReadonlyArray<[number, number, number, string]> = [
      [-6, -18, -0.45, '#15803d'],
      [6, -19, 0.45, '#166534'],
      [-4, -25, -0.25, '#22c55e'],
      [4, -26, 0.3, '#16a34a'],
      [0, -29, 0.05, '#4ade80'],
    ];
    for (const [lx, ly, rot, col] of leaves) {
      ctx.save();
      ctx.translate(sx + lx + sway * 0.65, sy + ly);
      ctx.rotate(rot + sway * 0.04);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.ellipse(0, 0, 4.8, 3.0, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  } else {
    // Lush arching parlor palm fronds
    const fronds: ReadonlyArray<[number, number, string]> = [
      [-9, -20, '#15803d'],
      [9, -20, '#15803d'],
      [-6, -26, '#22c55e'],
      [6, -26, '#22c55e'],
      [0, -29, '#4ade80'],
    ];
    ctx.lineWidth = 2;
    for (const [fx, fy, col] of fronds) {
      ctx.strokeStyle = col;
      ctx.beginPath();
      ctx.moveTo(sx + sway * 0.3, sy - 14);
      ctx.quadraticCurveTo(sx + fx * 0.6 + sway, sy + fy - 4, sx + fx + sway, sy + fy + 3);
      ctx.stroke();
    }
  }
}

export function collectOfficeFurniture(
  agents: Agent[],
  t: number,
  hasActiveMission: boolean
): FurnitureDrawable[] {
  const zoneWorking = (zoneId: ZoneId) =>
    agents.some(
      (a) =>
        a.currentZone === zoneId &&
        (a.status === 'working' || a.status === 'thinking')
    );

  const warRoomEnergized =
    hasActiveMission ||
    agents.some(
      (a) =>
        a.currentZone === 'war-room' &&
        a.status !== 'offline'
    );

  const items: FurnitureDrawable[] = [
    // 1. Command Desk
    {
      gx: 3.0,
      gy: 2.2,
      draw: (ctx, sx, sy) =>
        drawCommandDeskProp(ctx, sx, sy, t, zoneWorking('command-desk')),
    },
    {
      gx: 3.0,
      gy: 2.7,
      draw: (ctx, sx, sy) => drawExecutiveChair(ctx, sx, sy, '#f59e0b'),
    },

    // 2. Research Library
    {
      gx: 8.5,
      gy: 1.38,
      draw: (ctx) => drawBookshelfProp(ctx, 8.5, 1.38),
    },
    {
      gx: 11.4,
      gy: 1.38,
      draw: (ctx) => drawBookshelfProp(ctx, 11.4, 1.38),
    },
    {
      gx: 10.0,
      gy: 2.1,
      draw: (ctx, sx, sy) =>
        drawLibraryDeskProp(ctx, sx, sy, t, zoneWorking('research-library')),
    },
    {
      gx: 12.1,
      gy: 2.1,
      draw: (ctx, sx, sy) => drawLibraryArmchair(ctx, sx, sy),
    },

    // 3. Engineering Bay
    {
      gx: 16.05,
      gy: 2.05,
      draw: (ctx) =>
        drawEngineeringDeskProp(ctx, t, zoneWorking('engineering-bay')),
    },
    {
      gx: 16.05,
      gy: 2.55,
      draw: (ctx, sx, sy) => drawExecutiveChair(ctx, sx, sy, '#10b981'),
    },
    {
      gx: 18.0,
      gy: 1.5,
      draw: (ctx, sx, sy) => drawServerRackProp(ctx, sx, sy, t),
    },

    // 4. War Room (Chairs + Octagonal Table + Hologram Core)
    {
      gx: 8.6,
      gy: 6.25,
      draw: (ctx, sx, sy) => drawExecutiveChair(ctx, sx, sy, '#8b5cf6'),
    },
    {
      gx: 11.1,
      gy: 6.25,
      draw: (ctx, sx, sy) => drawExecutiveChair(ctx, sx, sy, '#8b5cf6'),
    },
    {
      gx: 9.8,
      gy: 7.0,
      draw: (ctx, sx, sy) =>
        drawWarRoomTableAndHolo(ctx, sx, sy, t, warRoomEnergized),
    },
    {
      gx: 8.6,
      gy: 7.75,
      draw: (ctx, sx, sy) => drawExecutiveChair(ctx, sx, sy, '#8b5cf6'),
    },
    {
      gx: 11.1,
      gy: 7.75,
      draw: (ctx, sx, sy) => drawExecutiveChair(ctx, sx, sy, '#8b5cf6'),
    },

    // 5. Creative Studio
    {
      gx: 1.85,
      gy: 6.7,
      draw: (ctx, sx, sy) =>
        drawStudioRingLight(ctx, sx, sy, zoneWorking('creative-studio')),
    },
    {
      gx: 3.15,
      gy: 6.75,
      draw: (ctx, sx, sy) =>
        drawCreativeStudioProp(ctx, sx, sy, t, zoneWorking('creative-studio')),
    },
    {
      gx: 4.8,
      gy: 7.1,
      draw: (ctx, sx, sy) => drawArtistEasel(ctx, sx, sy),
    },

    // 6. QA & Bridge Lab
    {
      gx: 16.2,
      gy: 8.1,
      draw: (ctx, sx, sy) =>
        drawQaBenchProp(ctx, sx, sy, t, zoneWorking('qa-bench')),
    },
    {
      gx: 16.2,
      gy: 8.55,
      draw: (ctx, sx, sy) => drawExecutiveChair(ctx, sx, sy, '#3b82f6'),
    },

    // 7. Coffee Lounge
    {
      gx: 7.85,
      gy: 10.45,
      draw: (ctx, sx, sy) => drawLoungeSofa(ctx, sx, sy),
    },
    {
      gx: 12.1,
      gy: 10.6,
      draw: (ctx, sx, sy) => drawExecutiveChair(ctx, sx, sy, '#f97316'),
    },
    {
      gx: 9.5,
      gy: 11.45,
      draw: (ctx, sx, sy) => drawCoffeeBarProp(ctx, sx, sy, t),
    },

    // Corner Lush Potted Plants
    {
      gx: 1.25,
      gy: 1.25,
      draw: (ctx, sx, sy) => drawPottedPlant(ctx, sx, sy, t, 'fiddle'),
    },
    {
      gx: 6.35,
      gy: 1.25,
      draw: (ctx, sx, sy) => drawPottedPlant(ctx, sx, sy, t, 'palm'),
    },
    {
      gx: 13.45,
      gy: 1.25,
      draw: (ctx, sx, sy) => drawPottedPlant(ctx, sx, sy, t, 'fiddle'),
    },
    {
      gx: 1.25,
      gy: 10.55,
      draw: (ctx, sx, sy) => drawPottedPlant(ctx, sx, sy, t, 'palm'),
    },
    {
      gx: 18.55,
      gy: 10.55,
      draw: (ctx, sx, sy) => drawPottedPlant(ctx, sx, sy, t, 'fiddle'),
    },
    {
      gx: 7.25,
      gy: 12.6,
      draw: (ctx, sx, sy) => drawPottedPlant(ctx, sx, sy, t, 'palm'),
    },
    {
      gx: 12.65,
      gy: 12.6,
      draw: (ctx, sx, sy) => drawPottedPlant(ctx, sx, sy, t, 'fiddle'),
    },
  ];

  return items;
}

// ============================================================================
// 5. Ambient World-Space Dust Motes & Atmospheric Shimmer
// ============================================================================

export function drawAmbientParticles(
  ctx: CanvasRenderingContext2D,
  t: number,
  lightingMode: LightingMode
): void {
  const pal = LIGHTING_PALETTES[lightingMode] ?? LIGHTING_PALETTES.studio;
  ctx.save();

  const spanX = MAP_W - 0.6;
  const spanY = MAP_H - 0.6;

  for (let i = 0; i < AMBIENT_MOTES.length; i++) {
    const m = AMBIENT_MOTES[i];
    const rawGx = m.baseGx + t * m.driftX + Math.sin(t * 0.4 + m.phase) * 0.4;
    const rawGy = m.baseGy + t * m.driftY + Math.cos(t * 0.35 + m.phase) * 0.35;
    const gx = (((rawGx % spanX) + spanX) % spanX) + 0.3;
    const gy = (((rawGy % spanY) + spanY) % spanY) + 0.3;
    const pt = isoToScreen(gx, gy);
    const floatY = pt.y - m.lift - Math.sin(t * 1.1 + m.phase) * 6;
    const alpha = 0.14 + 0.28 * (0.5 + 0.5 * Math.sin(t * 1.6 + m.phase));

    ctx.globalAlpha = alpha;
    ctx.fillStyle = pal.particleColors[m.colorIdx];
    ctx.beginPath();
    ctx.arc(pt.x, floatY, m.size, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}
