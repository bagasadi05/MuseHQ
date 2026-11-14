import { Agent, LLMProvider, RuntimeSettings } from '../types.js';

export interface SanitizeTextOptions {
  singleLine?: boolean;
  stripMarkdown?: boolean;
}

const KNOWN_SYSTEM_TAG_RE =
  /(?:^[ \t]*|[ \t]+)\[(?:Order langsung|Bot Delegation|Direct Order|Direct Command|Perintah langsung|System|Info|Delegasi|Task|Urgent|Report|Laporan|Alert|Warning)\](?!\()(?!:)[ \t]*/gim;
const GENERIC_LEADING_TAG_RE = /^[ \t]*\[(?!\s*\])(?!x\])([^\]\n]{1,64})\](?!\()(?!:)[ \t]*/i;
const BOX_DIVIDER_ONLY_RE = /^[ \t]*[\u2500-\u257F]+(?:[ \t]*[\u2500-\u257F]+)*[ \t]*$/;
const BOX_TREE_PREFIX_RE =
  /^([ \t]*)(?:[\u2502\u2503][ \t]*)*[\u251C-\u2523\u2514-\u251B][\u2500-\u257F \t]*(?=\S)/;
const LEADING_SYMBOL_BULLET_RE =
  /^([ \t]*)[\u2022\u2023\u2043\u2219\u25AA\u25AB\u25B8\u25B9\u25BA\u25C6\u25C7\u25CB\u25CF\u25E6\u2605\u2606\u2713\u2714\u2717\u2718\u2794\u279C\u27A4\u2192\u21D2]+[ \t]+/;
const DECORATIVE_SYMBOLS_RE =
  /(?:[#*0-9]\uFE0F?\u20E3|[\uFE00-\uFE0F\u200B-\u200D]|[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]|[\u2022\u2023\u2043\u2219\u2500-\u25FF\u2600-\u27BF\u2B00-\u2BFF])/gu;

const CLEAN_OUTPUT_STYLE_RULE = [
  'Aturan format wajib:',
  '- DILARANG KERAS menggunakan emoji, ikon atau piktograf Unicode, karakter box-drawing (garis kotak/pohon), panah Unicode (ganti panah dengan kata "ke"), serta bullet atau tanda centang dekoratif.',
  '- Tulis dalam Bahasa Indonesia yang bersih, ringkas, dan natural (kecuali user meminta bahasa lain).',
  '- Untuk laporan atau penjelasan terstruktur, gunakan Markdown standar yang rapi (###, -, **, atau tabel GFM bila relevan).',
].join('\n');

function stripMarkdownTokens(text: string): string {
  return text
    .replace(/```[a-zA-Z0-9_-]*\n?/g, '')
    .replace(/```/g, '')
    .replace(/^[ \t]*\|?(?:[ \t]*:?-{3,}:?[ \t]*\|)+[ \t]*(?::?-{3,}:?[ \t]*)?$/gm, '')
    .replace(/^[ \t]*\|(.*)\|[ \t]*$/gm, (_m, inner: string) =>
      inner
        .split('|')
        .map((c) => c.trim())
        .filter(Boolean)
        .join(', ')
    )
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*>[ \t]?/gm, '')
    .replace(/^[ \t]*-[ \t]+\[[ xX]\][ \t]+/gm, '- ')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/(?<![A-Za-z0-9_])__([^_\n]+)__(?![A-Za-z0-9_])/g, '$1')
    .replace(/~~([^~\n]+)~~/g, '$1')
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '$1')
    .replace(/(?<![A-Za-z0-9_])_([^_\n]+)_(?![A-Za-z0-9_])/g, '$1')
    .replace(/\*\*/g, '');
}

/**
 * Removes decorative Unicode icons/emojis/box-drawing/arrows and noisy bracket tags
 * while preserving em-dash, en-dash, standard punctuation, and valid Markdown.
 */
export function sanitizeCleanText(input: string, opts: SanitizeTextOptions = {}): string {
  if (typeof input !== 'string') return '';
  let text = input.replace(/\r\n?/g, '\n');

  text = text.replace(KNOWN_SYSTEM_TAG_RE, (_m, offset: number, full: string) =>
    offset === 0 || full[offset - 1] === '\n' ? '' : ' '
  );

  const cleanedLines = text.split('\n').map((rawLine) => {
    let line = rawLine;
    if (BOX_DIVIDER_ONLY_RE.test(line)) return '';

    const treeMatch = line.match(BOX_TREE_PREFIX_RE);
    if (treeMatch) {
      const hasVerticalPipe = /^[\u2502\u2503]/.test(line.trimStart());
      const indent = treeMatch[1].length > 0 || hasVerticalPipe ? '  ' : '';
      line = `${indent}- ${line.slice(treeMatch[0].length)}`;
    } else {
      line = line.replace(LEADING_SYMBOL_BULLET_RE, '$1- ');
    }

    // Replace Unicode arrows cleanly in prose
    line = line
      .replace(/(\S)[ \t]*[\u2192\u21D2\u2794\u279C-\u279F\u27A1\u27A4][ \t]*(\S)/g, '$1 ke $2')
      .replace(/(\S)[ \t]*[\u2194\u21D4][ \t]*(\S)/g, '$1 dan $2')
      .replace(/(\S)[ \t]*[\u2190\u21D0][ \t]*(\S)/g, '$1 dari $2')
      .replace(/[\u2190-\u21FF]/g, ' ');

    // Remove decorative symbols, emojis, pictographs, dingbats, and remaining box-drawing chars
    line = line
      .replace(/^[ \t]*(?:[#*0-9]\uFE0F?\u20E3|[\p{Extended_Pictographic}\u2022\u2023\u2043\u2219\u2500-\u25FF\u2600-\u27BF\u2B00-\u2BFF\uFE00-\uFE0F\u200B-\u200D])+[ \t]*/gu, '')
      .replace(DECORATIVE_SYMBOLS_RE, ' ');

    // Collapse multi-spaces inside text while preserving leading list indentation
    line = line.replace(/(\S)[ \t]{2,}/g, '$1 ').replace(/[ \t]+([.,;:!?])/g, '$1').replace(/[ \t]+$/g, '');
    return line;
  });

  text = cleanedLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  if (opts.stripMarkdown) {
    text = stripMarkdownTokens(text);
  }
  if (opts.singleLine) {
    text = text.replace(/\n+/g, ' ').replace(/[ \t]{2,}/g, ' ').trim();
  }
  return text;
}

export function sanitizeSpeechText(input: string): string {
  const cleaned = sanitizeCleanText(input, { singleLine: true, stripMarkdown: true })
    .replace(GENERIC_LEADING_TAG_RE, '')
    .trim();
  return cleaned;
}

export function sanitizeTitleText(input: string): string {
  const cleaned = sanitizeCleanText(input, { singleLine: true, stripMarkdown: true })
    .replace(GENERIC_LEADING_TAG_RE, '')
    .trim();
  return cleaned;
}

export interface DelegationProposal {
  toAgentId: string;
  title: string;
  instructions: string;
  dependsOnIndex?: number[];
}

export interface LeadPlanResult {
  thought: string;
  speech: string;
  delegations: DelegationProposal[];
  directAnswer?: string;
}

export interface WorkerExecutionResult {
  speech: string;
  result: string;
  subDelegations?: DelegationProposal[];
}

export class MissingProviderKeyError extends Error {
  constructor(public readonly provider: LLMProvider) {
    const label =
      provider === 'gemini'
        ? 'Google Gemini'
        : provider === 'openai'
          ? 'OpenAI'
          : 'Anthropic Claude';
    super(
      `API Key untuk ${label} belum diisi. Buka menu "API Keys" di header atau atur di file .env.`
    );
    this.name = 'MissingProviderKeyError';
  }
}

export interface ResolvedProviderConfig {
  provider: LLMProvider;
  model: string;
  apiKey: string;
}

export function resolveProviderConfig(
  agent: Agent,
  settings: RuntimeSettings
): ResolvedProviderConfig | null {
  const chosen: LLMProvider = agent.provider || settings.defaultProvider || 'gemini';

  if (chosen === 'gemini' && settings.geminiApiKey) {
    return {
      provider: 'gemini',
      model: agent.model || settings.geminiModel || 'gemini-2.5-flash',
      apiKey: settings.geminiApiKey,
    };
  }
  if (chosen === 'openai' && settings.openaiApiKey) {
    return {
      provider: 'openai',
      model: agent.model || settings.openaiModel || 'gpt-4o-mini',
      apiKey: settings.openaiApiKey,
    };
  }
  if (chosen === 'anthropic' && settings.anthropicApiKey) {
    return {
      provider: 'anthropic',
      model: agent.model || settings.anthropicModel || 'claude-sonnet-4-5',
      apiKey: settings.anthropicApiKey,
    };
  }
  return null;
}

function requireProviderConfig(agent: Agent, settings: RuntimeSettings): ResolvedProviderConfig {
  const cfg = resolveProviderConfig(agent, settings);
  if (!cfg) {
    const chosen: LLMProvider = agent.provider || settings.defaultProvider || 'gemini';
    throw new MissingProviderKeyError(chosen);
  }
  return cfg;
}

async function callCloudText(
  provider: LLMProvider,
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  jsonMode: boolean
): Promise<string> {
  if (provider === 'gemini') {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: jsonMode
          ? { responseMimeType: 'application/json', temperature: 0.4 }
          : { temperature: 0.6 },
      }),
    });
    if (!res.ok) {
      throw new Error(`Gemini API ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  if (provider === 'openai') {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({
        model,
        temperature: jsonMode ? 0.3 : 0.6,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
    if (!res.ok) {
      throw new Error(`OpenAI API ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content || '';
  }

  // Anthropic Claude
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    signal: AbortSignal.timeout(45_000),
    body: JSON.stringify({
      model,
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!res.ok) {
    throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  return data.content?.find((c) => c.type === 'text')?.text || '';
}

function extractJsonObject<T>(raw: string): T | null {
  const cleaned = raw.trim();
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : cleaned;
  try {
    return JSON.parse(candidate) as T;
  } catch {
    const match = candidate.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as T;
    } catch {
      return null;
    }
  }
}

export async function generateCoordinatorPlan(
  lead: Agent,
  prompt: string,
  roster: Agent[],
  settings: RuntimeSettings
): Promise<LeadPlanResult> {
  const resolved = requireProviderConfig(lead, settings);

  const availablePeers = roster
    .filter((a) => a.id !== lead.id && a.status !== 'offline')
    .map((a) => `- id: "${a.id}", name: "${a.name}", role: "${a.role}", expertise: "${a.description}"`)
    .join('\n');

  const systemPrompt = `${lead.systemPrompt}
Kamu bekerja di dalam MuseHQ Virtual Office bersama tim bot berikut:
${availablePeers || '(Belum ada rekan tim aktif lain)'}

${CLEAN_OUTPUT_STYLE_RULE}

Balas HANYA dalam JSON valid dengan skema berikut:
{
  "thought": "penjelasan singkat strategi pembagian tugas tanpa emoji atau simbol dekoratif",
  "speech": "kalimat pendek <= 80 karakter untuk speech bubble tanpa emoji atau Markdown",
  "delegations": [
    {
      "toAgentId": "id_bot_penerima",
      "title": "Judul singkat tugas yang bersih dan jelas",
      "instructions": "Instruksi spesifik dalam Bahasa Indonesia dan Markdown rapi untuk bot tersebut",
      "dependsOnIndex": [0]
    }
  ],
  "directAnswer": "isi dalam Markdown rapi (###, -, **) hanya jika tidak ada delegasi yang perlu dibuat"
}
Gunakan bahasa yang sama dengan prompt user (utamakan Bahasa Indonesia yang ringkas dan jelas).`;

  const raw = await callCloudText(
    resolved.provider,
    resolved.apiKey,
    resolved.model,
    systemPrompt,
    `Perintah User:\n${prompt}`,
    true
  );
  const parsed = extractJsonObject<LeadPlanResult>(raw);
  if (parsed && Array.isArray(parsed.delegations)) {
    const validIds = new Set(
      roster.filter((a) => a.id !== lead.id && a.status !== 'offline').map((a) => a.id)
    );
    const indexMap = new Map<number, number>();
    const kept: DelegationProposal[] = [];
    parsed.delegations.forEach((d, oldIdx) => {
      if (d && typeof d.toAgentId === 'string' && validIds.has(d.toAgentId)) {
        indexMap.set(oldIdx, kept.length);
        kept.push(d);
      }
    });
    const cleanDelegations = kept.map((d, newIdx) => ({
      ...d,
      title: sanitizeTitleText(d.title) || 'Tugas Tim',
      instructions: sanitizeCleanText(d.instructions) || 'Kerjakan tugas sesuai arahan misi.',
      dependsOnIndex: Array.isArray(d.dependsOnIndex)
        ? d.dependsOnIndex
            .map((oldDep) => indexMap.get(oldDep))
            .filter((mapped): mapped is number => mapped !== undefined && mapped !== newIdx)
        : [],
    }));
    const cleanDirectAnswer =
      typeof parsed.directAnswer === 'string' && parsed.directAnswer.trim()
        ? sanitizeCleanText(parsed.directAnswer)
        : undefined;
    return {
      thought: sanitizeCleanText(parsed.thought, { singleLine: true }) || 'Rencana tugas disusun.',
      speech: sanitizeSpeechText(parsed.speech) || 'Membagikan tugas ke tim sekarang.',
      delegations: cleanDelegations,
      directAnswer: cleanDirectAnswer,
    };
  }

  if (raw.trim()) {
    return {
      thought: 'Menjawab langsung berdasarkan analisis Cloud LLM.',
      speech: 'Analisis selesai.',
      delegations: [],
      directAnswer: sanitizeCleanText(raw.trim()),
    };
  }

  throw new Error('Model Cloud LLM mengembalikan respons perencanaan kosong.');
}

export async function executeWorkerTask(
  agent: Agent,
  missionPrompt: string,
  taskTitle: string,
  instructions: string,
  dependencyOutputs: Array<{ agentName: string; title: string; result: string }>,
  roster: Agent[],
  allowSubDelegation: boolean,
  settings: RuntimeSettings
): Promise<WorkerExecutionResult> {
  const resolved = requireProviderConfig(agent, settings);
  const depContext = dependencyOutputs
    .map(
      (d) =>
        `### Dari ${sanitizeCleanText(d.agentName, { singleLine: true })} (${sanitizeTitleText(d.title)}):\n${sanitizeCleanText(d.result)}`
    )
    .join('\n\n');

  const peerList = allowSubDelegation
    ? roster
        .filter((a) => a.id !== agent.id && a.status !== 'offline')
        .map((a) => `- id: "${a.id}", name: "${a.name}", role: "${a.role}"`)
        .join('\n')
    : '';

  const systemPrompt = `${agent.systemPrompt}
Peranmu: ${agent.role}.

${CLEAN_OUTPUT_STYLE_RULE}

Balas HANYA dalam JSON valid:
{
  "speech": "kalimat singkat <= 75 karakter untuk speech bubble tanpa emoji atau Markdown",
  "result": "isi lengkap deliverable dalam Bahasa Indonesia yang ringkas dengan format Markdown rapi (###, -, **) dan actionable"${
    allowSubDelegation && peerList
      ? `,
  "subDelegations": [
    { "toAgentId": "...", "title": "...", "instructions": "..." }
  ]`
      : ''
  }
}
Gunakan bahasa yang sama dengan instruksi (utamakan Bahasa Indonesia yang jelas dan mudah dibaca).`;

  const userPrompt = [
    `Misi Utama: ${missionPrompt}`,
    `Tugasmu (${taskTitle}): ${instructions}`,
    depContext ? `Hasil Tugas Pendukung Sebelumnya:\n${depContext}` : '',
    peerList ? `Rekan Bot yang Bisa Dimintai Bantuan Jika Perlu:\n${peerList}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const raw = await callCloudText(
    resolved.provider,
    resolved.apiKey,
    resolved.model,
    systemPrompt,
    userPrompt,
    true
  );
  const parsed = extractJsonObject<WorkerExecutionResult>(raw);
  if (parsed && typeof parsed.result === 'string' && parsed.result.trim()) {
    const cleanSubs = Array.isArray(parsed.subDelegations)
      ? parsed.subDelegations
          .filter((d) => d && typeof d.toAgentId === 'string' && typeof d.instructions === 'string')
          .map((d) => ({
            ...d,
            title: sanitizeTitleText(d.title) || 'Sub-tugas Delegasi',
            instructions: sanitizeCleanText(d.instructions),
          }))
      : undefined;
    return {
      speech: sanitizeSpeechText(parsed.speech) || 'Tugas selesai dikerjakan.',
      result: sanitizeCleanText(parsed.result) || 'Tugas selesai tanpa catatan tambahan.',
      subDelegations: cleanSubs,
    };
  }
  const cleanRaw = sanitizeCleanText(raw);
  if (cleanRaw) {
    return { speech: 'Tugas selesai.', result: cleanRaw };
  }

  throw new Error(`Model Cloud LLM untuk ${agent.name} mengembalikan output kosong.`);
}

export async function synthesizeMissionReport(
  lead: Agent,
  missionPrompt: string,
  deliverables: Array<{ agentName: string; role: string; title: string; result: string }>,
  settings: RuntimeSettings
): Promise<{ speech: string; summary: string }> {
  const cleanPrompt = sanitizeCleanText(missionPrompt, { singleLine: true, stripMarkdown: true });
  const aggregatedSummary = [
    `# Ringkasan Akhir Misi`,
    `**Perintah:** ${cleanPrompt}`,
    '',
    ...deliverables.map((d, i) => {
      const cleanTitle = sanitizeTitleText(d.title) || `Tugas ${i + 1}`;
      const cleanAgent = sanitizeCleanText(d.agentName, { singleLine: true });
      const cleanRole = sanitizeCleanText(d.role, { singleLine: true });
      const cleanResult = sanitizeCleanText(d.result);
      return `### ${i + 1}. ${cleanTitle} — *${cleanAgent} (${cleanRole})*\n${cleanResult}`;
    }),
  ].join('\n');

  if (lead.type !== 'builtin') {
    return {
      speech: 'Hasil pekerjaan tim eksternal telah terkumpul.',
      summary: aggregatedSummary,
    };
  }

  const resolved = resolveProviderConfig(lead, settings);
  if (!resolved) {
    return {
      speech: 'Semua sub-tugas tim selesai.',
      summary: aggregatedSummary,
    };
  }

  const systemPrompt = `${lead.systemPrompt}
Tugasmu sekarang adalah menyusun Ringkasan Eksekutif akhir dalam Markdown berdasarkan hasil kerja seluruh tim. Gabungkan menjadi satu dokumen kohesif, jelas, dan langsung siap dipakai user.
${CLEAN_OUTPUT_STYLE_RULE}`;

  const body = [
    `Misi Utama: ${cleanPrompt}`,
    ...deliverables.map(
      (d) =>
        `## Deliverable: ${sanitizeTitleText(d.title)} (oleh ${sanitizeCleanText(d.agentName, { singleLine: true })} - ${sanitizeCleanText(d.role, { singleLine: true })})\n${sanitizeCleanText(d.result)}`
    ),
  ].join('\n\n---\n\n');

  try {
    const summary = await callCloudText(
      resolved.provider,
      resolved.apiKey,
      resolved.model,
      systemPrompt,
      body,
      false
    );
    const cleanSummary = sanitizeCleanText(summary);
    return {
      speech: 'Misi selesai, laporan akhir siap.',
      summary: cleanSummary || aggregatedSummary,
    };
  } catch {
    return {
      speech: 'Misi selesai dengan rangkuman tim.',
      summary: aggregatedSummary,
    };
  }
}
