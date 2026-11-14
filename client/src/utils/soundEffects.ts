export type UiSoundCue = 'command' | 'delegate' | 'complete' | 'error' | 'click';

const SOUND_STORAGE_KEY = 'musehq_sound_enabled';

let audioCtx: AudioContext | null = null;
let hasUserGesture = false;
let listenersRegistered = false;
const lastCueAt: Partial<Record<UiSoundCue, number>> = {};

function getAudioContextConstructor(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  const win = window as unknown as {
    AudioContext?: typeof AudioContext;
    webkitAudioContext?: typeof AudioContext;
  };
  return win.AudioContext || win.webkitAudioContext || null;
}

function registerGestureUnlockListeners(): void {
  if (listenersRegistered || typeof window === 'undefined') return;
  listenersRegistered = true;

  const markGesture = () => {
    hasUserGesture = true;
    if (audioCtx && audioCtx.state === 'suspended') {
      try {
        void audioCtx.resume();
      } catch {
        // Ignore restricted audio environments
      }
    }
  };

  try {
    window.addEventListener('pointerdown', markGesture, { capture: true, passive: true });
    window.addEventListener('keydown', markGesture, { capture: true, passive: true });
  } catch {
    // Ignore non-DOM environments
  }
}

registerGestureUnlockListeners();

function userActivationPresent(): boolean {
  if (hasUserGesture) return true;
  if (typeof navigator !== 'undefined') {
    const nav = navigator as unknown as { userActivation?: { hasBeenActive?: boolean } };
    if (nav.userActivation?.hasBeenActive) {
      hasUserGesture = true;
      return true;
    }
  }
  return false;
}

export function isSoundEnabled(): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return true;
    const raw = window.localStorage.getItem(SOUND_STORAGE_KEY);
    return raw !== 'false';
  } catch {
    return true;
  }
}

export function unlockAudioContext(): AudioContext | null {
  try {
    const Ctor = getAudioContextConstructor();
    if (!Ctor) return null;
    if (!audioCtx) {
      audioCtx = new Ctor();
    }
    if (audioCtx.state === 'suspended') {
      void audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  } catch {
    return null;
  }
}

export function setSoundEnabled(enabled: boolean): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(SOUND_STORAGE_KEY, enabled ? 'true' : 'false');
    }
  } catch {
    // Ignore storage quota / private mode failures
  }
  if (enabled) {
    hasUserGesture = true;
    unlockAudioContext();
  }
}

export function toggleSoundEnabled(): boolean {
  const next = !isSoundEnabled();
  setSoundEnabled(next);
  if (next) {
    playUiCue('click');
  }
  return next;
}

function scheduleTone(
  ctx: AudioContext,
  freq: number,
  startOffsetSec: number,
  durationSec: number,
  peakGain: number,
  wave: OscillatorType = 'sine',
  endFreq?: number
): void {
  const startAt = ctx.currentTime + startOffsetSec;
  const endAt = startAt + durationSec;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = wave;
  osc.frequency.setValueAtTime(freq, startAt);
  if (endFreq && endFreq > 0) {
    osc.frequency.exponentialRampToValueAtTime(endFreq, endAt);
  }

  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.linearRampToValueAtTime(peakGain, startAt + Math.min(0.015, durationSec * 0.25));
  gain.gain.exponentialRampToValueAtTime(0.0001, endAt);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(startAt);
  osc.stop(endAt + 0.02);
}

export function playUiCue(type: UiSoundCue): void {
  try {
    if (!isSoundEnabled()) return;
    if (!userActivationPresent()) return;

    const nowMs = Date.now();
    const minIntervalMs = type === 'click' ? 40 : 140;
    const prevAt = lastCueAt[type] || 0;
    if (nowMs - prevAt < minIntervalMs) return;
    lastCueAt[type] = nowMs;

    const ctx = unlockAudioContext();
    if (!ctx) return;

    switch (type) {
      case 'click':
        scheduleTone(ctx, 760, 0, 0.048, 0.02, 'triangle', 920);
        break;
      case 'command':
        scheduleTone(ctx, 523.25, 0, 0.14, 0.032, 'sine');
        scheduleTone(ctx, 783.99, 0.055, 0.19, 0.028, 'sine');
        break;
      case 'delegate':
        scheduleTone(ctx, 659.25, 0, 0.13, 0.024, 'sine');
        scheduleTone(ctx, 987.77, 0.05, 0.16, 0.02, 'triangle');
        break;
      case 'complete':
        scheduleTone(ctx, 523.25, 0, 0.18, 0.026, 'sine');
        scheduleTone(ctx, 659.25, 0.055, 0.2, 0.026, 'sine');
        scheduleTone(ctx, 783.99, 0.11, 0.24, 0.028, 'sine');
        scheduleTone(ctx, 1046.5, 0.165, 0.28, 0.02, 'sine');
        break;
      case 'error':
        scheduleTone(ctx, 246.94, 0, 0.13, 0.028, 'triangle', 220);
        scheduleTone(ctx, 185.0, 0.085, 0.18, 0.028, 'triangle', 164.81);
        break;
    }
  } catch {
    // Never let audio API issues disrupt UI flow
  }
}
