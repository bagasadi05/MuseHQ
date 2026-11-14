import { ExternalBridge } from '../bridge/externalBridge.js';
import { WorkspaceStore } from '../store.js';
import { Agent, Mission, Task } from '../types.js';
import {
  executeWorkerTask,
  generateCoordinatorPlan,
  synthesizeMissionReport,
} from './providers.js';

export class MissionOrchestrator {
  private finalizingMissions = new Set<string>();

  constructor(
    private store: WorkspaceStore,
    private bridge: ExternalBridge
  ) {}

  async startMission(
    prompt: string,
    targetAgentId = 'muse-lead',
    waitForCompletion = false
  ): Promise<Mission> {
    const cleanPrompt = prompt.trim();
    const agents = this.store.getAgents();
    const target =
      this.store.getAgent(targetAgentId) ||
      agents.find((a) => a.canDelegate) ||
      agents[0];

    if (!target) {
      throw new Error('Tidak ada bot Muse AI yang terdaftar di ruangan.');
    }

    const now = new Date().toISOString();
    const mission: Mission = {
      id: `mission-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      prompt: cleanPrompt,
      targetAgentId: target.id,
      status: 'running',
      createdAt: now,
    };

    this.store.addMission(mission);
    this.store.addComms({
      missionId: mission.id,
      fromId: 'user',
      fromName: 'Commander (Owner)',
      toId: target.id,
      toName: target.name,
      kind: 'command',
      content: cleanPrompt,
    });

    if (waitForCompletion) {
      await this.runCoordinatorFlow(mission, target);
    } else {
      // Run asynchronously so HTTP request returns immediately while WebSocket streams live progress
      void this.runCoordinatorFlow(mission, target);
    }
    return mission;
  }

  private async runCoordinatorFlow(mission: Mission, target: Agent): Promise<void> {
    const settings = this.store.getSettings();

    if (!target.canDelegate) {
      // Direct single-bot execution
      const directTask = this.createTask({
        missionId: mission.id,
        parentTaskId: null,
        title: 'Tugas Langsung',
        instructions: mission.prompt,
        assignedToId: target.id,
        assignedById: 'user',
        dependsOnTaskIds: [],
      });
      await this.executeTask(directTask);
      await this.checkMissionCompletion(mission.id);
      return;
    }

    this.store.moveAgentToZone(target.id, 'war-room', 0, 'thinking');
    this.store.setSpeechBubble(target.id, 'Menganalisis perintah & menyusun tim...', 'command', 5000);

    this.store.addComms({
      missionId: mission.id,
      fromId: target.id,
      fromName: target.name,
      toId: 'all',
      toName: 'All Muse Bots',
      kind: 'progress',
      content: 'Memetakan kebutuhan misi dan memilih bot spesialis...',
    });

    const plan = await generateCoordinatorPlan(
      target,
      mission.prompt,
      this.store.getAgents(),
      settings
    );

    this.store.setSpeechBubble(target.id, plan.speech, 'command', 6000);

    if (plan.delegations.length === 0) {
      const answer = plan.directAnswer || plan.thought;
      this.store.updateMission(mission.id, {
        status: 'completed',
        finalSummary: answer,
        completedAt: new Date().toISOString(),
      });
      this.store.addComms({
        missionId: mission.id,
        fromId: target.id,
        fromName: target.name,
        toId: 'user',
        toName: 'Commander (Owner)',
        kind: 'deliverable',
        content: answer,
      });
      this.store.moveAgentToZone(target.id, target.homeZone, 0, 'idle');
      return;
    }

    this.store.addComms({
      missionId: mission.id,
      fromId: target.id,
      fromName: target.name,
      toId: 'all',
      toName: 'Tim Muse AI',
      kind: 'chat',
      content: `${plan.thought} (${plan.delegations.length} sub-tugas dibagikan)`,
    });

    // First create all tasks so index-based dependency wiring maps cleanly to real task IDs
    const createdTasks: Task[] = [];
    for (const del of plan.delegations) {
      const hasDeps = Array.isArray(del.dependsOnIndex) && del.dependsOnIndex.length > 0;
      const task = this.createTask({
        missionId: mission.id,
        parentTaskId: null,
        title: del.title,
        instructions: del.instructions,
        assignedToId: del.toAgentId,
        assignedById: target.id,
        dependsOnTaskIds: [],
        initialStatus: hasDeps ? 'waiting-dependency' : 'queued',
      });
      createdTasks.push(task);
    }

    plan.delegations.forEach((del, idx) => {
      const depIds = (del.dependsOnIndex || [])
        .filter((depIdx) => depIdx >= 0 && depIdx < createdTasks.length && depIdx !== idx)
        .map((depIdx) => createdTasks[depIdx].id);
      this.store.updateTask(createdTasks[idx].id, {
        dependsOnTaskIds: depIds,
        status: depIds.length > 0 ? 'waiting-dependency' : 'queued',
      });
    });

    for (const task of createdTasks) {
      const assignee = this.store.getAgent(task.assignedToId);
      if (assignee) {
        this.store.emitBeam(target.id, assignee.id, task.title, target.color);
        this.store.addComms({
          missionId: mission.id,
          fromId: target.id,
          fromName: target.name,
          toId: assignee.id,
          toName: assignee.name,
          kind: 'delegation',
          content: `[${task.title}] ${task.instructions}`,
        });
      }
    }

    this.store.moveAgentToZone(target.id, target.homeZone, 0, 'working');
    await this.dispatchReadyTasks(mission.id);
  }

  private createTask(input: {
    missionId: string;
    parentTaskId: string | null;
    title: string;
    instructions: string;
    assignedToId: string;
    assignedById: string;
    dependsOnTaskIds: string[];
    initialStatus?: Task['status'];
  }): Task {
    const now = new Date().toISOString();
    const { initialStatus, ...rest } = input;
    const task: Task = {
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      ...rest,
      status: initialStatus || (rest.dependsOnTaskIds.length > 0 ? 'waiting-dependency' : 'queued'),
      createdAt: now,
      updatedAt: now,
    };
    return this.store.addTask(task);
  }

  async delegateFromBot(params: {
    fromAgentId: string;
    toAgentId: string;
    title: string;
    instructions: string;
    missionId?: string;
    parentTaskId?: string | null;
  }): Promise<Task | null> {
    const fromAgent = this.store.getAgent(params.fromAgentId);
    const toAgent = this.store.getAgent(params.toAgentId);
    if (!fromAgent || !toAgent) return null;

    let missionId = params.missionId;
    if (!missionId || !this.store.getMission(missionId)) {
      const m = this.store.addMission({
        id: `mission-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        prompt: `[Bot Delegation] ${params.title}`,
        targetAgentId: fromAgent.id,
        status: 'running',
        createdAt: new Date().toISOString(),
      });
      missionId = m.id;
    }

    const task = this.createTask({
      missionId,
      parentTaskId: params.parentTaskId ?? null,
      title: params.title,
      instructions: params.instructions,
      assignedToId: toAgent.id,
      assignedById: fromAgent.id,
      dependsOnTaskIds: [],
    });

    this.store.emitBeam(fromAgent.id, toAgent.id, params.title, fromAgent.color);
    this.store.setSpeechBubble(
      fromAgent.id,
      `@${toAgent.name}, tolong kerjakan: ${params.title}`,
      'command'
    );
    this.store.addComms({
      missionId,
      fromId: fromAgent.id,
      fromName: fromAgent.name,
      toId: toAgent.id,
      toName: toAgent.name,
      kind: 'delegation',
      content: `[${params.title}] ${params.instructions}`,
    });

    await this.executeTask(task);
    await this.checkMissionCompletion(missionId);
    return task;
  }

  async dispatchReadyTasks(missionId: string): Promise<void> {
    const tasks = this.store.getTasksByMission(missionId);
    const taskMap = new Map(tasks.map((t) => [t.id, t]));

    const ready = tasks.filter((t) => {
      if (t.status !== 'queued' && t.status !== 'waiting-dependency') return false;
      return t.dependsOnTaskIds.every((depId) => {
        const dep = taskMap.get(depId);
        return dep && (dep.status === 'completed' || dep.status === 'failed');
      });
    });

    if (ready.length > 0) {
      await Promise.all(ready.map((t) => this.executeTask(t)));
    } else {
      // Break potential LLM-generated dependency cycles if nothing is in-flight
      const inFlight = tasks.some(
        (t) => t.status === 'working' || t.status === 'delegated' || t.status === 'assigned'
      );
      const stuck = tasks.filter(
        (t) => t.status === 'queued' || t.status === 'waiting-dependency'
      );
      if (!inFlight && stuck.length > 0) {
        for (const t of stuck) {
          this.store.updateTask(t.id, { dependsOnTaskIds: [], status: 'queued' });
        }
        await Promise.all(stuck.map((t) => this.executeTask(t)));
      }
    }

    await this.checkMissionCompletion(missionId);
  }

  private async executeTask(task: Task): Promise<void> {
    const agent = this.store.getAgent(task.assignedToId);
    const mission = this.store.getMission(task.missionId);
    if (!agent || !mission) {
      this.store.updateTask(task.id, { status: 'failed', error: 'Agent atau misi tidak ditemukan' });
      return;
    }

    const missionTasks = this.store.getTasksByMission(mission.id);
    const depOutputs = task.dependsOnTaskIds
      .map((id) => missionTasks.find((t) => t.id === id))
      .filter((t): t is Task => Boolean(t && t.status === 'completed' && t.result))
      .map((t) => ({
        agentName: this.store.getAgent(t.assignedToId)?.name || t.assignedToId,
        title: t.title,
        result: t.result!,
      }));

    this.store.updateAgent(agent.id, { currentTaskId: task.id });
    this.store.moveAgentToZone(agent.id, agent.homeZone, 0, 'working');

    // Handle external bots via Bridge (WebSocket, REST Polling, or Webhook)
    if (agent.type !== 'builtin') {
      const contextStr = depOutputs
        .map((d) => `${d.agentName} (${d.title}):\n${d.result}`)
        .join('\n\n');
      this.store.updateTask(task.id, { status: 'assigned' });
      this.store.setSpeechBubble(agent.id, `Menerima tugas: ${task.title}`, 'command', 5000);

      const delivered = await this.bridge.dispatchTaskToExternalBot(agent, task, contextStr);
      if (delivered) {
        this.store.addComms({
          missionId: mission.id,
          fromId: 'system',
          fromName: 'External Bridge',
          toId: agent.id,
          toName: agent.name,
          kind: 'progress',
          content: `Tugas "${task.title}" dikirim ke bot eksternal ${agent.name} (${agent.type}). Menunggu pengerjaan...`,
        });
        return; // Will resume when external bot reports task:complete / task:fail
      }

      const errMsg = `Bot eksternal ${agent.name} sedang offline atau webhook gagal dijangkau.`;
      this.store.updateTask(task.id, { status: 'failed', error: errMsg });
      this.store.updateAgent(agent.id, { currentTaskId: null, status: 'offline' });
      this.store.setSpeechBubble(agent.id, 'Offline / gagal dijangkau', 'error');
      this.store.addComms({
        missionId: mission.id,
        fromId: agent.id,
        fromName: agent.name,
        toId: 'all',
        toName: 'All',
        kind: 'error',
        content: errMsg,
      });
      await this.dispatchReadyTasks(mission.id);
      return;
    }

    // Built-in LLM or Demo agent execution
    this.store.updateTask(task.id, { status: 'working' });
    this.store.setSpeechBubble(agent.id, `Mengerjakan: ${task.title}`, 'chat', 5000);

    const depth = task.parentTaskId ? 1 : 0;
    const output = await executeWorkerTask(
      agent,
      mission.prompt,
      task.title,
      task.instructions,
      depOutputs,
      this.store.getAgents(),
      depth < 1 && agent.canDelegate,
      this.store.getSettings()
    );

    this.store.updateTask(task.id, {
      status: 'completed',
      result: output.result,
      completedAt: new Date().toISOString(),
    });
    this.store.updateAgent(agent.id, { currentTaskId: null, status: 'idle' });
    this.store.setSpeechBubble(agent.id, output.speech, 'report', 6000);

    const coordinator = this.store.getAgent(task.assignedById);
    if (coordinator) {
      this.store.emitBeam(agent.id, coordinator.id, `Selesai: ${task.title}`, agent.color);
    }

    this.store.addComms({
      missionId: mission.id,
      fromId: agent.id,
      fromName: agent.name,
      toId: coordinator?.id || 'user',
      toName: coordinator?.name || 'Commander (Owner)',
      kind: 'deliverable',
      content: output.result,
    });

    await this.dispatchReadyTasks(mission.id);
  }

  async completeExternalTask(
    taskId: string,
    result: string,
    speech?: string,
    reportingAgentId?: string
  ): Promise<{ applied: boolean; duplicate?: boolean; reason?: string }> {
    const task = this.store.getTask(taskId);
    if (!task) return { applied: false, reason: 'Tugas tidak ditemukan' };

    if (reportingAgentId && task.assignedToId !== reportingAgentId) {
      return { applied: false, reason: 'Tugas ini bukan milik bot pengirim' };
    }

    if (task.status === 'completed' || task.status === 'failed') {
      return { applied: true, duplicate: true };
    }

    const agent = this.store.getAgent(task.assignedToId);
    this.store.updateTask(taskId, {
      status: 'completed',
      result,
      completedAt: new Date().toISOString(),
    });

    if (agent) {
      this.store.updateAgent(agent.id, {
        ...(agent.currentTaskId === taskId ? { currentTaskId: null } : {}),
        status: agent.type === 'external-rest' ? 'online' : 'idle',
      });
      this.store.setSpeechBubble(agent.id, speech || 'Tugas eksternal selesai!', 'report', 6000);
      const coordinator = this.store.getAgent(task.assignedById);
      if (coordinator) {
        this.store.emitBeam(agent.id, coordinator.id, `Selesai: ${task.title}`, agent.color);
      }
      this.store.addComms({
        missionId: task.missionId,
        fromId: agent.id,
        fromName: agent.name,
        toId: coordinator?.id || 'user',
        toName: coordinator?.name || 'Commander (Owner)',
        kind: 'deliverable',
        content: result,
      });
    }

    await this.dispatchReadyTasks(task.missionId);
    return { applied: true };
  }

  async failExternalTask(
    taskId: string,
    error: string,
    reportingAgentId?: string
  ): Promise<{ applied: boolean; duplicate?: boolean; reason?: string }> {
    const task = this.store.getTask(taskId);
    if (!task) return { applied: false, reason: 'Tugas tidak ditemukan' };

    if (reportingAgentId && task.assignedToId !== reportingAgentId) {
      return { applied: false, reason: 'Tugas ini bukan milik bot pengirim' };
    }

    if (task.status === 'completed' || task.status === 'failed') {
      return { applied: true, duplicate: true };
    }

    const agent = this.store.getAgent(task.assignedToId);
    this.store.updateTask(taskId, { status: 'failed', error });
    if (agent) {
      this.store.updateAgent(agent.id, {
        ...(agent.currentTaskId === taskId ? { currentTaskId: null } : {}),
        status: 'error',
      });
      this.store.setSpeechBubble(agent.id, 'Tugas gagal!', 'error', 5000);
      this.store.addComms({
        missionId: task.missionId,
        fromId: agent.id,
        fromName: agent.name,
        toId: 'all',
        toName: 'All',
        kind: 'error',
        content: `Tugas "${task.title}" gagal: ${error}`,
      });
    }

    await this.dispatchReadyTasks(task.missionId);
    return { applied: true };
  }

  private async checkMissionCompletion(missionId: string): Promise<void> {
    const mission = this.store.getMission(missionId);
    if (!mission || mission.status !== 'running' || this.finalizingMissions.has(missionId)) {
      return;
    }

    const tasks = this.store.getTasksByMission(missionId);
    if (tasks.length === 0) return;

    const stillActive = tasks.some((t) =>
      ['queued', 'waiting-dependency', 'assigned', 'working', 'in-progress', 'delegated'].includes(t.status)
    );
    if (stillActive) return;

    this.finalizingMissions.add(missionId);
    try {
      const lead =
        this.store.getAgent(mission.targetAgentId) ||
        this.store.getAgents().find((a) => a.canDelegate) ||
        this.store.getAgents()[0];

      const completedDeliverables = tasks
        .filter((t) => t.status === 'completed' && t.result)
        .map((t) => {
          const worker = this.store.getAgent(t.assignedToId);
          return {
            agentName: worker?.name || t.assignedToId,
            role: worker?.role || 'Bot',
            title: t.title,
            result: t.result!,
          };
        });

      let finalSummary = '';
      if (tasks.length === 1 && completedDeliverables.length === 1 && !lead?.canDelegate) {
        finalSummary = completedDeliverables[0].result;
      } else if (lead && completedDeliverables.length > 0) {
        this.store.moveAgentToZone(lead.id, 'war-room', 0, 'thinking');
        this.store.setSpeechBubble(lead.id, 'Menyusun laporan akhir tim...', 'command', 4500);
        const synthesis = await synthesizeMissionReport(
          lead,
          mission.prompt,
          completedDeliverables,
          this.store.getSettings()
        );
        finalSummary = synthesis.summary;
        this.store.setSpeechBubble(lead.id, synthesis.speech, 'report', 6500);
        this.store.addComms({
          missionId: mission.id,
          fromId: lead.id,
          fromName: lead.name,
          toId: 'user',
          toName: 'Commander (Owner)',
          kind: 'deliverable',
          content: finalSummary,
        });
        this.store.moveAgentToZone(lead.id, lead.homeZone, 0, 'idle');
      } else {
        finalSummary = tasks
          .map((t) => `### ${t.title} (${t.status})\n${t.result || t.error || ''}`)
          .join('\n\n');
      }

      const anySuccess = tasks.some((t) => t.status === 'completed');
      this.store.updateMission(mission.id, {
        status: anySuccess ? 'completed' : 'failed',
        finalSummary,
        completedAt: new Date().toISOString(),
      });
    } finally {
      this.finalizingMissions.delete(missionId);
    }
  }
}
