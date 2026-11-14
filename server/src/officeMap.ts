import { GridPoint, ZoneId } from './types.js';

export interface ZoneDefinition {
  id: ZoneId;
  label: string;
  shortLabel: string;
  accent: string;
  bounds: { x: number; y: number; w: number; h: number };
  workSpots: GridPoint[];
}

export const MAP_WIDTH = 20;
export const MAP_HEIGHT = 14;

export const OFFICE_ZONES: Record<ZoneId, ZoneDefinition> = {
  'command-desk': {
    id: 'command-desk',
    label: 'Command Desk',
    shortLabel: 'CMD',
    accent: '#f59e0b',
    bounds: { x: 1, y: 1, w: 5, h: 4 },
    workSpots: [
      { x: 3, y: 3 },
      { x: 2, y: 3 },
      { x: 4, y: 3 },
      { x: 2.3, y: 4.1 },
      { x: 4.2, y: 4.1 },
    ],
  },
  'research-library': {
    id: 'research-library',
    label: 'Research Library',
    shortLabel: 'RSC',
    accent: '#06b6d4',
    bounds: { x: 7, y: 1, w: 6, h: 4 },
    workSpots: [
      { x: 11, y: 3 },
      { x: 9, y: 3 },
      { x: 8, y: 3 },
      { x: 10, y: 4 },
    ],
  },
  'engineering-bay': {
    id: 'engineering-bay',
    label: 'Engineering Bay',
    shortLabel: 'ENG',
    accent: '#10b981',
    bounds: { x: 14, y: 1, w: 5, h: 5 },
    workSpots: [
      { x: 15, y: 3 },
      { x: 16.4, y: 3.4 },
      { x: 17.5, y: 4.2 },
      { x: 15.2, y: 4.6 },
    ],
  },
  'war-room': {
    id: 'war-room',
    label: 'War Room',
    shortLabel: 'WAR',
    accent: '#8b5cf6',
    bounds: { x: 7, y: 5, w: 6, h: 4 },
    workSpots: [
      { x: 8, y: 5.2 },
      { x: 11.4, y: 5.2 },
      { x: 7.5, y: 7.1 },
      { x: 12.2, y: 7.1 },
      { x: 8.3, y: 8.8 },
      { x: 11.6, y: 8.8 },
    ],
  },
  'creative-studio': {
    id: 'creative-studio',
    label: 'Creative Studio',
    shortLabel: 'CRT',
    accent: '#ec4899',
    bounds: { x: 1, y: 6, w: 5, h: 5 },
    workSpots: [
      { x: 3, y: 8 },
      { x: 2, y: 9 },
      { x: 4, y: 8.6 },
      { x: 2.2, y: 7.5 },
    ],
  },
  'qa-bench': {
    id: 'qa-bench',
    label: 'QA & Bridge Lab',
    shortLabel: 'QA',
    accent: '#3b82f6',
    bounds: { x: 14, y: 7, w: 5, h: 4 },
    workSpots: [
      { x: 17, y: 8 },
      { x: 16, y: 9 },
      { x: 15, y: 9 },
      { x: 17.8, y: 9.4 },
      { x: 14.8, y: 7.8 },
      { x: 16, y: 10 },
    ],
  },
  'coffee-lounge': {
    id: 'coffee-lounge',
    label: 'Coffee Lounge',
    shortLabel: 'COF',
    accent: '#f97316',
    bounds: { x: 7, y: 10, w: 6, h: 3 },
    workSpots: [
      { x: 8, y: 11 },
      { x: 10, y: 11 },
      { x: 11, y: 11 },
      { x: 9, y: 12 },
      { x: 11.5, y: 12 },
    ],
  },
};

export const VALID_ZONES: ZoneId[] = Object.keys(OFFICE_ZONES) as ZoneId[];

const LEGACY_ZONE_ALIASES: Record<string, ZoneId> = {
  'research-nook': 'research-library',
  'dev-bay': 'engineering-bay',
  'meeting-table': 'war-room',
  lounge: 'coffee-lounge',
};

export function normalizeZoneId(raw: unknown): ZoneId | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim() as ZoneId;
  if (trimmed in OFFICE_ZONES) return trimmed;
  return LEGACY_ZONE_ALIASES[trimmed] ?? null;
}

export function pickSpotInZone(
  zone: ZoneId,
  seedIndex = 0,
  occupiedPositions: GridPoint[] = []
): GridPoint {
  const def = OFFICE_ZONES[zone] ?? OFFICE_ZONES['coffee-lounge'];
  const spots = def.workSpots;

  if (occupiedPositions.length > 0) {
    const free = spots.find(
      (s) =>
        !occupiedPositions.some(
          (occ) => Math.abs(occ.x - s.x) < 0.45 && Math.abs(occ.y - s.y) < 0.45
        )
    );
    if (free) return { ...free };
  }

  return { ...spots[Math.abs(seedIndex) % spots.length] };
}
