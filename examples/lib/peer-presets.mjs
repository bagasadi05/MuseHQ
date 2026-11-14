/** Canonical presets for the four real peer bots in MuseHQ. */
export const PEER_PRESETS = {
  'muse-bagas': {
    id: 'muse-bagas',
    envPrefix: 'MUSE_BAGAS',
    name: 'Muse Bagas',
    role: 'Lead Architect',
    description:
      'Muse AI milik Bagas — mengarahkan solusi sistem, pembagian tugas tim, dan review akhir.',
    homeZone: 'command-desk',
    color: '#f59e0b',
    canDelegate: true,
    aliases: ['bagas', 'muse bagas', 'muse-bagas'],
  },
  'muse-arif': {
    id: 'muse-arif',
    envPrefix: 'MUSE_ARIF',
    name: 'Muse Arif',
    role: 'Research & Strategy',
    description:
      'Muse AI milik Arif — melakukan riset mendalam, analisis kebutuhan, dan perbandingan referensi.',
    homeZone: 'research-library',
    color: '#06b6d4',
    canDelegate: true,
    aliases: ['arif', 'muse arif', 'muse-arif'],
  },
  'muse-niro': {
    id: 'muse-niro',
    envPrefix: 'MUSE_NIRO',
    name: 'Muse Niro',
    role: 'Creative & QA Lead',
    description:
      'Muse AI milik Niro — menyusun konsep UX/copywriting serta memvalidasi kualitas deliverable.',
    homeZone: 'creative-studio',
    color: '#ec4899',
    canDelegate: true,
    aliases: ['niro', 'muse niro', 'muse-niro'],
  },
  'muse-joni': {
    id: 'muse-joni',
    envPrefix: 'MUSE_JONI',
    name: 'Muse Joni',
    role: 'Systems Engineer',
    description:
      'Muse AI milik Joni — merancang backend, integrasi bridge, otomasi, dan implementasi teknis.',
    homeZone: 'engineering-bay',
    color: '#10b981',
    canDelegate: true,
    aliases: ['joni', 'muse joni', 'muse-joni'],
  },
};

export const TEAM_PEER_IDS = ['muse-bagas', 'muse-arif', 'muse-niro', 'muse-joni'];

const ALIAS_TO_ID = new Map();
for (const [id, preset] of Object.entries(PEER_PRESETS)) {
  ALIAS_TO_ID.set(id, id);
  for (const alias of preset.aliases) {
    ALIAS_TO_ID.set(alias.toLowerCase(), id);
  }
}

/** Resolve a peer ID or short name (e.g. "bagas") into its full preset configuration. */
export function resolvePeerPreset(rawIdOrAlias, env) {
  const key = (rawIdOrAlias || '').trim().toLowerCase();
  const matchedId = ALIAS_TO_ID.get(key);
  const base = matchedId ? PEER_PRESETS[matchedId] : null;
  const fallbackId = base?.id || (key || 'muse-external-ops').replace(/[^a-z0-9_-]+/g, '-');
  const envPrefix = base?.envPrefix || fallbackId.toUpperCase().replace(/[^A-Z0-9]+/g, '_');

  const read = (field, defaultVal = '') =>
    env?.get(`${envPrefix}_${field}`) || env?.get(`BOT_${field}`) || defaultVal;

  return {
    id: fallbackId,
    envPrefix,
    name: read('NAME', base?.name || fallbackId),
    role: read('ROLE', base?.role || 'External Muse Specialist'),
    description: read('DESCRIPTION', base?.description || 'External Muse bot connected via Bridge'),
    homeZone: read('HOME_ZONE', base?.homeZone || 'qa-bench'),
    color: read('COLOR', base?.color || '#a855f7'),
    canDelegate: base ? base.canDelegate : true,
  };
}

/** Parse comma-separated peer filter (e.g. "bagas,arif") into deduplicated presets. */
export function resolveTeamPresets(rawFilter, env) {
  const ids = rawFilter
    ? rawFilter
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : TEAM_PEER_IDS;

  const seen = new Set();
  const list = [];
  for (const raw of ids) {
    const preset = resolvePeerPreset(raw, env);
    if (!seen.has(preset.id)) {
      seen.add(preset.id);
      list.push(preset);
    }
  }
  return list;
}
