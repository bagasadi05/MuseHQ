import { Agent, LLMProvider, RuntimeSettings } from '../types.js';

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

Balas HANYA dalam JSON valid dengan skema berikut:
{
  "thought": "penjelasan singkat strategi pembagian tugas",
  "speech": "kalimat pendek <= 80 karakter untuk speech bubble di ruangan kantor",
  "delegations": [
    {
      "toAgentId": "id_bot_penerima",
      "title": "Judul singkat tugas",
      "instructions": "Instruksi spesifik dan jelas untuk bot tersebut",
      "dependsOnIndex": [0]
    }
  ],
  "directAnswer": "isi hanya jika tidak ada delegasi yang perlu dibuat"
}
Gunakan bahasa yang sama dengan prompt user.`;

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
      dependsOnIndex: Array.isArray(d.dependsOnIndex)
        ? d.dependsOnIndex
            .map((oldDep) => indexMap.get(oldDep))
            .filter((mapped): mapped is number => mapped !== undefined && mapped !== newIdx)
        : [],
    }));
    return {
      thought: parsed.thought || 'Rencana tugas disusun.',
      speech: parsed.speech || 'Membagikan tugas ke tim sekarang!',
      delegations: cleanDelegations,
      directAnswer: parsed.directAnswer,
    };
  }

  if (raw.trim()) {
    return {
      thought: 'Menjawab langsung berdasarkan analisis Cloud LLM.',
      speech: 'Analisis selesai!',
      delegations: [],
      directAnswer: raw.trim(),
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
    .map((d) => `### Dari ${d.agentName} (${d.title}):\n${d.result}`)
    .join('\n\n');

  const peerList = allowSubDelegation
    ? roster
        .filter((a) => a.id !== agent.id && a.status !== 'offline')
        .map((a) => `- id: "${a.id}", name: "${a.name}", role: "${a.role}"`)
        .join('\n')
    : '';

  const systemPrompt = `${agent.systemPrompt}
Peranmu: ${agent.role}.
Balas HANYA dalam JSON valid:
{
  "speech": "kalimat singkat <= 75 karakter untuk speech bubble di meja kerjamu",
  "result": "isi lengkap deliverable dalam format Markdown yang rapi dan actionable"${
    allowSubDelegation && peerList
      ? `,
  "subDelegations": [
    { "toAgentId": "...", "title": "...", "instructions": "..." }
  ]`
      : ''
  }
}
Gunakan bahasa yang sama dengan instruksi.`;

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
    return {
      speech: parsed.speech || 'Tugas selesai dikerjakan!',
      result: parsed.result,
      subDelegations: Array.isArray(parsed.subDelegations) ? parsed.subDelegations : undefined,
    };
  }
  if (raw.trim()) {
    return { speech: 'Tugas selesai!', result: raw.trim() };
  }

  throw new Error(`Model Cloud LLM untuk ${agent.name} mengembalikan output kosong.`);
}

export async function synthesizeMissionReport(
  lead: Agent,
  missionPrompt: string,
  deliverables: Array<{ agentName: string; role: string; title: string; result: string }>,
  settings: RuntimeSettings
): Promise<{ speech: string; summary: string }> {
  const aggregatedSummary = [
    `# Ringkasan Akhir Misi`,
    `**Perintah:** ${missionPrompt}`,
    '',
    ...deliverables.map(
      (d, i) => `### ${i + 1}. ${d.title} — *${d.agentName} (${d.role})*\n${d.result}`
    ),
  ].join('\n');

  if (lead.type !== 'builtin') {
    return {
      speech: 'Hasil pekerjaan tim eksternal telah terkumpul!',
      summary: aggregatedSummary,
    };
  }

  const resolved = resolveProviderConfig(lead, settings);
  if (!resolved) {
    return {
      speech: 'Semua sub-tugas tim selesai!',
      summary: aggregatedSummary,
    };
  }

  const systemPrompt = `${lead.systemPrompt}
Tugasmu sekarang adalah menyusun Ringkasan Eksekutif akhir dalam Markdown berdasarkan hasil kerja seluruh tim. Gabungkan menjadi satu dokumen kohesif, jelas, dan langsung siap dipakai user.`;

  const body = [
    `Misi Utama: ${missionPrompt}`,
    ...deliverables.map((d) => `## Deliverable: ${d.title} (oleh ${d.agentName} - ${d.role})\n${d.result}`),
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
    return {
      speech: 'Misi selesai! Laporan akhir siap.',
      summary: summary.trim() || aggregatedSummary,
    };
  } catch {
    return {
      speech: 'Misi selesai dengan rangkuman tim!',
      summary: aggregatedSummary,
    };
  }
}
