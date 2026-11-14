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
    ],
  },
  'research-nook': {
    id: 'research-nook',
    label: 'Research Library',
    shortLabel: 'RSC',
    accent: '#06b6d4',
    bounds: { x: 7, y: 1, w: 6, h: 4 },
    workSpots: [
      { x: 9, y: 3 },
      { x: 11, y: 3 },
      { x: 8, y: 3 },
    ],
  },
  'dev-bay': {
    id: 'dev-bay',
    label: 'Engineering Bay',
    shortLabel: 'DEV',
    accent: '#10b981',
    bounds: { x: 14, y: 1, w: 5, h: 5 },
    workSpots: [
      { x: 16, y: 3 },
      { x: 17, y: 4 },
      { x: 15, y: 3 },
    ],
  },
  'meeting-table': {
    id: 'meeting-table',
    label: 'War Room / Meeting',
    shortLabel: 'MTG',
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
      { x: 4, y: 8 },
    ],
  },
  'qa-bench': {
    id: 'qa-bench',
    label: 'QA & Bridge Lab',
    shortLabel: 'QA',
    accent: '#3b82f6',
    bounds: { x: 14, y: 7, w: 5, h: 4 },
    workSpots: [
      { x: 16, y: 9 },
      { x: 17, y: 8 },
      { x: 15, y: 9 },
    ],
  },
  lounge: {
    id: 'lounge',
    label: 'Coffee Lounge',
    shortLabel: 'BRK',
    accent: '#f97316',
    bounds: { x: 7, y: 10, w: 6, h: 3 },
    workSpots: [
      { x: 8, y: 11 },
      { x: 10, y: 11 },
      { x: 11, y: 11 },
      { x: 9, y: 12 },
    ],
  },
};

export function pickSpotInZone(zone: ZoneId, seedIndex = 0): GridPoint {
  const def = OFFICE_ZONES[zone] ?? OFFICE_ZONES.lounge;
  const spots = def.workSpots;
  return { ...spots[Math.abs(seedIndex) % spots.length] };
}
