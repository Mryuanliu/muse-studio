import { Injectable, Logger } from '@nestjs/common';
import { AgentRuntimeConfig, SandboxServiceClient } from '../sandbox/sandbox-service-client';
import { ConversationService } from '../conversation/conversation.service';
import { RealtimeService } from '../realtime/realtime.service';
import { PreviewService } from '../preview/preview.service';
import { AskUserEvent, AskUserService } from './ask-user.service';
import * as fs from 'fs';
import * as path from 'path';
import type { ChatAttachment } from '../sandbox/sandbox-types';
import { AgentService } from '../agent/agent.service';
import { v4 as uuidv4 } from 'uuid';
import { MuseEventNormalizer } from '../events/muse-event.normalizer';
import { MuseEvent } from '../events/muse-event.types';

export interface AgentRunSubscriber {
  /** Return false when the SSE client is no longer writable. */
  send(event: string, data: unknown): boolean;
}

export interface AgentRunResult {
  conversationId: string;
  status: 'completed' | 'error' | 'stopped';
  content: string;
  errorMessage?: string;
}

interface NormalizedMessage {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  museEvents?: MuseEvent[];
  attachments?: ChatAttachment[];
}

interface ActiveRun {
  runId: string;
  conversationId: string;
  prompt: string;
  attachments: ChatAttachment[];
  assistantMessageId: string;
  outputDir: string;
  resumeSessionId?: string;
  sdkSessionId?: string;
  status: 'running' | 'completed' | 'error' | 'stopped';
  errorMessage?: string;
  baseMessages: NormalizedMessage[];
  content: string;
  museEvents: MuseEvent[];
  museSequence: number;
  reasoningActive: boolean;
  subscribers: Set<AgentRunSubscriber>;
  resolve: () => void;
  donePromise: Promise<void>;
  runtime: AgentRuntimeConfig;
}

function parseJson(value: any): any[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

function normalizeMessage(message: any): NormalizedMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content || '',
    museEvents: parseMuseEvents(message.museEvents),
    attachments: parseAttachments(message.attachments),
  };
}

function parseMuseEvents(value: any): MuseEvent[] {
  const parsed = parseJson(value);
  return parsed as MuseEvent[];
}

function parseAttachments(value: any): ChatAttachment[] {
  if (!value) return [];
  if (Array.isArray(value)) return value as ChatAttachment[];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as ChatAttachment[] : [];
  } catch {
    return [];
  }
}

@Injectable()
export class AgentRunService {
  private readonly logger = new Logger(AgentRunService.name);
  private readonly runs = new Map<string, ActiveRun>();

  constructor(
    private readonly agentSdk: SandboxServiceClient,
    private readonly conversation: ConversationService,
    private readonly realtime: RealtimeService,
    private readonly preview: PreviewService,
    private readonly askUser: AskUserService,
    private readonly agents: AgentService,
    private readonly museEvents: MuseEventNormalizer,
  ) {
    this.askUser.subscribe((event) => this.handleAskUserEvent(event));
  }

  private async handleAskUserEvent(event: AskUserEvent): Promise<void> {
    const run = this.runs.get(event.conversationId);
    if (!run) return;
    const museEvent = this.museEvents.lifecycle({
      type: event.status === 'submitted' ? 'ask_user.resolved' : 'ask_user.requested',
      runId: run.runId,
      conversationId: run.conversationId,
      sequence: ++run.museSequence,
      payload: event,
    });
    run.museEvents.push(museEvent);
    await this.persist(run);
    this.broadcast(run, 'muse_event', museEvent);
  }

  /** Attach to an active in-memory run, or start/resume a backend run. */
  async startOrAttach(
    params: {
      prompt?: string;
      conversationId?: string;
      resumeSessionId?: string;
      reattach?: boolean;
      attachments?: ChatAttachment[];
      agentId?: string;
    },
    subscriber: AgentRunSubscriber,
  ): Promise<Promise<void>> {
    if (params.conversationId) {
      const existing = this.runs.get(params.conversationId);
      if (existing) {
        if (existing.status === 'running') {
          existing.subscribers.add(subscriber);
          this.sendSnapshot(existing, subscriber);
          return existing.donePromise;
        }
        this.runs.delete(params.conversationId);
      }
    }

    const run = await this.createRun(params);
    run.subscribers.add(subscriber);
    this.sendSnapshot(run, subscriber);
    void this.execute(run);
    return run.donePromise;
  }

  /**
   * Integration-facing runner for side channels such as Feishu.
   * The web UI uses the SSE endpoint; adapters use this method and do not
   * need to know about the internal event stream or subscriber lifecycle.
   */
  async runToCompletion(params: {
    prompt?: string;
    conversationId?: string;
    resumeSessionId?: string;
    agentId?: string;
  }): Promise<AgentRunResult> {
    let conversationId = params.conversationId;
    const done = await this.startOrAttach(params, {
      send: (event, data) => {
        if (!conversationId && (event === 'snapshot' || event === 'meta')) {
          conversationId = (data as any)?.conversationId || conversationId;
        }
        return true;
      },
    });
    await done;
    if (!conversationId) throw new Error('Agent did not create a conversation');
    const conversation = await this.conversation.findOne(conversationId);
    return {
      conversationId,
      status: conversation.runStatus === 'completed' ? 'completed' : conversation.runStatus === 'error' ? 'error' : 'stopped',
      content: conversation.messages?.find((message) => message.role === 'assistant' && message.id === conversation.messages?.[conversation.messages.length - 1]?.id)?.content || '',
    };
  }

  async status(conversationId: string): Promise<{
    conversationId: string;
    runStatus: string;
    sdkSessionId?: string | null;
    isRunning: boolean;
  }> {
    const active = this.runs.get(conversationId);
    if (active) {
      return {
        conversationId,
        runStatus: active.status === 'stopped' ? 'idle' : active.status,
        sdkSessionId: active.sdkSessionId,
        isRunning: active.status === 'running',
      };
    }

    const conv = await this.conversation.findOne(conversationId);
    return {
      conversationId,
      runStatus: conv.runStatus || 'idle',
      sdkSessionId: conv.sdkSessionId,
      isRunning: (conv.runStatus || 'idle') === 'running',
    };
  }

  async stop(conversationId: string): Promise<{ stopped: boolean; message?: string }> {
    const run = this.runs.get(conversationId);
    if (!run || run.status !== 'running') {
      try {
        const conv = await this.conversation.findOne(conversationId);
        if (conv?.runStatus === 'running') {
          await this.conversation.updateRunStatus(conversationId, 'idle');
        }
      } catch {
        // conversation may have been deleted
      }
      return { stopped: false, message: '当前会话没有运行中的本轮任务' };
    }

    run.status = 'stopped';
    this.askUser.cancelForConversation(conversationId);
    try {
      await this.agentSdk.stop(conversationId);
    } catch (error: any) {
      this.logger.warn(`Failed to stop sandbox task for ${conversationId}: ${error.message}`);
    }

    if (run.status === 'stopped') {
      run.content = `${run.content ? run.content + '\n\n' : ''}⏹ 已停止本轮生成`;
      try {
        const event = this.museEvents.lifecycle({
          type: 'run.stopped',
          runId: run.runId,
          conversationId: run.conversationId,
          sequence: ++run.museSequence,
          payload: { message: '已停止本轮生成' },
        });
        run.museEvents.push(event);
        await this.persist(run);
        this.broadcast(run, 'muse_event', event);
      } catch (error: any) {
        this.logger.warn(`Failed to persist stopped run ${conversationId}: ${error.message}`);
      }
    }

    await this.conversation.updateRunStatus(conversationId, 'idle').catch(() => undefined);
    this.broadcast(run, 'stopped', { message: '已停止本轮生成' });
    return { stopped: true, message: '已停止本轮生成' };
  }

  private async createRun(params: {
    prompt?: string;
    conversationId?: string;
    resumeSessionId?: string;
    reattach?: boolean;
      attachments?: ChatAttachment[];
    agentId?: string;
  }): Promise<ActiveRun> {
    if (params.reattach) {
      if (!params.conversationId) {
        throw new Error('conversationId is required when reattaching');
      }
      const conv = await this.conversation.findOne(params.conversationId);
      const messages = conv.messages || [];
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
      if (!lastUser || !lastAssistant) {
        throw new Error('No conversation history available to resume');
      }

      const resumeSessionId = params.resumeSessionId || conv.sdkSessionId;
      if (!resumeSessionId) {
        throw new Error('No SDK session available to resume');
      }

      const baseMessages = messages.map(normalizeMessage);
      const baseAssistant = baseMessages.find((m) => m.id === lastAssistant.id) || {
        role: 'assistant' as const,
        content: '',
      };

      const runtime = await this.runtimeFromConversation(conv);

      return this.buildRun({
        conversationId: conv.id,
        prompt: lastUser.content || (lastUser.attachments?.length
          ? '请查看附件中的图片，并根据图片完成任务。'
          : ''),
        attachments: parseAttachments(lastUser.attachments),
        assistantMessageId: lastAssistant.id,
        outputDir: conv.outputDir || this.agentSdk.getOutputDir(conv.id),
        resumeSessionId,
        baseMessages,
        content: baseAssistant.content || '',
        museEvents: [...(baseAssistant.museEvents || [])],
        museSequence: (baseAssistant.museEvents || []).reduce(
          (max, event) => Math.max(max, Number(event.sequence) || 0),
          0,
        ),
        reasoningActive: false,
        runtime,
      });
    }

    const attachments = params.attachments || [];
    const userContent = params.prompt?.trim() || '';
    const prompt = userContent || (attachments.length ? '请查看附件中的图片，并根据图片完成任务。' : '');
    if (!userContent && !attachments.length) {
      throw new Error('prompt is required');
    }

    let conversationId = params.conversationId;
    let runtime = await this.agents.runtime(params.agentId);
    if (conversationId) {
      const existing = await this.conversation.findOne(conversationId);
      if (existing.agentSnapshot) runtime = await this.runtimeFromConversation(existing);
      await this.conversation.addMessage(conversationId, 'user', userContent, attachments);
      if (!existing.agentSnapshot && params.agentId) await this.conversation.setAgentSnapshot(conversationId, runtime);
    } else {
      const conv = await this.conversation.create(userContent, attachments, runtime);
      conversationId = conv.id;
    }

    const assistantMsg = await this.conversation.addMessage(conversationId, 'assistant', '');
    await this.conversation.updateRunStatus(conversationId, 'running');
    const conv = await this.conversation.findOne(conversationId);
    const outputDir = conv.outputDir || this.agentSdk.getOutputDir(conversationId);
    if (!conv.outputDir) {
      await this.conversation.updateOutputDir(conversationId, outputDir);
    }

    return this.buildRun({
      conversationId,
      prompt,
      attachments,
      assistantMessageId: assistantMsg.id,
      outputDir,
      resumeSessionId: params.resumeSessionId || conv.sdkSessionId,
      baseMessages: conv.messages.map(normalizeMessage),
      content: '',
      museEvents: [],
      museSequence: 0,
      reasoningActive: false,
      runtime,
    });
  }

  private buildRun(input: {
    conversationId: string;
    prompt: string;
    attachments?: ChatAttachment[];
    assistantMessageId: string;
    outputDir: string;
    resumeSessionId?: string;
    baseMessages: NormalizedMessage[];
    content: string;
    museEvents: MuseEvent[];
    museSequence: number;
    reasoningActive: boolean;
    runtime: AgentRuntimeConfig;
  }): ActiveRun {
    let resolve!: () => void;
    const donePromise = new Promise<void>((r) => {
      resolve = r;
    });

    return {
      ...input,
      runId: uuidv4(),
      attachments: input.attachments || [],
      status: 'running',
      subscribers: new Set(),
      resolve,
      donePromise,
      reasoningActive: input.reasoningActive,
      runtime: input.runtime,
    };
  }

  private async runtimeFromConversation(conv: any): Promise<AgentRuntimeConfig> {
    if (conv.agentSnapshot) {
      try {
        const snapshot = JSON.parse(conv.agentSnapshot);
        return {
          agentId: snapshot.agentId,
          agentName: snapshot.agentName,
          agentType: snapshot.agentType,
          systemPrompt: snapshot.systemPrompt || snapshot.agentPrompt,
          enabledSkills: snapshot.enabledSkills || [],
          enabledMcps: snapshot.enabledMcps || [],
          mcpServers: snapshot.mcpServers || {},
        };
      } catch {
        // Fall through to the current platform defaults for malformed snapshots.
      }
    }
    return this.agents.runtime();
  }

  private sendSnapshot(run: ActiveRun, subscriber: AgentRunSubscriber): void {
    const messages = run.baseMessages.map((m) => ({
      ...m,
      museEvents: m.museEvents ? [...m.museEvents] : [],
    }));
    const current = messages.findIndex((m) => m.id === run.assistantMessageId);
    if (current >= 0) {
      messages[current] = {
        ...messages[current],
        content: run.content || messages[current].content,
        museEvents: [...run.museEvents],
      };
    }

    subscriber.send('snapshot', {
      conversationId: run.conversationId,
      sdkSessionId: run.sdkSessionId,
      runStatus: run.status,
      messageId: run.assistantMessageId,
      messages,
    });
  }

  private async execute(run: ActiveRun): Promise<void> {
    this.emitMuseLifecycle(run, 'run.started', { prompt: run.prompt });
    await this.persist(run);
    try {
      for await (const chunk of this.agentSdk.run(run.prompt, run.resumeSessionId, run.conversationId, run.outputDir, run.attachments, run.runtime)) {
        if (chunk.type === 'thinking' && !run.reasoningActive) {
          run.reasoningActive = true;
          this.emitMuseLifecycle(run, 'reasoning.started', {});
        } else if (chunk.type !== 'thinking' && run.reasoningActive) {
          run.reasoningActive = false;
          this.emitMuseLifecycle(run, 'reasoning.completed', {});
        }

        if (chunk.type === 'session') {
          run.sdkSessionId = chunk.sessionId;
          if (run.sdkSessionId) await this.conversation.updateSdkSessionId(run.conversationId, run.sdkSessionId);
          this.broadcast(run, 'meta', { conversationId: run.conversationId, messageId: run.assistantMessageId, sdkSessionId: run.sdkSessionId, outputDir: run.outputDir });
        }
        if (chunk.type === 'text') run.content += chunk.content || '';

        const normalized = this.museEvents.normalize(chunk, {
          runId: run.runId,
          conversationId: run.conversationId,
          sequence: ++run.museSequence,
        });
        if (normalized) {
          run.museEvents.push(normalized);
          this.broadcast(run, 'muse_event', normalized);
        }
        await this.persist(run);

        if (chunk.type === 'tool_end' && ['Write', 'Edit'].includes(chunk.toolName || '') && this.preview.getUrl(run.conversationId)) {
          this.realtime.emitToConversation(run.conversationId, 'preview', { status: 'updated' });
        }
        if (chunk.type === 'mcp_call' && chunk.status === 'result' && chunk.serverName === 'preview' && (chunk.output as any)?.url) {
          const output = chunk.output as any;
          this.preview.setUrl(run.conversationId, output.url, output.port, chunk.input?.project_path);
          this.realtime.emitToConversation(run.conversationId, 'preview', {
            status: 'ready',
            url: `${process.env.PUBLIC_BASE_URL || 'http://localhost:3001'}/preview/${run.conversationId}`,
            port: output.port,
            projectPath: chunk.input?.project_path,
          });
        }

        if (chunk.type === 'done') {
          if (chunk.resultStatus && chunk.resultStatus !== 'success') {
            run.status = 'error';
            run.errorMessage = chunk.resultErrors?.join('; ') || `Agent ended with ${chunk.resultStatus}`;
            this.emitMuseLifecycle(run, 'run.failed', { message: run.errorMessage });
            await this.persist(run);
            await this.conversation.updateRunStatus(run.conversationId, 'error');
            this.broadcast(run, 'error', { message: run.errorMessage });
            return;
          }
          run.status = 'completed';
          if (!run.content.trim()) run.content = '任务已完成，但模型未返回文字总结。';
          this.emitMuseLifecycle(run, 'message.completed', { content: run.content });
          this.emitMuseLifecycle(run, 'run.completed', { summary: run.content, summarySource: 'model' });
          await this.finish(run);
          this.broadcast(run, 'done', { messageId: run.assistantMessageId, usage: chunk.usage, content: run.content });
          return;
        }
        if (chunk.type === 'stopped') {
          run.status = 'stopped';
          this.emitMuseLifecycle(run, 'run.stopped', { message: '已停止本轮生成' });
          await this.persist(run);
          await this.conversation.updateRunStatus(run.conversationId, 'idle');
          this.broadcast(run, 'stopped', { message: '已停止本轮生成' });
          return;
        }
      }
    } catch (error: any) {
      if (run.status === 'stopped' || error?.name === 'AbortError' || /abort|closed/i.test(error?.message || '')) {
        run.status = 'stopped';
        this.emitMuseLifecycle(run, 'run.stopped', { message: '已停止本轮生成' });
        await this.persist(run);
        await this.conversation.updateRunStatus(run.conversationId, 'idle');
        this.broadcast(run, 'stopped', { message: '已停止本轮生成' });
        return;
      }
      this.logger.error(`Agent run failed for ${run.conversationId}:`, error.message);
      run.status = 'error';
      run.errorMessage = error.message || 'Agent run error';
      run.content = `${run.content ? `${run.content}\n\n` : ''}❌ ${run.errorMessage}`;
      this.emitMuseLifecycle(run, 'run.failed', { message: run.errorMessage });
      await this.persist(run);
      await this.conversation.updateRunStatus(run.conversationId, 'error');
      this.broadcast(run, 'error', { message: run.errorMessage });
    } finally {
      run.resolve();
    }
  }

  private async persist(run: ActiveRun): Promise<void> {
    await this.conversation.updateMessage(
      run.assistantMessageId,
      run.content,
      run.museEvents,
    );
  }

  private emitMuseLifecycle(
    run: ActiveRun,
    type: 'run.started' | 'run.completed' | 'run.failed' | 'run.stopped' | 'reasoning.started' | 'reasoning.completed' | 'message.completed' | 'ask_user.requested' | 'ask_user.resolved',
    payload: unknown,
  ): void {
    const event = this.museEvents.lifecycle({
      type,
      runId: run.runId,
      conversationId: run.conversationId,
      sequence: ++run.museSequence,
      payload,
    });
    run.museEvents.push(event);
    this.broadcast(run, 'muse_event', event);
  }

  private async finish(run: ActiveRun): Promise<void> {
    await this.persist(run);
    await this.conversation.updateRunStatus(run.conversationId, 'completed');

    const outputDir = path.resolve(run.outputDir);
    for (const ev of run.museEvents) {
      const payload = ev.payload as any;
      const fp = payload?.toolInput?.file_path || payload?.toolInput?.path;
      if (fp && typeof fp === 'string' && /\.html?$/i.test(fp)) {
        let outputFile = fp;
        const absolute = path.resolve(outputDir, fp);
        const relative = path.relative(outputDir, absolute);
        const isInside = relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
        if (!isInside && fs.existsSync(absolute)) {
          const filename = path.basename(fp).replace(/^\.+/, '') || 'output.html';
          const dest = path.join(outputDir, filename);
          try {
            fs.copyFileSync(absolute, dest);
            outputFile = dest;
          } catch (error: any) {
            this.logger.warn(`Failed to copy external output ${fp}: ${error.message}`);
          }
        }
        await this.conversation.addOutputFile(run.conversationId, outputFile);
      }
    }
  }

  private broadcast(run: ActiveRun, event: string, data: unknown): void {
    for (const subscriber of [...run.subscribers]) {
      if (!subscriber.send(event, data)) {
        run.subscribers.delete(subscriber);
      }
    }
  }
}
