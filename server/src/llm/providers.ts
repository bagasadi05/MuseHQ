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

function resolveProvider(agent: Agent, settings: RuntimeSettings): {
  provider: LLMProvider;
  model: string;
  apiKey: string;
} {
  const chosen: LLMProvider = agent.provider || settings.defaultProvider || 'demo';

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
  return { provider: 'demo', model: 'muse-demo-sim', apiKey: '' };
}

async function callCloudText(
  provider: Exclude<LLMProvider, 'demo'>,
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
  try {
    return JSON.parse(raw) as T;
  } catch {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as T;
    } catch {
      return null;
    }
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function buildDemoPlan(lead: Agent, prompt: string, roster: Agent[]): LeadPlanResult {
  const subordinates = roster.filter((a) => a.id !== lead.id && a.status !== 'offline');
  if (subordinates.length === 0) {
    return {
      thought: 'Tidak ada bot lain yang online, saya tangani langsung.',
      speech: 'Semua tim sedang offline, saya kerjakan sendiri!',
      delegations: [],
      directAnswer: `### Hasil Langsung oleh ${lead.name}\n\nMisi: **${prompt}**\n\n1. Analisis singkat konteks perintah.\n2. Rencana eksekusi bertahap siap dijalankan.\n3. Tambahkan atau nyalakan bot Muse AI lain agar pembagian tugas otomatis bisa berjalan paralel.`,
    };
  }

  const delegations: DelegationProposal[] = [];
  const scout = subordinates.find((a) => a.avatarVariant === 'researcher');
  const dev = subordinates.find((a) => a.avatarVariant === 'coder');
  const craft = subordinates.find((a) => a.avatarVariant === 'creative');
  const sentinel = subordinates.find((a) => a.avatarVariant === 'qa');
  const extras = subordinates.filter(
    (a) => ![scout?.id, dev?.id, craft?.id, sentinel?.id].includes(a.id)
  );

  if (scout) {
    delegations.push({
      toAgentId: scout.id,
      title: 'Riset Konteks & Kebutuhan Utama',
      instructions: `Analisis misi berikut dan rangkum insight pasar, target pengguna, serta poin kunci eksekusi:\n"${prompt}"`,
      dependsOnIndex: [],
    });
  }

  if (dev) {
    delegations.push({
      toAgentId: dev.id,
      title: 'Arsitektur Teknis & Alur Sistem',
      instructions: `Susun desain teknis, komponen sistem, integrasi API, dan langkah implementasi untuk:\n"${prompt}"`,
      dependsOnIndex: [],
    });
  }

  if (craft) {
    delegations.push({
      toAgentId: craft.id,
      title: 'Konsep Produk, UX & Copywriting',
      instructions: `Rancang narasi, struktur pengalaman pengguna, dan draft konten utama berdasarkan misi:\n"${prompt}"`,
      dependsOnIndex: scout ? [0] : [],
    });
  }

  for (const extra of extras.slice(0, 3)) {
    delegations.push({
      toAgentId: extra.id,
      title: `Kontribusi Spesialis: ${extra.role}`,
      instructions: `Jalankan peranmu (${extra.role}) untuk mendukung misi:\n"${prompt}"`,
      dependsOnIndex: [],
    });
  }

  if (sentinel && delegations.length > 0) {
    const priorIndices = delegations.map((_, idx) => idx);
    delegations.push({
      toAgentId: sentinel.id,
      title: 'Audit Kualitas & Checklist Siap Rilis',
      instructions: `Review seluruh deliverable tim untuk misi "${prompt}", temukan celah atau risiko, dan buat final QA checklist.`,
      dependsOnIndex: priorIndices,
    });
  }

  return {
    thought: `Memecah misi menjadi ${delegations.length} sub-tugas paralel dan berurutan sesuai keahlian ruangan.`,
    speech: `Tim, merapat! Saya bagi ${delegations.length} tugas untuk misi ini.`,
    delegations,
  };
}

function buildDemoWork(agent: Agent, title: string, instructions: string, depContext: string): WorkerExecutionResult {
  const shortTopic = instructions.split('\n').slice(-1)[0]?.replace(/["]/g, '').slice(0, 90) || title;
  const hasDeps = Boolean(depContext.trim());

  switch (agent.avatarVariant) {
    case 'researcher':
      return {
        speech: `Riset "${title}" selesai! Data siap dikirim.`,
        result: [
          `#### Laporan Riset — ${agent.name}`,
          `**Topik:** ${shortTopic}`,
          '',
          '- **Target Utama:** Tim atau kreator yang membutuhkan orkestrasi multi-bot yang mudah dipantau secara visual.',
          '- **Temuan Kunci:** Koordinasi paralel mengurangi waktu pengerjaan hingga 60% saat tugas riset & teknis dipisah sejak awal.',
          '- **Rekomendasi Prioritas:** Mulai dari alur inti (Command -> Delegasi -> Eksekusi -> Review), lalu hubungkan kanal eksternal lewat Webhook/WebSocket.',
        ].join('\n'),
      };
    case 'coder':
      return {
        speech: `Blueprint teknis beres! Siap integrasi.`,
        result: [
          `#### Rancangan Teknis — ${agent.name}`,
          `**Tugas:** ${title}`,
          '',
          '- **Arsitektur Inti:** Event-driven Orchestrator + WebSocket state broadcast (`agent:updated`, `task:updated`, `comms:message`).',
          '- **Konektor Eksternal:** Endpoint REST `POST /api/tasks/:id/complete` dan WebSocket `/ws/bot` untuk bot Python/Node/n8n.',
          '- **Skema Eksekusi:** DAG dependency resolver memastikan tugas dependen otomatis jalan tepat setelah prasyaratnya beres.',
        ].join('\n'),
      };
    case 'creative':
      return {
        speech: `Draft konsep & copywriting beres!`,
        result: [
          `#### Konsep & Copywriting — ${agent.name}`,
          `**Fokus:** ${title}${hasDeps ? ' (diselaraskan dengan hasil riset tim)' : ''}`,
          '',
          '- **Headline Utama:** *"Satu Ruang Kerja, Banyak Otak AI yang Saling Bekerja Sama."*',
          '- **Value Proposition:** Pantau setiap bot Muse AI bergerak, berdiskusi, membagi tugas, dan menyelesaikan proyek langsung di depan mata.',
          '- **Call-to-Action:** Berikan satu perintah di Command Bar, biarkan tim MuseAI mengeksekusi sisanya.',
        ].join('\n'),
      };
    case 'qa':
      return {
        speech: `Audit QA selesai! Semua kriteria lulus cek.`,
        result: [
          `#### Hasil Audit QA — ${agent.name}`,
          `**Cakupan:** Review output ${hasDeps ? 'seluruh sub-tugas sebelumnya' : title}`,
          '',
          '- [x] Konsistensi tujuan antara riset, arsitektur teknis, dan narasi produk terpenuhi.',
          '- [x] Alur fallback aman tersedia jika ada bot eksternal terputus atau API key belum diisi.',
          '- **Catatan Peningkatan:** Pastikan setiap bot baru diberi `systemPrompt` spesifik agar pembagian tugas dari Muse Lead semakin presisi.',
        ].join('\n'),
      };
    default:
      return {
        speech: `Tugas "${title}" beres dikerjakan!`,
        result: [
          `#### Deliverable — ${agent.name} (${agent.role})`,
          `**Tugas:** ${title}`,
          '',
          `- Telah mengeksekusi instruksi: *${shortTopic}*`,
          hasDeps ? '- Menggunakan konteks hasil pekerjaan rekan tim sebelumnya sebagai masukan.' : '- Dikerjakan secara mandiri di workstation.',
          '- Status: Siap digabungkan ke laporan akhir misi.',
        ].join('\n'),
      };
  }
}

export async function generateCoordinatorPlan(
  lead: Agent,
  prompt: string,
  roster: Agent[],
  settings: RuntimeSettings
): Promise<LeadPlanResult> {
  const resolved = resolveProvider(lead, settings);
  if (resolved.provider === 'demo') {
    await delay(1400);
    return buildDemoPlan(lead, prompt, roster);
  }

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

  try {
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
      const validIds = new Set(roster.filter((a) => a.id !== lead.id).map((a) => a.id));
      const cleanDelegations = parsed.delegations.filter((d) => validIds.has(d.toAgentId));
      return {
        thought: parsed.thought || 'Rencana tugas disusun.',
        speech: parsed.speech || 'Membagikan tugas ke tim sekarang!',
        delegations: cleanDelegations,
        directAnswer: parsed.directAnswer,
      };
    }
  } catch (err) {
    console.warn(`Coordinator LLM error (${resolved.provider}), falling back to demo plan:`, err);
  }

  return buildDemoPlan(lead, prompt, roster);
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
  const resolved = resolveProvider(agent, settings);
  const depContext = dependencyOutputs
    .map((d) => `### Dari ${d.agentName} (${d.title}):\n${d.result}`)
    .join('\n\n');

  if (resolved.provider === 'demo') {
    await delay(1700 + Math.floor(Math.random() * 1200));
    return buildDemoWork(agent, taskTitle, instructions, depContext);
  }

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

  try {
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
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      speech: 'Ada kendala API, pakai mode cadangan!',
      result: `> **Catatan:** Koneksi ke ${resolved.provider} gagal (${msg}).\n\n${
        buildDemoWork(agent, taskTitle, instructions, depContext).result
      }`,
    };
  }

  return buildDemoWork(agent, taskTitle, instructions, depContext);
}

export async function synthesizeMissionReport(
  lead: Agent,
  missionPrompt: string,
  deliverables: Array<{ agentName: string; role: string; title: string; result: string }>,
  settings: RuntimeSettings
): Promise<{ speech: string; summary: string }> {
  const resolved = resolveProvider(lead, settings);
  if (resolved.provider === 'demo') {
    await delay(1100);
    return {
      speech: 'Laporan akhir misi sudah siap!',
      summary: [
        `# Ringkasan Akhir Misi`,
        `**Perintah:** ${missionPrompt}`,
        '',
        `Tim Muse AI (${deliverables.length} sub-tugas) telah menyelesaikan koordinasi dan eksekusi:`,
        ...deliverables.map(
          (d, i) =>
            `\n### ${i + 1}. ${d.title} — *${d.agentName} (${d.role})*\n${d.result}`
        ),
      ].join('\n'),
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
      summary: summary.trim() || deliverables.map((d) => d.result).join('\n\n'),
    };
  } catch {
    return {
      speech: 'Misi selesai dengan rangkuman tim!',
      summary: deliverables.map((d) => `### ${d.title} (${d.agentName})\n${d.result}`).join('\n\n'),
    };
  }
}
