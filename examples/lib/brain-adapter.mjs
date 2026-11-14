import { PEER_PRESETS } from './peer-presets.mjs';

const UPSTREAM_TIMEOUT_MS = 45_000;
const LLM_TIMEOUT_MS = 45_000;

function readPeerEnv(peer, env, field, fallback = '') {
  return env?.get(`${peer.envPrefix}_${field}`) || env?.get(field) || fallback;
}

/** Detect active execution engine for a peer without exposing secret values. */
export function resolveBrainConfig(peer, env) {
  const upstreamUrl = readPeerEnv(peer, env, 'UPSTREAM_URL');
  const upstreamToken = readPeerEnv(peer, env, 'UPSTREAM_TOKEN');
  const upstreamFormatRaw = readPeerEnv(peer, env, 'UPSTREAM_FORMAT', 'auto').toLowerCase();
  const upstreamFormat =
    upstreamFormatRaw === 'auto'
      ? upstreamUrl.includes('/chat/completions')
        ? 'openai-chat'
        : 'muse-json'
      : upstreamFormatRaw;

  if (upstreamUrl) {
    return { mode: 'upstream', upstreamUrl, upstreamToken, upstreamFormat };
  }

  const preferred = readPeerEnv(peer, env, 'LLM_PROVIDER').toLowerCase();
  const providers = [
    {
      mode: 'gemini',
      apiKey: readPeerEnv(peer, env, 'GEMINI_API_KEY'),
      model: readPeerEnv(peer, env, 'GEMINI_MODEL', 'gemini-2.5-flash'),
    },
    {
      mode: 'openai',
      apiKey: readPeerEnv(peer, env, 'OPENAI_API_KEY'),
      model: readPeerEnv(peer, env, 'OPENAI_MODEL', 'gpt-4o-mini'),
    },
    {
      mode: 'anthropic',
      apiKey: readPeerEnv(peer, env, 'ANTHROPIC_API_KEY'),
      model: readPeerEnv(peer, env, 'ANTHROPIC_MODEL', 'claude-sonnet-4-5'),
    },
  ];

  const chosen =
    (preferred ? providers.find((p) => p.mode === preferred && p.apiKey) : null) ||
    providers.find((p) => Boolean(p.apiKey));

  if (chosen) {
    return chosen;
  }

  return { mode: 'bridge' };
}

export const NO_BRAIN_FAILURE_MESSAGE =
  'Tidak dikerjakan — bot ini belum punya otak (belum ada API key / upstream / Muse langsung)';

const VALID_BRAIN_MODES = new Set([
  'muse-langsung',
  'gemini',
  'openai',
  'anthropic',
  'upstream',
  'fallback',
]);

/** Returns canonical `brainMode` string for `bot:hello` reporting. */
export function resolveReportedBrainMode(peer, env) {
  const forced = readPeerEnv(peer, env, 'BRAIN_MODE').trim().toLowerCase();
  if (forced && VALID_BRAIN_MODES.has(forced) && forced === 'muse-langsung') {
    return 'muse-langsung';
  }
  const cfg = resolveBrainConfig(peer, env);
  if (cfg.mode === 'bridge') return 'fallback';
  return cfg.mode;
}

export function describeBrainMode(peer, env) {
  const reported = resolveReportedBrainMode(peer, env);
  if (reported === 'fallback') return 'fallback (Tanpa otak — tidak bisa kerja)';
  if (reported === 'muse-langsung') return 'muse-langsung';
  const cfg = resolveBrainConfig(peer, env);
  if (cfg.mode === 'upstream') return `upstream (${cfg.upstreamFormat})`;
  return `${cfg.mode} (${cfg.model})`;
}

async function fetchJson(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const rawText = await res.text();
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${rawText.slice(0, 180)}`);
    }
    try {
      return { json: JSON.parse(rawText), text: rawText };
    } catch {
      return { json: null, text: rawText };
    }
  } finally {
    clearTimeout(timer);
  }
}

function buildSystemInstruction(peer, isTask) {
  const peerList = Object.values(PEER_PRESETS)
    .filter((p) => p.id !== peer.id)
    .map((p) => `${p.id} (${p.name}, ${p.role})`)
    .join('; ');

  if (!isTask) {
    return [
      `Kamu adalah ${peer.name} (ID: ${peer.id}), peran: ${peer.role}, berada di zona ${peer.homeZone}.`,
      peer.description,
      'Jawab chat dengan ramah, ringkas (maksimal 2-3 kalimat) dalam Bahasa Indonesia.',
    ].join('\n');
  }

  return [
    `Kamu adalah ${peer.name} (ID: ${peer.id}), peran: ${peer.role}, zona kantor: ${peer.homeZone}.`,
    peer.description,
    `Rekan satu ruangan: ${peerList}.`,
    'Balas STRICT dengan JSON objek valid tanpa markdown fence:',
    '{"speech":"kalimat singkat status <90 karakter","result":"laporan markdown lengkap & actionable","delegations":[]}',
    'Jika instruksi secara eksplisit meminta melibatkan atau mendelegasikan ke rekan tertentu, isi "delegations" dengan array [{"toAgentId":"muse-...","title":"...","instructions":"..."}], selain itu biarkan [].',
  ].join('\n');
}

function buildUserPrompt({ kind, title, instructions, context, fromName }) {
  if (kind === 'chat') {
    return `Pesan dari ${fromName || 'Pemilik'}:\n${instructions}`;
  }
  return [
    `Tugas: ${title}`,
    `Instruksi:\n${instructions}`,
    context ? `Konteks tugas sebelumnya:\n${context}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function parseJsonOrMarkdown(rawText, defaultSpeech) {
  const cleaned = String(rawText || '')
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === 'object') {
      return {
        speech: typeof parsed.speech === 'string' && parsed.speech.trim() ? parsed.speech.trim() : defaultSpeech,
        result:
          typeof parsed.result === 'string' && parsed.result.trim()
            ? parsed.result.trim()
            : typeof parsed.reply === 'string'
              ? parsed.reply.trim()
              : cleaned,
        delegations: Array.isArray(parsed.delegations) ? parsed.delegations : [],
      };
    }
  } catch {
    // Model returned markdown text instead of JSON; return safely as result
  }

  return {
    speech: defaultSpeech,
    result: cleaned || 'Tugas selesai tanpa keluaran tambahan.',
    delegations: [],
  };
}

function normalizeDelegations(rawList, selfId) {
  if (!Array.isArray(rawList)) return [];
  const validIds = new Set(Object.keys(PEER_PRESETS));
  return rawList
    .filter((d) => d && typeof d.toAgentId === 'string' && typeof d.instructions === 'string')
    .map((d) => ({
      toAgentId: d.toAgentId.trim(),
      title: typeof d.title === 'string' && d.title.trim() ? d.title.trim() : 'Sub-tugas Delegasi',
      instructions: d.instructions.trim(),
    }))
    .filter((d) => d.toAgentId !== selfId && validIds.has(d.toAgentId) && d.instructions.length > 0)
    .slice(0, 3);
}

/** Extract explicit @mentions to peer bots when running without LLM orchestration. */
function extractMentionDelegations(text, selfId) {
  const lower = String(text || '').toLowerCase();
  if (!/(delegasi|minta|oper|teruskan|tolong\s+@)/i.test(lower)) {
    return [];
  }
  const found = [];
  for (const preset of Object.values(PEER_PRESETS)) {
    if (preset.id === selfId) continue;
    const hit = preset.aliases.some((alias) => lower.includes(`@${alias.toLowerCase()}`));
    if (hit) {
      found.push({
        toAgentId: preset.id,
        title: `Tindak lanjut oleh ${preset.name}`,
        instructions: text,
      });
    }
  }
  return found.slice(0, 3);
}

async function callUpstream({ cfg, peer, env, input }) {
  const headers = {
    'Content-Type': 'application/json',
    ...(cfg.upstreamToken
      ? {
          Authorization: `Bearer ${cfg.upstreamToken}`,
          'x-muse-token': cfg.upstreamToken,
        }
      : {}),
  };

  if (cfg.upstreamFormat === 'openai-chat') {
    const body = {
      model: readPeerEnv(peer, env, 'UPSTREAM_MODEL', peer.id) || peer.id,
      messages: [
        { role: 'system', content: buildSystemInstruction(peer, input.kind === 'task') },
        { role: 'user', content: buildUserPrompt(input) },
      ],
      temperature: 0.4,
    };
    const { json, text } = await fetchJson(
      cfg.upstreamUrl,
      { method: 'POST', headers, body: JSON.stringify(body) },
      UPSTREAM_TIMEOUT_MS
    );
    const content = json?.choices?.[0]?.message?.content || text;
    return parseJsonOrMarkdown(content, `Selesai dari ${peer.name} (upstream)!`);
  }

  const webhookBody = {
    event: input.kind === 'task' ? 'task:assigned' : 'comms:message',
    peer: { id: peer.id, name: peer.name, role: peer.role, homeZone: peer.homeZone },
    payload: input,
  };
  const { json, text } = await fetchJson(
    cfg.upstreamUrl,
    { method: 'POST', headers, body: JSON.stringify(webhookBody) },
    UPSTREAM_TIMEOUT_MS
  );
  if (json && typeof json === 'object') {
    const rawResult = json.result ?? json.reply ?? json.text ?? json.output ?? json.message ?? text;
    return {
      speech:
        typeof json.speech === 'string' && json.speech.trim()
          ? json.speech.trim()
          : `${peer.name} selesai memproses!`,
      result: typeof rawResult === 'string' ? rawResult : JSON.stringify(rawResult, null, 2),
      delegations: Array.isArray(json.delegations) ? json.delegations : [],
    };
  }
  return parseJsonOrMarkdown(text, `${peer.name} selesai memproses!`);
}

async function callCloudLlm({ cfg, peer, input }) {
  const system = buildSystemInstruction(peer, input.kind === 'task');
  const user = buildUserPrompt(input);

  if (cfg.mode === 'gemini') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      cfg.model
    )}:generateContent?key=${encodeURIComponent(cfg.apiKey)}`;
    const { json } = await fetchJson(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { temperature: 0.4 },
        }),
      },
      LLM_TIMEOUT_MS
    );
    const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
    return parseJsonOrMarkdown(text, `Selesai dikerjakan ${peer.name}!`);
  }

  if (cfg.mode === 'openai') {
    const { json } = await fetchJson(
      'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cfg.apiKey}`,
        },
        body: JSON.stringify({
          model: cfg.model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature: 0.4,
        }),
      },
      LLM_TIMEOUT_MS
    );
    const text = json?.choices?.[0]?.message?.content || '';
    return parseJsonOrMarkdown(text, `Selesai dikerjakan ${peer.name}!`);
  }

  if (cfg.mode === 'anthropic') {
    const { json } = await fetchJson(
      'https://api.anthropic.com/v1/messages',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': cfg.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: cfg.model,
          max_tokens: 1200,
          system,
          messages: [{ role: 'user', content: user }],
        }),
      },
      LLM_TIMEOUT_MS
    );
    const text = json?.content?.map((c) => c.text || '').join('') || '';
    return parseJsonOrMarkdown(text, `Selesai dikerjakan ${peer.name}!`);
  }

  throw new Error(`Unsupported provider: ${cfg.mode}`);
}

function buildHonestFailure({ peer, reason, modeUsed }) {
  const error = reason || NO_BRAIN_FAILURE_MESSAGE;
  return {
    failed: true,
    error,
    speech: `${peer.name}: ${error.slice(0, 100)}`,
    result: '',
    delegations: [],
    modeUsed: modeUsed || 'fallback',
  };
}

/** Execute a task or chat reply via Upstream endpoint or Cloud LLM; fallback honestly refuses fake work. */
export async function executeForPeer({ peer, env, kind, title, instructions, context, fromName }) {
  const cfg = resolveBrainConfig(peer, env);
  const input = { kind, title, instructions, context, fromName };

  if (cfg.mode === 'bridge') {
    console.warn(`[${peer.id}] Fallback jujur: ${NO_BRAIN_FAILURE_MESSAGE}`);
    return buildHonestFailure({
      peer,
      reason: NO_BRAIN_FAILURE_MESSAGE,
      modeUsed: 'fallback',
    });
  }

  try {
    if (cfg.mode === 'upstream') {
      const out = await callUpstream({ cfg, peer, env, input });
      return {
        failed: false,
        ...out,
        delegations: normalizeDelegations(out.delegations, peer.id),
        modeUsed: cfg.mode,
      };
    }
    const out = await callCloudLlm({ cfg, peer, input });
    return {
      failed: false,
      ...out,
      delegations: normalizeDelegations(out.delegations, peer.id),
      modeUsed: cfg.mode,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(`[${peer.id}] Eksekusi ${cfg.mode} gagal: ${errMsg.slice(0, 140)}`);
    return buildHonestFailure({
      peer,
      reason: `Eksekusi ${cfg.mode} gagal: ${errMsg}`,
      modeUsed: cfg.mode,
    });
  }
}
