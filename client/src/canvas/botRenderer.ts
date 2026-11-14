import { Agent, CommandBeam, ZONES_META } from '../types';

export interface BurstParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  /** Remaining lifetime in seconds (counts down from maxLife to 0). */
  life: number;
  maxLife: number;
  size: number;
}

export interface FloorRipple {
  gx: number;
  gy: number;
  color: string;
  /** Epoch timestamp (ms) when ripple began. */
  startedAt: number;
  durationMs: number;
}

export interface RenderBotState {
  x: number;
  y: number;
  facing: number;
  walkPhase: number;
  breathPhase: number;
  blinkTimer: number;
  celebrateUntil: number;
  commandPulseUntil: number;
  wanderDx: number;
  wanderDy: number;
  nextWanderAt: number;
  lastStatus: string;
  lastTaskId: string | null;
}

const COLOR_SHADE_CACHE = new Map<string, string>();
const CELEBRATION_PALETTE = ['#34d399', '#fbbf24', '#38bdf8', '#f472b6', '#a78bfa'];

function shadeHex(color: string, delta: number): string {
  const safe = (color || '#38bdf8').trim();
  const cacheKey = `${safe}|${delta}`;
  const cached = COLOR_SHADE_CACHE.get(cacheKey);
  if (cached) return cached;

  let hex = safe;
  if (/^#[0-9a-fA-F]{3}$/.test(hex)) {
    hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  }
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
    return safe;
  }

  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);

  const adjust = (channel: number) => {
    const next = delta >= 0 ? channel + (255 - channel) * delta : channel * (1 + delta);
    return Math.max(0, Math.min(255, Math.round(next)));
  };

  const result = `rgb(${adjust(r)}, ${adjust(g)}, ${adjust(b)})`;
  if (COLOR_SHADE_CACHE.size > 256) {
    COLOR_SHADE_CACHE.clear();
  }
  COLOR_SHADE_CACHE.set(cacheKey, result);
  return result;
}

function pseudoHash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function clampToZone(
  agent: Agent,
  baseX: number,
  baseY: number,
  dx: number,
  dy: number
): { dx: number; dy: number } {
  let ndx = dx;
  let ndy = dy;

  // Enforce strict <= 0.38 tile radius around seat/target
  const dist = Math.hypot(ndx, ndy);
  if (dist > 0.36) {
    const scale = 0.36 / dist;
    ndx *= scale;
    ndy *= scale;
  }

  const zoneId = agent.currentZone || agent.homeZone;
  const zoneMeta = ZONES_META.find((z) => z.id === zoneId);
  if (zoneMeta) {
    const { x: zx, y: zy, w: zw, h: zh } = zoneMeta.bounds;
    if (baseX >= zx && baseX <= zx + zw && baseY >= zy && baseY <= zy + zh) {
      const margin = 0.32;
      const minX = zx + margin;
      const maxX = zx + zw - margin;
      const minY = zy + margin;
      const maxY = zy + zh - margin;
      const clampedX = Math.min(Math.max(baseX + ndx, minX), maxX);
      const clampedY = Math.min(Math.max(baseY + ndy, minY), maxY);
      ndx = clampedX - baseX;
      ndy = clampedY - baseY;
    }
  }

  return { dx: ndx, dy: ndy };
}

export function createRenderBotState(agent: Agent, index: number): RenderBotState {
  const initialPos =
    (agent.status === 'walking' ? agent.targetPosition : agent.position) ||
    agent.position ||
    agent.targetPosition || { x: 10, y: 7 };

  const seed = pseudoHash(`${agent.id}:${index}`);

  return {
    x: initialPos.x,
    y: initialPos.y,
    facing: index % 2 === 0 ? 1 : -1,
    walkPhase: 0,
    breathPhase: ((seed % 628) / 100) % (Math.PI * 2),
    blinkTimer: 1.1 + (seed % 280) / 100,
    celebrateUntil: 0,
    commandPulseUntil: 0,
    wanderDx: 0,
    wanderDy: 0,
    nextWanderAt: 0,
    lastStatus: agent.status,
    lastTaskId: agent.currentTaskId ?? null,
  };
}

export function updateBotAnimationState(
  state: RenderBotState,
  agent: Agent,
  destX: number,
  destY: number,
  dt: number,
  nowMs: number,
  particles: BurstParticle[],
  ripples: FloorRipple[],
  isSelected: boolean,
  isoToScreen: (gx: number, gy: number) => { x: number; y: number }
): void {
  const safeDt = Math.min(Math.max(dt, 0), 0.1);
  const currentTaskId = agent.currentTaskId ?? null;

  // Advance natural breathing cadence
  const breathRate =
    agent.status === 'working'
      ? 3.6
      : agent.status === 'talking'
        ? 3.1
        : agent.status === 'offline'
          ? 1.0
          : 2.1;
  state.breathPhase = (state.breathPhase + safeDt * breathRate) % (Math.PI * 2);

  // Advance double-blink cadence
  state.blinkTimer -= safeDt;
  const wantsDoubleBlink = Math.sin(state.breathPhase * 5.7 + state.x * 2.9) > 0.4;
  const resetThreshold = wantsDoubleBlink ? -0.32 : -0.12;
  if (state.blinkTimer <= resetThreshold) {
    const jitter = Math.abs(Math.sin(nowMs * 0.0017 + state.y * 3.1));
    state.blinkTimer = 2.4 + jitter * 2.9;
  }

  // Detect instant command arrival / activation
  const taskChangedToNonNull = Boolean(currentTaskId && currentTaskId !== state.lastTaskId);
  const wasCalm = state.lastStatus === 'idle' || state.lastStatus === 'online';
  const enteredActive = wasCalm && (agent.status === 'thinking' || agent.status === 'working');

  if (taskChangedToNonNull || enteredActive) {
    state.commandPulseUntil = nowMs + 1650;
    const pulseColor = agent.status === 'thinking' ? '#fbbf24' : agent.color || '#38bdf8';
    if (ripples.length < 48) {
      ripples.push({
        gx: state.x,
        gy: state.y,
        color: pulseColor,
        startedAt: nowMs,
        durationMs: 920,
      });
    }
    if (particles.length < 180) {
      const sp = isoToScreen(state.x, state.y);
      for (let i = 0; i < 7; i++) {
        const angle = (Math.PI * 2 * i) / 7 + (state.breathPhase % 1);
        particles.push({
          x: sp.x + Math.cos(angle) * 5,
          y: sp.y - 16 + Math.sin(angle) * 2.5,
          vx: Math.cos(angle) * 28,
          vy: Math.sin(angle) * 14 - 24,
          color: i % 2 === 0 ? pulseColor : '#e0f2fe',
          life: 0.46,
          maxLife: 0.46,
          size: 2.1,
        });
      }
    }
  }

  // Detect task completion celebration
  const finishedTask =
    Boolean(state.lastTaskId) &&
    !currentTaskId &&
    agent.status !== 'offline' &&
    agent.status !== 'error';

  if (finishedTask) {
    state.celebrateUntil = Math.max(state.celebrateUntil, nowMs + 2200);
    if (ripples.length < 48) {
      ripples.push({
        gx: state.x,
        gy: state.y,
        color: '#34d399',
        startedAt: nowMs,
        durationMs: 1100,
      });
    }
    if (particles.length < 180) {
      const sp = isoToScreen(state.x, state.y);
      const botAccent = agent.color || '#34d399';
      for (let i = 0; i < 14; i++) {
        const angle = -Math.PI + (Math.PI * i) / 13 + (Math.sin(i * 2.1) * 0.18);
        const speed = 38 + (i % 4) * 18;
        particles.push({
          x: sp.x + ((i % 3) - 1) * 3,
          y: sp.y - 24,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 36,
          color: i % 3 === 0 ? botAccent : CELEBRATION_PALETTE[i % CELEBRATION_PALETTE.length],
          life: 0.72 + (i % 3) * 0.12,
          maxLife: 0.72 + (i % 3) * 0.12,
          size: 2.2 + (i % 2) * 0.9,
        });
      }
    }
  }

  // Ambient idle micro-wandering ONLY when truly idle/online, unassigned, and unselected
  const canWander =
    (agent.status === 'idle' || agent.status === 'online') &&
    !currentTaskId &&
    !isSelected;

  if (!canWander) {
    state.wanderDx = 0;
    state.wanderDy = 0;
    state.nextWanderAt = nowMs + 1600;
  } else {
    if (state.nextWanderAt === 0) {
      const stagger = pseudoHash(agent.id) % 2600;
      state.nextWanderAt = nowMs + 1400 + stagger;
    } else if (nowMs >= state.nextWanderAt) {
      const roll = Math.abs(Math.sin(nowMs * 0.0023 + pseudoHash(agent.id) * 0.01));
      if (roll < 0.34) {
        // Return calmly to home seat center
        state.wanderDx = 0;
        state.wanderDy = 0;
      } else {
        const angle = ((nowMs * 0.0031 + pseudoHash(agent.id)) % 628) / 100;
        const radius = 0.14 + (roll - 0.34) * 0.32;
        const clamped = clampToZone(
          agent,
          destX,
          destY,
          Math.cos(angle) * radius,
          Math.sin(angle) * radius * 0.85
        );
        state.wanderDx = clamped.dx;
        state.wanderDy = clamped.dy;
      }
      state.nextWanderAt = nowMs + 3400 + Math.round(roll * 2800);
    }
  }

  // Smooth velocity easing toward target
  const targetX = destX + state.wanderDx;
  const targetY = destY + state.wanderDy;
  const dx = targetX - state.x;
  const dy = targetY - state.y;
  const dist = Math.hypot(dx, dy);

  if (dist > 0.012) {
    const isStrolling = canWander && dist <= 0.45 && agent.status !== 'walking';
    const maxSpeed = isStrolling ? 0.58 : Math.min(7.5, Math.max(4.4, dist * 5.2));
    const easeFactor = isStrolling ? 3.2 : 8.5;
    const desiredStep = Math.min(dist, Math.min(maxSpeed, dist * easeFactor) * safeDt + safeDt * 0.18);
    const step = Math.min(dist, desiredStep);

    state.x += (dx / dist) * step;
    state.y += (dy / dist) * step;

    if (step > 0.0025) {
      state.walkPhase += step * (isStrolling ? 1.55 : 1.15);
      const isoScreenDx = dx - dy;
      if (Math.abs(isoScreenDx) > 0.015) {
        state.facing = isoScreenDx >= 0 ? 1 : -1;
      }
    }
  } else {
    state.x = targetX;
    state.y = targetY;
  }

  state.lastStatus = agent.status;
  state.lastTaskId = currentTaskId;
}

function drawRoleAccessory(
  ctx: CanvasRenderingContext2D,
  agent: Agent,
  t: number,
  isOffline: boolean,
  isWorking: boolean,
  isThinking: boolean
): void {
  const variant = agent.avatarVariant;
  const accent = agent.color || '#38bdf8';

  if (variant === 'lead') {
    // Commander crown crest with glowing gem
    ctx.fillStyle = '#d97706';
    ctx.beginPath();
    ctx.roundRect(-7, -14, 14, 3.5, 1.5);
    ctx.fill();
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.moveTo(-6, -13.5);
    ctx.lineTo(-4.5, -18);
    ctx.lineTo(-1.5, -14.5);
    ctx.lineTo(0, -19.5);
    ctx.lineTo(1.5, -14.5);
    ctx.lineTo(4.5, -18);
    ctx.lineTo(6, -13.5);
    ctx.closePath();
    ctx.fill();
    if (!isOffline) {
      ctx.fillStyle = '#fef08a';
      ctx.beginPath();
      ctx.arc(0, -16, 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }

  if (variant === 'coder') {
    // Sleek studio headphones + glowing emerald earcups
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(0, -7, 10.5, Math.PI * 0.98, Math.PI * 2.02);
    ctx.stroke();
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, -7, 11, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();

    for (const side of [-1, 1]) {
      ctx.fillStyle = '#0f172a';
      ctx.beginPath();
      ctx.roundRect(side === -1 ? -11.5 : 8.5, -10.5, 3, 7, 1.5);
      ctx.fill();
      ctx.fillStyle = isOffline ? '#475569' : isWorking ? '#34d399' : '#10b981';
      ctx.fillRect(side === -1 ? -10.8 : 9.4, -9, 1.4, 4);
    }
    return;
  }

  if (variant === 'creative') {
    // Tilted studio beret with soft fold & stem
    ctx.save();
    ctx.translate(-1, -14);
    ctx.rotate(-0.14);
    ctx.fillStyle = '#be185d';
    ctx.beginPath();
    ctx.ellipse(0, 0, 8.5, 3.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ec4899';
    ctx.beginPath();
    ctx.ellipse(-0.5, -1, 7.5, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fbcfe8';
    ctx.fillRect(-0.8, -4.5, 1.6, 2.2);
    ctx.restore();
    return;
  }

  if (variant === 'external') {
    // Twin bridge telemetry horns with pulsing magenta link orbs
    for (const side of [-1, 1]) {
      const x = side * 6.2;
      ctx.fillStyle = '#7e22ce';
      ctx.beginPath();
      ctx.roundRect(x - 1.2, -19, 2.4, 6, 1);
      ctx.fill();

      const pulse = isOffline ? 0.3 : 0.75 + 0.25 * Math.sin(t * 5 + side);
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.fillStyle = isOffline ? '#64748b' : '#e879f9';
      ctx.beginPath();
      ctx.arc(x, -19.8, 2.2, 0, Math.PI * 2);
      ctx.fill();
      if (!isOffline) {
        ctx.strokeStyle = '#d946ef';
        ctx.lineWidth = 0.9;
        ctx.globalAlpha = 0.45 * (1 - ((t * 1.5 + (side > 0 ? 0.5 : 0)) % 1));
        const ringR = 2.4 + ((t * 1.5 + (side > 0 ? 0.5 : 0)) % 1) * 4.5;
        ctx.beginPath();
        ctx.arc(x, -19.8, ringR, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
    return;
  }

  // Default / researcher / qa antenna with animated signal pulse rings
  ctx.fillStyle = '#64748b';
  ctx.fillRect(-1, -18, 2, 5);
  const tipColor = isOffline ? '#64748b' : isThinking ? '#fbbf24' : accent;
  ctx.fillStyle = tipColor;
  ctx.beginPath();
  ctx.arc(0, -19, 2.3, 0, Math.PI * 2);
  ctx.fill();

  if (!isOffline) {
    const wave = (t * 1.1) % 1;
    ctx.save();
    ctx.strokeStyle = tipColor;
    ctx.globalAlpha = (1 - wave) * 0.55;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, -19, 2.5 + wave * 6.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

export function drawRealisticBot(
  ctx: CanvasRenderingContext2D,
  agent: Agent,
  renderState: RenderBotState,
  t: number,
  nowMs: number,
  isSelected: boolean,
  isHovered: boolean,
  hasStuckTask: boolean,
  isoToScreen: (gx: number, gy: number) => { x: number; y: number }
): void {
  const { x: sx, y: sy } = isoToScreen(renderState.x, renderState.y);

  const dest =
    (agent.status === 'walking' ? agent.targetPosition : agent.position) ||
    agent.position ||
    agent.targetPosition || { x: renderState.x, y: renderState.y };
  const destDist = Math.hypot(dest.x - renderState.x, dest.y - renderState.y);

  const isWalking = agent.status === 'walking' || destDist > 0.12;
  const isWorking = agent.status === 'working';
  const isThinking = agent.status === 'thinking' || agent.status === 'meeting';
  const isTalking = agent.status === 'talking';
  const isOffline = agent.status === 'offline';
  const isError = agent.status === 'error';
  const isCelebrating = renderState.celebrateUntil > nowMs && !isOffline && !isError;
  const isCommandPulsing = renderState.commandPulseUntil > nowMs;
  const inCoffeeLounge =
    agent.currentZone === 'coffee-lounge' &&
    (agent.status === 'idle' || agent.status === 'online') &&
    !isWalking &&
    !isCelebrating;

  const facing = renderState.facing >= 0 ? 1 : -1;
  const breath = Math.sin(renderState.breathPhase);

  const bob = isCelebrating
    ? Math.abs(Math.sin(t * 9.5)) * 4.2
    : isWalking
      ? Math.abs(Math.sin(renderState.walkPhase * 7.5)) * 3.2
      : isWorking
        ? Math.sin(t * 14) * 0.55
        : isTalking
          ? Math.abs(Math.sin(t * 7.8)) * 1.4
          : isOffline
            ? -1.2
            : breath * 0.95;

  const jacketBase = agent.color || '#38bdf8';
  const jacketLight = shadeHex(jacketBase, 0.28);
  const jacketDark = shadeHex(jacketBase, -0.28);
  const jacketDeep = shadeHex(jacketBase, -0.46);

  ctx.save();
  if (isOffline) ctx.globalAlpha = 0.56;

  // 1. Floor ambient selection spotlight & floor status rings
  if (isSelected) {
    const beamGrad = ctx.createLinearGradient(sx, sy + 2, sx, sy - 46);
    beamGrad.addColorStop(0, 'rgba(251, 191, 36, 0.22)');
    beamGrad.addColorStop(1, 'rgba(251, 191, 36, 0)');
    ctx.fillStyle = beamGrad;
    ctx.beginPath();
    ctx.moveTo(sx - 15, sy + 2);
    ctx.lineTo(sx + 15, sy + 2);
    ctx.lineTo(sx + 9, sy - 46);
    ctx.lineTo(sx - 9, sy - 46);
    ctx.closePath();
    ctx.fill();
  }

  if (hasStuckTask && !isOffline) {
    const stuckPulse = 0.55 + 0.45 * Math.sin(t * 6.5);
    ctx.save();
    ctx.strokeStyle = `rgba(245, 158, 11, ${0.5 + stuckPulse * 0.4})`;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.lineDashOffset = -t * 18;
    ctx.beginPath();
    ctx.ellipse(sx, sy + 2, 20 + stuckPulse * 2, 10 + stuckPulse, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  if (isCommandPulsing) {
    const pulseRem = (renderState.commandPulseUntil - nowMs) / 1650;
    const pulseColor = isThinking ? '#fbbf24' : '#22d3ee';
    ctx.save();
    ctx.strokeStyle = pulseColor;
    ctx.globalAlpha = pulseRem * 0.85;
    ctx.lineWidth = 2.2;
    const r = 16 + (1 - pulseRem) * 10;
    ctx.beginPath();
    ctx.ellipse(sx, sy + 2, r, r * 0.5, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  if (isSelected || isHovered) {
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(sx, sy + 2, 18, 9, 0, 0, Math.PI * 2);
    ctx.strokeStyle = isSelected ? '#fbbf24' : 'rgba(226, 232, 240, 0.8)';
    ctx.lineWidth = isSelected ? 2.2 : 1.5;
    if (isSelected) {
      ctx.setLineDash([4, 3]);
      ctx.lineDashOffset = -t * 14;
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // Multi-stop soft radial floor contact shadow
  ctx.save();
  const shadowScale = Math.max(0.75, 1 - Math.max(0, bob) * 0.035);
  ctx.translate(sx, sy + 2);
  ctx.scale(shadowScale, shadowScale * 0.52);
  const shadowGrad = ctx.createRadialGradient(0, 0, 1, 0, 0, 14);
  shadowGrad.addColorStop(0, 'rgba(2, 6, 23, 0.72)');
  shadowGrad.addColorStop(0.55, 'rgba(2, 6, 23, 0.34)');
  shadowGrad.addColorStop(1, 'rgba(2, 6, 23, 0)');
  ctx.fillStyle = shadowGrad;
  ctx.beginPath();
  ctx.arc(0, 0, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const baseY = sy - bob;

  // 2. Articulated Legs + Sneakers
  const stride = isWalking ? Math.sin(renderState.walkPhase * 7.5) : 0;
  const leftLegY = isWalking ? stride * 2.4 : isCelebrating ? Math.max(0, Math.sin(t * 12)) * -1.8 : 0;
  const rightLegY = isWalking ? -stride * 2.4 : isCelebrating ? Math.max(0, -Math.sin(t * 12)) * -1.8 : 0;
  const leftLegX = isWalking ? stride * 1.4 * facing : 0;
  const rightLegX = isWalking ? -stride * 1.4 * facing : 0;

  for (const leg of [
    { x: sx - 4.8 + leftLegX, y: baseY - 7 + leftLegY, dark: facing > 0 },
    { x: sx + 1.2 + rightLegX, y: baseY - 7 + rightLegY, dark: facing < 0 },
  ]) {
    ctx.fillStyle = leg.dark ? '#1e293b' : '#334155';
    ctx.beginPath();
    ctx.roundRect(leg.x, leg.y, 3.8, 6.5, 1.4);
    ctx.fill();
    // Shoe & sole highlight
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.roundRect(leg.x - 0.5, leg.y + 4.8, 4.8, 2.6, 1);
    ctx.fill();
    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(leg.x - 0.3, leg.y + 6.7, 4.4, 0.9);
  }

  // 3. Torso — Layered Studio Hoodie / Jacket
  const torsoTop = baseY - 21;
  const torsoH = 14.5;
  ctx.fillStyle = jacketBase;
  ctx.beginPath();
  ctx.roundRect(sx - 8.5, torsoTop, 17, torsoH, [5, 5, 3, 3]);
  ctx.fill();

  // Isometric side shadow panel on torso
  ctx.fillStyle = jacketDark;
  ctx.beginPath();
  if (facing >= 0) {
    ctx.roundRect(sx - 8.5, torsoTop, 5.2, torsoH, [5, 0, 0, 3]);
  } else {
    ctx.roundRect(sx + 3.3, torsoTop, 5.2, torsoH, [0, 5, 3, 0]);
  }
  ctx.fill();

  // Shoulder highlight trim
  ctx.strokeStyle = jacketLight;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(sx - 6.8, torsoTop + 1.1);
  ctx.lineTo(sx + 6.8, torsoTop + 1.1);
  ctx.stroke();

  // Hoodie lapel / collar & center zip seam
  ctx.fillStyle = jacketDeep;
  ctx.beginPath();
  ctx.moveTo(sx - 4.2, torsoTop);
  ctx.lineTo(sx + 4.2, torsoTop);
  ctx.lineTo(sx + facing * 0.6, torsoTop + 5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(sx + facing * 0.6 - 0.5, torsoTop + 4.5, 1, 9);

  // Glowing chest core reactor
  const coreX = sx + facing * 1.4;
  const coreY = torsoTop + 7.2;
  const coreColor = isOffline || isError
    ? '#ef4444'
    : isWorking
      ? '#34d399'
      : isThinking
        ? '#fbbf24'
        : isTalking
          ? '#22d3ee'
          : jacketLight;

  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.arc(coreX, coreY, 3.1, 0, Math.PI * 2);
  ctx.fill();

  if (!isOffline) {
    ctx.save();
    ctx.globalAlpha = 0.28 + 0.14 * Math.sin(renderState.breathPhase * 2);
    ctx.fillStyle = coreColor;
    ctx.beginPath();
    ctx.arc(coreX, coreY, 4.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.fillStyle = coreColor;
  ctx.beginPath();
  ctx.arc(coreX, coreY, 1.9, 0, Math.PI * 2);
  ctx.fill();

  // 4. Articulated Arms & Hands
  const drawArm = (
    shoulderX: number,
    shoulderY: number,
    handX: number,
    handY: number,
    isShadowSide: boolean
  ) => {
    ctx.lineCap = 'round';
    ctx.strokeStyle = isShadowSide ? jacketDark : jacketBase;
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.moveTo(shoulderX, shoulderY);
    ctx.lineTo(handX, handY);
    ctx.stroke();
    // Cuff & hand mitten
    ctx.fillStyle = '#e2e8f0';
    ctx.beginPath();
    ctx.arc(handX, handY, 2, 0, Math.PI * 2);
    ctx.fill();
  };

  const lShX = sx - 8.5;
  const rShX = sx + 8.5;
  const shY = torsoTop + 3.2;

  if (isCelebrating) {
    const wave = Math.sin(t * 14) * 2.2;
    drawArm(lShX, shY, sx - 12.5, torsoTop - 7 + wave, facing > 0);
    drawArm(rShX, shY, sx + 12.5, torsoTop - 7 - wave, facing < 0);
  } else if (isWorking) {
    const typeL = Math.sin(t * 22) * 2.1;
    const typeR = Math.cos(t * 22) * 2.1;
    drawArm(lShX, shY, sx - 5.5 + facing * 3, shY + 5.5 + typeL, facing > 0);
    drawArm(rShX, shY, sx + 5.5 + facing * 3, shY + 5.5 + typeR, facing < 0);
    // Subtle holographic keyboard spark flicker at fingertips
    ctx.fillStyle = 'rgba(52, 211, 153, 0.55)';
    ctx.fillRect(sx + facing * 3 - 4, shY + 8, 8, 1.4);
  } else if (isTalking) {
    const gest = Math.sin(t * 9) * 3.5;
    drawArm(lShX, shY, sx - 11.5, shY + 3 - gest * 0.5, facing > 0);
    drawArm(rShX, shY, sx + 11.5, shY + 1 + gest, facing < 0);
  } else if (inCoffeeLounge) {
    // One arm relaxed, front arm holds a tiny steaming ceramic coffee mug
    const mugX = sx + facing * 10.5;
    const mugY = shY + 4.2 + breath * 0.5;
    if (facing >= 0) {
      drawArm(lShX, shY, lShX - 1.5, shY + 8 + breath * 0.4, true);
      drawArm(rShX, shY, mugX - 1.5, mugY + 0.8, false);
    } else {
      drawArm(rShX, shY, rShX + 1.5, shY + 8 + breath * 0.4, true);
      drawArm(lShX, shY, mugX + 1.5, mugY + 0.8, false);
    }
    // Tiny ceramic coffee mug
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.roundRect(mugX - 2.3, mugY - 2.2, 4.6, 5, 1);
    ctx.fill();
    ctx.fillStyle = '#f97316';
    ctx.fillRect(mugX - 2.3, mugY - 0.4, 4.6, 1.3);
    ctx.fillStyle = '#78350f';
    ctx.fillRect(mugX - 1.7, mugY - 2.2, 3.4, 1);
    // Delicate curling steam wisps
    ctx.fillStyle = 'rgba(248, 250, 252, 0.52)';
    const wisp = (t * 10) % 7;
    ctx.beginPath();
    ctx.arc(mugX + Math.sin(t * 4) * 1.1, mugY - 4 - wisp, 1, 0, Math.PI * 2);
    ctx.arc(mugX - Math.cos(t * 3.5) * 1.1, mugY - 6.5 - ((wisp + 3) % 7), 0.85, 0, Math.PI * 2);
    ctx.fill();
  } else if (isThinking) {
    drawArm(lShX, shY, lShX - 1.5, shY + 8, facing > 0);
    drawArm(rShX, shY, sx + facing * 4.5, torsoTop - 1.5, facing < 0);
  } else if (isWalking) {
    drawArm(lShX, shY, lShX - 1.5 + stride * 2.6 * facing, shY + 7.5, facing > 0);
    drawArm(rShX, shY, rShX + 1.5 - stride * 2.6 * facing, shY + 7.5, facing < 0);
  } else {
    drawArm(lShX, shY, lShX - 1.5, shY + 8 + breath * 0.5, facing > 0);
    drawArm(rShX, shY, rShX + 1.5, shY + 8 + breath * 0.5, facing < 0);
  }

  // 5. Neck Joint
  ctx.fillStyle = '#475569';
  ctx.fillRect(sx - 2.5, torsoTop - 2.2, 5, 3);

  // 6. Rounded Futuristic Chassis Head + Glass Visor + Role Accessory
  const headTilt = isThinking
    ? Math.sin(t * 2.1) * 0.045
    : isWorking
      ? 0.04 * facing
      : isTalking
        ? Math.sin(t * 6.5) * 0.045
        : isOffline
          ? 0.08 * facing
          : 0;

  ctx.save();
  ctx.translate(sx, torsoTop - 8.5);
  ctx.rotate(headTilt);

  // Chassis shell gradient
  const headGrad = ctx.createLinearGradient(-9.5, -7.5, 9.5, 7.5);
  headGrad.addColorStop(0, '#f8fafc');
  headGrad.addColorStop(0.55, '#e2e8f0');
  headGrad.addColorStop(1, '#cbd5e1');
  ctx.fillStyle = headGrad;
  ctx.beginPath();
  ctx.roundRect(-9.5, -7.5, 19, 15, 5);
  ctx.fill();

  // Metallic side panel shading
  ctx.fillStyle = '#94a3b8';
  ctx.beginPath();
  if (facing >= 0) {
    ctx.roundRect(-9.5, -6, 3.2, 12, [4, 0, 0, 4]);
  } else {
    ctx.roundRect(6.3, -6, 3.2, 12, [0, 4, 4, 0]);
  }
  ctx.fill();

  // Subtle chassis rim
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.roundRect(-9.2, -7.2, 18.4, 14.4, 4.8);
  ctx.stroke();

  // Recessed glass visor
  const visorX = -7.2 + facing * 0.6;
  const visorY = -4.8;
  const visorW = 14.4;
  const visorH = 9.8;

  const visorGrad = ctx.createLinearGradient(visorX, visorY, visorX, visorY + visorH);
  visorGrad.addColorStop(0, '#090f1e');
  visorGrad.addColorStop(1, '#15223b');
  ctx.fillStyle = visorGrad;
  ctx.beginPath();
  ctx.roundRect(visorX, visorY, visorW, visorH, 3.2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
  ctx.lineWidth = 0.8;
  ctx.stroke();

  // Diagonal glass specular gleam clipped cleanly inside visor
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(visorX, visorY, visorW, visorH, 3.2);
  ctx.clip();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.beginPath();
  ctx.moveTo(visorX - 2, visorY + 4.5);
  ctx.lineTo(visorX + 6.5, visorY - 1);
  ctx.lineTo(visorX + 10, visorY - 1);
  ctx.lineTo(visorX + 1.5, visorY + 6.5);
  ctx.closePath();
  ctx.fill();

  // Expressive Eyes Inside Visor
  const isBlinking =
    (renderState.blinkTimer <= 0 && renderState.blinkTimer > -0.12) ||
    (renderState.blinkTimer <= -0.20 && renderState.blinkTimer > -0.32);

  const eyeCenterL = visorX + 4.3;
  const eyeCenterR = visorX + 10.1;
  const eyeCenterY = visorY + 4.7;

  if (isOffline || isError) {
    ctx.fillStyle = isError ? '#f87171' : '#dc2626';
    ctx.fillRect(eyeCenterL - 1.7, eyeCenterY - 0.6, 3.4, 1.5);
    ctx.fillRect(eyeCenterR - 1.7, eyeCenterY - 0.6, 3.4, 1.5);
  } else if (isCelebrating) {
    ctx.strokeStyle = '#34d399';
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    for (const ex of [eyeCenterL, eyeCenterR]) {
      ctx.beginPath();
      ctx.moveTo(ex - 1.8, eyeCenterY + 0.8);
      ctx.lineTo(ex, eyeCenterY - 1.2);
      ctx.lineTo(ex + 1.8, eyeCenterY + 0.8);
      ctx.stroke();
    }
    // Happy smile arc
    ctx.strokeStyle = '#fde68a';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(visorX + visorW / 2, eyeCenterY + 1.5, 2.2, 0.2, Math.PI - 0.2);
    ctx.stroke();
  } else if (isBlinking) {
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(eyeCenterL - 1.6, eyeCenterY + 0.4, 3.2, 1);
    ctx.fillRect(eyeCenterR - 1.6, eyeCenterY + 0.4, 3.2, 1);
  } else {
    const eyeColor = isWorking
      ? '#34d399'
      : isThinking
        ? '#fbbf24'
        : isTalking
          ? '#22d3ee'
          : '#38bdf8';

    const lookX = isWorking
      ? Math.sin(t * 7.5) * 1.2
      : isThinking
        ? Math.sin(t * 1.9) * 1.1
        : facing * 0.7;
    const lookY = isWorking ? 0.5 : isThinking ? -0.7 : 0;

    ctx.fillStyle = eyeColor;
    for (const ex of [eyeCenterL, eyeCenterR]) {
      ctx.beginPath();
      ctx.roundRect(ex - 1.4 + lookX, eyeCenterY - 1.6 + lookY, 2.8, 3.3, 1.1);
      ctx.fill();
      // Tiny eye glint
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(ex - 0.9 + lookX, eyeCenterY - 1.1 + lookY, 0.9, 0.9);
      ctx.fillStyle = eyeColor;
    }

    if (isTalking) {
      const mouthW = 2.4 + Math.abs(Math.sin(t * 15)) * 4.2;
      ctx.fillStyle = '#67e8f9';
      ctx.beginPath();
      ctx.roundRect(visorX + visorW / 2 - mouthW / 2, eyeCenterY + 2.5, mouthW, 1.4, 0.7);
      ctx.fill();
    } else if (isSelected || isHovered) {
      ctx.strokeStyle = 'rgba(186, 230, 253, 0.85)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(visorX + visorW / 2 + lookX * 0.4, eyeCenterY + 1.8, 1.8, 0.25, Math.PI - 0.25);
      ctx.stroke();
    }
  }
  ctx.restore(); // end visor clip

  // Role Accessory attached to head chassis
  drawRoleAccessory(ctx, agent, t, isOffline, isWorking, isThinking);
  ctx.restore(); // end head tilt

  // 7. Floating Micro-UI Cues Above Head
  const cueY = baseY - 43;
  if (isWorking) {
    const codeGlyph = Math.floor(t * 3.5) % 2 === 0 ? '</>' : '{ }';
    ctx.save();
    ctx.fillStyle = 'rgba(6, 78, 59, 0.78)';
    ctx.beginPath();
    ctx.roundRect(sx - 12, cueY - 7, 24, 13, 4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(52, 211, 153, 0.65)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#34d399';
    ctx.font = '700 8.5px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(codeGlyph, sx, cueY - 0.2);
    ctx.restore();
  } else if (isThinking) {
    // Orbiting thinking dots
    ctx.save();
    for (let i = 0; i < 3; i++) {
      const ang = t * 4.2 + (i * Math.PI * 2) / 3;
      const ox = sx + Math.cos(ang) * 8;
      const oy = cueY + Math.sin(ang) * 2.6;
      const depthAlpha = 0.45 + 0.55 * ((Math.sin(ang) + 1) / 2);
      ctx.globalAlpha = depthAlpha;
      ctx.fillStyle = '#fbbf24';
      ctx.beginPath();
      ctx.arc(ox, oy, 1.6 + depthAlpha * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  } else if (isTalking) {
    // Dynamic 4-bar equalizer wave
    ctx.save();
    ctx.fillStyle = '#22d3ee';
    for (let i = 0; i < 4; i++) {
      const barH = 2.5 + Math.abs(Math.sin(t * 11 + i * 1.15)) * 6;
      ctx.beginPath();
      ctx.roundRect(sx - 6.5 + i * 3.8, cueY + 4 - barH, 2.2, barH, 1);
      ctx.fill();
    }
    ctx.restore();
  } else if (isCelebrating) {
    ctx.save();
    ctx.fillStyle = '#fde68a';
    const starY = cueY - 2 - Math.abs(Math.sin(t * 7)) * 3;
    ctx.beginPath();
    ctx.moveTo(sx, starY - 4);
    ctx.lineTo(sx + 1.4, starY - 1.4);
    ctx.lineTo(sx + 4, starY);
    ctx.lineTo(sx + 1.4, starY + 1.4);
    ctx.lineTo(sx, starY + 4);
    ctx.lineTo(sx - 1.4, starY + 1.4);
    ctx.lineTo(sx - 4, starY);
    ctx.lineTo(sx - 1.4, starY - 1.4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Amber alert `!` halo when carrying a stuck task
  if (hasStuckTask && !isOffline) {
    const alertX = isWorking || isThinking || isTalking ? sx + 15 : sx;
    const alertY = isWorking || isThinking || isTalking ? baseY - 37 : cueY;
    const pulse = 0.5 + 0.5 * Math.sin(t * 7);
    ctx.save();
    ctx.fillStyle = `rgba(245, 158, 11, ${0.22 + pulse * 0.25})`;
    ctx.beginPath();
    ctx.arc(alertX, alertY, 7.5 + pulse * 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.arc(alertX, alertY, 5.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0f172a';
    ctx.font = '800 8.5px "Inter", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('!', alertX, alertY + 0.5);
    ctx.restore();
  }

  // 8. Nameplate Pill, Status Dot, Role Sub-tag & brainMode Badge
  ctx.font = '600 10px "Inter", sans-serif';
  const labelText = agent.name;
  const textW = ctx.measureText(labelText).width;
  const pillW = textW + 18;
  const pillX = sx - pillW / 2;
  const pillY = baseY + 8;

  ctx.fillStyle = isSelected ? 'rgba(245, 158, 11, 0.94)' : 'rgba(15, 23, 42, 0.90)';
  ctx.beginPath();
  ctx.roundRect(pillX, pillY, pillW, 16, 5);
  ctx.fill();
  ctx.strokeStyle = isSelected
    ? '#fde68a'
    : isHovered
      ? 'rgba(226, 232, 240, 0.65)'
      : 'rgba(148, 163, 184, 0.34)';
  ctx.lineWidth = 1;
  ctx.stroke();

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

  // Role sub-tag
  const shortRole = agent.role.length > 26 ? `${agent.role.slice(0, 24)}..` : agent.role;
  ctx.font = '500 8px "JetBrains Mono", monospace';
  const roleW = ctx.measureText(shortRole).width + 10;
  ctx.fillStyle = 'rgba(2, 6, 23, 0.76)';
  ctx.beginPath();
  ctx.roundRect(sx - roleW / 2, pillY + 17.5, roleW, 11.5, 3);
  ctx.fill();
  ctx.fillStyle = isOffline ? '#64748b' : '#94a3b8';
  ctx.textAlign = 'center';
  ctx.fillText(shortRole, sx, pillY + 23.5);

  // brainMode badge (`Tanpa otak` on fallback bots, cyan on muse-langsung, slate for others)
  if (agent.brainMode) {
    const isFallback = agent.brainMode === 'fallback';
    const brainTag = isFallback ? 'Tanpa otak' : agent.brainMode;
    ctx.font = '600 7.5px "JetBrains Mono", monospace';
    const brainW = ctx.measureText(brainTag).width + 10;
    ctx.fillStyle = isFallback
      ? 'rgba(225, 29, 72, 0.92)'
      : agent.brainMode === 'muse-langsung'
        ? 'rgba(8, 145, 178, 0.88)'
        : 'rgba(15, 23, 42, 0.88)';
    ctx.beginPath();
    ctx.roundRect(sx - brainW / 2, pillY + 30.5, brainW, 10.5, 3);
    ctx.fill();
    ctx.fillStyle = isFallback ? '#ffe4e6' : agent.brainMode === 'muse-langsung' ? '#ecfeff' : '#bae6fd';
    ctx.fillText(brainTag, sx, pillY + 35.8);
  }

  ctx.restore();
}

export function drawEnhancedSpeechBubble(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  text: string,
  kind: 'chat' | 'command' | 'report' | 'error'
): void {
  ctx.save();
  ctx.font = '500 10.5px "Inter", sans-serif';

  const cleanText = (text || '...').replace(/\s+/g, ' ').trim() || '...';
  const maxLineWidth = 172;
  const maxLines = 3;
  const words = cleanText.split(' ');
  const lines: string[] = [];
  let line = '';
  let truncated = false;

  for (let i = 0; i < words.length; i++) {
    let word = words[i];
    // Break overly long unbroken tokens safely
    if (!line && ctx.measureText(word).width > maxLineWidth) {
      while (word.length > 4 && ctx.measureText(`${word}…`).width > maxLineWidth) {
        word = word.slice(0, -1);
      }
      word = `${word}…`;
    }
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxLineWidth && line) {
      lines.push(line);
      if (lines.length >= maxLines) {
        truncated = true;
        line = '';
        break;
      }
      line = word;
    } else {
      line = next;
    }
  }
  if (line && lines.length < maxLines) {
    lines.push(line);
  } else if (line) {
    truncated = true;
  }

  if (truncated && lines.length > 0) {
    let last = lines[lines.length - 1];
    while (last.length > 2 && ctx.measureText(`${last}…`).width > maxLineWidth) {
      last = last.slice(0, -1);
    }
    lines[lines.length - 1] = last.endsWith('…') ? last : `${last}…`;
  }
  if (lines.length === 0) lines.push('...');

  const lineHeight = 14;
  const textMaxW = Math.max(...lines.map((l) => ctx.measureText(l).width), 42);
  const padLeft = 20; // Room for indicator dot
  const padRight = 10;
  const padY = 7;
  const boxW = textMaxW + padLeft + padRight;
  const boxH = lines.length * lineHeight + padY * 2 - 2;
  const r = 8;
  const bx = sx - boxW / 2;
  const by = sy - 64 - boxH;

  const palette =
    kind === 'command'
      ? { border: 'rgba(245, 158, 11, 0.85)', dot: '#fbbf24', tint: 'rgba(245, 158, 11, 0.12)' }
      : kind === 'report'
        ? { border: 'rgba(16, 185, 129, 0.85)', dot: '#34d399', tint: 'rgba(16, 185, 129, 0.12)' }
        : kind === 'error'
          ? { border: 'rgba(239, 68, 68, 0.9)', dot: '#f87171', tint: 'rgba(239, 68, 68, 0.14)' }
          : { border: 'rgba(56, 189, 248, 0.85)', dot: '#22d3ee', tint: 'rgba(56, 189, 248, 0.12)' };

  const traceBubblePath = (offsetY = 0) => {
    const top = by + offsetY;
    const bottom = top + boxH;
    const right = bx + boxW;
    ctx.beginPath();
    ctx.moveTo(bx + r, top);
    ctx.lineTo(right - r, top);
    ctx.quadraticCurveTo(right, top, right, top + r);
    ctx.lineTo(right, bottom - r);
    ctx.quadraticCurveTo(right, bottom, right - r, bottom);
    ctx.lineTo(sx + 5.5, bottom);
    ctx.lineTo(sx, bottom + 6.5);
    ctx.lineTo(sx - 5.5, bottom);
    ctx.lineTo(bx + r, bottom);
    ctx.quadraticCurveTo(bx, bottom, bx, bottom - r);
    ctx.lineTo(bx, top + r);
    ctx.quadraticCurveTo(bx, top, bx + r, top);
    ctx.closePath();
  };

  // Soft drop shadow (zero shadowBlur cost)
  traceBubblePath(3);
  ctx.fillStyle = 'rgba(2, 6, 23, 0.42)';
  ctx.fill();

  // Frosted semi-translucent glass body
  traceBubblePath(0);
  const bgGrad = ctx.createLinearGradient(bx, by, bx, by + boxH);
  bgGrad.addColorStop(0, 'rgba(30, 41, 59, 0.92)');
  bgGrad.addColorStop(1, 'rgba(15, 23, 42, 0.94)');
  ctx.fillStyle = bgGrad;
  ctx.fill();

  // Subtle kind tint overlay
  ctx.fillStyle = palette.tint;
  ctx.fill();

  // Crisp accent border
  ctx.strokeStyle = palette.border;
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // Indicator dot + subtle aura
  const dotX = bx + 10.5;
  const dotY = by + padY + 6;
  ctx.fillStyle = palette.dot;
  ctx.globalAlpha = 0.28;
  ctx.beginPath();
  ctx.arc(dotX, dotY, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(dotX, dotY, 2.5, 0, Math.PI * 2);
  ctx.fill();

  // Crisp wrapped lines
  ctx.fillStyle = '#f8fafc';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], bx + padLeft, by + padY + i * lineHeight);
  }

  ctx.restore();
}

export function drawEffectsAndBeams(
  ctx: CanvasRenderingContext2D,
  beams: CommandBeam[],
  currentBotCoords: Map<string, { sx: number; sy: number }>,
  commanderOriginPt: { sx: number; sy: number },
  ripples: FloorRipple[],
  particles: BurstParticle[],
  isoToScreen: (gx: number, gy: number) => { x: number; y: number },
  t: number,
  nowMs: number,
  dt: number
): void {
  const safeDt = Math.min(Math.max(dt, 0), 0.1);

  // 1. Expanding fading FloorRipple shockwaves (pruned in-place)
  let rWrite = 0;
  for (let i = 0; i < ripples.length; i++) {
    const r = ripples[i];
    const age = nowMs - r.startedAt;
    if (age < 0) {
      ripples[rWrite++] = r;
      continue;
    }
    if (age >= r.durationMs) continue;

    const prog = age / r.durationMs;
    const ease = 1 - (1 - prog) * (1 - prog);
    const alpha = (1 - prog) * 0.72;
    const sp = isoToScreen(r.gx, r.gy);
    const rx = 10 + ease * 32;
    const ry = rx * 0.5;

    ctx.save();
    ctx.strokeStyle = r.color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = Math.max(0.8, 2.4 * (1 - prog));
    ctx.beginPath();
    ctx.ellipse(sp.x, sp.y + 2, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();

    if (prog > 0.14) {
      const innerProg = (prog - 0.14) / 0.86;
      const irx = 7 + innerProg * 22;
      ctx.globalAlpha = alpha * 0.42;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.ellipse(sp.x, sp.y + 2, irx, irx * 0.5, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    ripples[rWrite++] = r;
  }
  ripples.length = rWrite;

  // 2. Glowing parabolic CommandBeam arcs with multi-orb trails & badge
  const beamNow = nowMs > 1_000_000_000_000 ? nowMs : Date.now();
  for (const beam of beams) {
    if (beam.expiresAt <= beamNow) continue;
    const toPt = currentBotCoords.get(beam.toAgentId);
    if (!toPt) continue;

    const isCommanderSource =
      beam.fromAgentId === 'user' || beam.fromAgentId === 'system';
    const resolvedFrom = isCommanderSource
      ? commanderOriginPt
      : currentBotCoords.get(beam.fromAgentId) ?? commanderOriginPt;

    const startX = resolvedFrom.sx;
    const startY =
      resolvedFrom === commanderOriginPt ? resolvedFrom.sy : resolvedFrom.sy - 26;
    const endX = toPt.sx;
    const endY = toPt.sy - 26;

    const span = Math.hypot(endX - startX, endY - startY);
    if (span < 3) continue;

    const arcLift = Math.min(92, Math.max(40, span * 0.26));
    const ctrlX = (startX + endX) / 2;
    const ctrlY = Math.min(startY, endY) - arcLift;

    const remaining = beam.expiresAt - beamNow;
    const fadeAlpha = remaining < 400 ? Math.max(0, remaining / 400) : 1;
    const beamColor = beam.color || '#38bdf8';

    ctx.save();

    // Soft outer glow arc
    ctx.strokeStyle = beamColor;
    ctx.globalAlpha = 0.24 * fadeAlpha;
    ctx.lineWidth = 5.5;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.quadraticCurveTo(ctrlX, ctrlY, endX, endY);
    ctx.stroke();

    // Animated dashed inner energy stream
    ctx.globalAlpha = 0.92 * fadeAlpha;
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 5]);
    ctx.lineDashOffset = -t * 42;
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.quadraticCurveTo(ctrlX, ctrlY, endX, endY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Multi-orb comet trail along quadratic curve
    const elapsed = Math.max(0, beamNow - beam.createdAt);
    const headProg = (elapsed % 1150) / 1150;
    for (let k = 3; k >= 0; k--) {
      if (elapsed < k * 55) continue;
      const p = (headProg - k * 0.048 + 1) % 1;
      const u = 1 - p;
      const ox = u * u * startX + 2 * u * p * ctrlX + p * p * endX;
      const oy = u * u * startY + 2 * u * p * ctrlY + p * p * endY;
      const trailFade = (1 - k * 0.24) * fadeAlpha;

      ctx.fillStyle = beamColor;
      ctx.globalAlpha = 0.36 * trailFade;
      ctx.beginPath();
      ctx.arc(ox, oy, 7 - k * 1.1, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = k === 0 ? '#ffffff' : beamColor;
      ctx.globalAlpha = (k === 0 ? 0.98 : 0.72) * trailFade;
      ctx.beginPath();
      ctx.arc(ox, oy, 3.8 - k * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }

    // Receiver endpoint target pulse
    const tipPulse = 3.2 + Math.sin(t * 10) * 0.9;
    ctx.fillStyle = beamColor;
    ctx.globalAlpha = 0.45 * fadeAlpha;
    ctx.beginPath();
    ctx.arc(endX, endY, tipPulse + 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.9 * fadeAlpha;
    ctx.beginPath();
    ctx.arc(endX, endY, 2.2, 0, Math.PI * 2);
    ctx.fill();

    // Readable beam label badge at curve apex
    if (beam.label) {
      const label =
        beam.label.length > 26 ? `${beam.label.slice(0, 24)}..` : beam.label;
      ctx.globalAlpha = fadeAlpha;
      ctx.font = '600 9px "JetBrains Mono", monospace';
      const tagW = ctx.measureText(label).width + 14;
      const apexY = 0.25 * startY + 0.5 * ctrlY + 0.25 * endY;

      ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
      ctx.beginPath();
      ctx.roundRect(ctrlX - tagW / 2, apexY - 17, tagW, 17, 5);
      ctx.fill();
      ctx.strokeStyle = beamColor;
      ctx.lineWidth = 1.1;
      ctx.stroke();

      ctx.fillStyle = '#f8fafc';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, ctrlX, apexY - 8.5);
    }

    ctx.restore();
  }

  // 3. BurstParticle sparks/confetti (updated & pruned in-place)
  let pWrite = 0;
  for (let i = 0; i < particles.length; i++) {
    const p = particles[i];
    p.life -= safeDt;
    if (p.life <= 0) continue;

    p.vx *= Math.pow(0.28, safeDt);
    p.vy += 88 * safeDt;
    p.x += p.vx * safeDt;
    p.y += p.vy * safeDt;

    const ratio = Math.min(1, Math.max(0, p.life / (p.maxLife || 0.5)));
    const radius = Math.max(0.8, p.size * (0.45 + 0.55 * ratio));

    ctx.save();
    ctx.globalAlpha = ratio;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill();

    if (radius >= 1.6) {
      ctx.fillStyle = '#ffffff';
      ctx.globalAlpha = ratio * 0.72;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    particles[pWrite++] = p;
  }
  particles.length = pWrite;
}
