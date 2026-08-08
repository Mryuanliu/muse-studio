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

export interface AgentRunSubscriber {
  /** Return false when the SSE client is no longer writable. */
  send(event: string, data: unknown): boolean;
}

interface NormalizedMessage {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  thinkingChain?: string;
  events?: any[];
  attachments?: ChatAttachment[];
}

interface ActiveRun {
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
  thinkingChain: string;
  events: any[];
  subscribers: Set<AgentRunSubscriber>;
  resolve: () => void;
  donePromise: Promise<void>;
  runtime: AgentRuntimeConfig;
}

function parseEvents(value: any): any[] {
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
    thinkingChain: message.thinkingChain || undefined,
    events: parseEvents(message.events),
    attachments: parseAttachments(message.attachments),
  };
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

function compactEvents(events: any[]): any[] {
  const out: any[] = [];
  for (const ev of events) {
    if (ev.type === 'thinking' || ev.type === 'text_chunk') {
      const content = ev.content || '';
      if (!content) continue;
      const last = out[out.length - 1];
      if (last?.type === ev.type) {
        last.content = (last.content || '') + content;
      } else {
        out.push({ ...ev, content });
      }
    } else {
      out.push(ev);
    }
  }
  return out;
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
  ) {
    this.askUser.subscribe((event) => this.handleAskUserEvent(event));
  }

  private handleAskUserEvent(event: AskUserEvent): void {
    const run = this.runs.get(event.conversationId);
    if (!run) return;
    const index = run.events.findIndex(
      (item) => item.type === 'ask_user' && item.requestId === event.requestId,
    );
    if (index >= 0) {
      run.events[index] = { ...run.events[index], ...event };
    } else {
      run.events.push(event);
    }
    void this.persist(run);
    this.broadcast(run, 'ask_user', event);
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

    if (!run.events.some((event) => event.type === 'status' && event.subtype === 'stopped')) {
      run.events.push({
        type: 'status',
        content: '⏹ 已停止本轮生成',
        subtype: 'stopped',
      });
      run.content = `${run.content ? run.content + '\n\n' : ''}⏹ 已停止本轮生成`;
      try {
        await this.persist(run);
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
        events: [],
      };

      const runtime = await this.runtimeFromConversation(conv);

      return this.buildRun({
        conversationId: conv.id,
        prompt: lastUser.content || (lastUser.attachments?.length
          ? '请查看附件中的图片，并根据图片完成任务。'
          : ''),
        attachments: parseAttachments(lastUser.attachments),
        assistantMessageId: lastAssistant.id,
        outputDir: conv.outputDir || this.agentSdk.getLegacyOutputDir(),
        resumeSessionId,
        baseMessages,
        content: baseAssistant.content || '',
        thinkingChain: baseAssistant.thinkingChain || '',
        events: compactEvents(baseAssistant.events || []),
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
      await this.conversation.addMessage(conversationId, 'user', userContent, undefined, undefined, attachments);
      if (!existing.agentSnapshot && params.agentId) await this.conversation.setAgentSnapshot(conversationId, runtime);
    } else {
      const conv = await this.conversation.create(userContent, attachments, runtime);
      conversationId = conv.id;
    }

    const assistantMsg = await this.conversation.addMessage(conversationId, 'assistant', '');
    await this.conversation.updateRunStatus(conversationId, 'running');
    const conv = await this.conversation.findOne(conversationId);
    const isLegacyResume = !!conv.sdkSessionId && !conv.outputDir;
    const outputDir = conv.outputDir || (
      isLegacyResume
        ? this.agentSdk.getLegacyOutputDir()
        : this.agentSdk.getOutputDir(conversationId)
    );
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
      thinkingChain: '',
      events: [],
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
    thinkingChain: string;
    events: any[];
    runtime: AgentRuntimeConfig;
  }): ActiveRun {
    let resolve!: () => void;
    const donePromise = new Promise<void>((r) => {
      resolve = r;
    });

    return {
      ...input,
      attachments: input.attachments || [],
      status: 'running',
      subscribers: new Set(),
      resolve,
      donePromise,
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
        // Fall through to the current platform defaults for malformed legacy data.
      }
    }
    return this.agents.runtime();
  }

  private sendSnapshot(run: ActiveRun, subscriber: AgentRunSubscriber): void {
    const messages = run.baseMessages.map((m) => ({ ...m, events: m.events ? [...m.events] : [] }));
    const current = messages.findIndex((m) => m.id === run.assistantMessageId);
    if (current >= 0) {
      messages[current] = {
        ...messages[current],
        content: run.content || messages[current].content,
        thinkingChain: run.thinkingChain || messages[current].thinkingChain,
        events: compactEvents(run.events),
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
    run.events = compactEvents(run.events);
    try {
      for await (const chunk of this.agentSdk.run(
        run.prompt,
        run.resumeSessionId,
        run.conversationId,
        run.outputDir,
        run.attachments,
        run.runtime,
      )) {
        switch (chunk.type) {
          case 'session':
            run.sdkSessionId = chunk.sessionId;
            if (run.sdkSessionId && run.conversationId) {
              await this.conversation.updateSdkSessionId(run.conversationId, run.sdkSessionId);
            }
            this.broadcast(run, 'meta', {
              conversationId: run.conversationId,
              messageId: run.assistantMessageId,
              sdkSessionId: run.sdkSessionId,
              outputDir: run.outputDir,
            });
            break;
          case 'thinking':
            run.thinkingChain += chunk.content || '';
            this.appendEvent(run, { type: 'thinking', content: chunk.content });
            await this.persist(run);
            this.broadcast(run, 'thinking', { content: chunk.content });
            break;
          case 'text':
            run.content += chunk.content || '';
            this.appendEvent(run, { type: 'text_chunk', content: chunk.content });
            await this.persist(run);
            this.broadcast(run, 'text', { content: chunk.content });
            break;
          case 'tool_start':
            run.events.push({
              type: 'tool_start',
              toolName: chunk.toolName,
              toolId: chunk.toolId,
              toolInput: chunk.toolInput,
            });
            await this.persist(run);
            this.broadcast(run, 'tool_start', {
              toolName: chunk.toolName,
              toolId: chunk.toolId,
              toolInput: chunk.toolInput,
            });
            break;
          case 'tool_update':
            run.events.push({
              type: 'tool_update',
              toolName: chunk.toolName,
              toolId: chunk.toolId,
              toolInput: chunk.toolInput,
            });
            await this.persist(run);
            this.broadcast(run, 'tool_update', {
              toolName: chunk.toolName,
              toolId: chunk.toolId,
              toolInput: chunk.toolInput,
            });
            break;
          case 'tool_progress':
            run.events.push({
              type: 'tool_progress',
              toolName: chunk.toolName,
              toolId: chunk.toolId,
              status: chunk.subtype,
              taskId: chunk.taskId,
              parentToolUseId: chunk.parentToolUseId,
            });
            await this.persist(run);
            this.broadcast(run, 'tool_progress', {
              toolName: chunk.toolName,
              toolId: chunk.toolId,
              status: chunk.subtype,
              taskId: chunk.taskId,
              parentToolUseId: chunk.parentToolUseId,
            });
            break;
          case 'tool_end':
            run.events.push({
              type: 'tool_end',
              toolName: chunk.toolName,
              toolId: chunk.toolId,
              toolInput: chunk.toolInput,
              toolResult: chunk.toolResult,
            });
            await this.persist(run);
            this.broadcast(run, 'tool_end', {
              toolName: chunk.toolName,
              toolId: chunk.toolId,
              toolInput: chunk.toolInput,
              toolResult: chunk.toolResult,
            });
            if (
              (chunk.toolName === 'Write' || chunk.toolName === 'Edit') &&
              this.preview.getUrl(run.conversationId)
            ) {
              this.realtime.emitToConversation(run.conversationId, 'preview', {
                status: 'updated',
              });
            }
            break;
          case 'skill_load':
            run.events.push({
              type: 'skill_load',
              skillName: chunk.skillName,
              status: chunk.status,
            });
            await this.persist(run);
            this.broadcast(run, 'skill_load', {
              skillName: chunk.skillName,
              status: chunk.status,
            });
            break;
          case 'skill_invoke':
            run.events.push({
              type: 'skill_invoke',
              skillName: chunk.skillName,
              toolId: chunk.toolId,
              status: chunk.status,
              input: chunk.input,
              output: chunk.output,
            });
            await this.persist(run);
            this.broadcast(run, 'skill_invoke', {
              skillName: chunk.skillName,
              toolId: chunk.toolId,
              status: chunk.status,
              input: chunk.input,
              output: chunk.output,
            });
            break;
          case 'mcp_status':
            run.events.push({
              type: 'mcp_status',
              serverName: chunk.serverName,
              status: chunk.status,
            });
            await this.persist(run);
            this.broadcast(run, 'mcp_status', {
              serverName: chunk.serverName,
              status: chunk.status,
            });
            break;
          case 'mcp_call':
            run.events.push({
              type: 'mcp_call',
              serverName: chunk.serverName,
              toolName: chunk.toolName,
              toolId: chunk.toolId,
              status: chunk.status,
              input: chunk.input,
              output: chunk.output,
            });
            await this.persist(run);
            this.broadcast(run, 'mcp_call', {
              serverName: chunk.serverName,
              toolName: chunk.toolName,
              toolId: chunk.toolId,
              status: chunk.status,
              input: chunk.input,
              output: chunk.output,
            });
            if (
              chunk.status === 'result' &&
              chunk.serverName === 'preview' &&
              (chunk.output as any)?.url
            ) {
              const targetUrl = (chunk.output as any).url as string;
              this.preview.setUrl(
                run.conversationId,
                targetUrl,
                (chunk.output as any).port,
                (chunk.input as any)?.project_path,
              );
              this.realtime.emitToConversation(run.conversationId, 'preview', {
                status: 'ready',
                url: `${process.env.PUBLIC_BASE_URL || 'http://localhost:3001'}/preview/${run.conversationId}`,
                port: (chunk.output as any).port,
                projectPath: (chunk.input as any)?.project_path,
              });
            }
            break;
          case 'status':
            run.events.push({ type: 'status', content: chunk.content, subtype: chunk.subtype });
            await this.persist(run);
            this.broadcast(run, 'status', { content: chunk.content, subtype: chunk.subtype });
            break;
          case 'command_output':
            run.events.push({ type: 'command_output', content: chunk.content });
            await this.persist(run);
            this.broadcast(run, 'command_output', { content: chunk.content });
            break;
          case 'subagent_start':
          case 'subagent_progress':
          case 'subagent_end': {
            const event = {
              type: chunk.type,
              taskId: chunk.taskId,
              toolId: chunk.toolId,
              parentToolUseId: chunk.parentToolUseId,
              description: chunk.description,
              subagentType: chunk.subagentType,
              summary: chunk.summary,
              outputFile: chunk.outputFile,
              status: chunk.status,
              taskUsage: chunk.taskUsage,
            };
            run.events.push(event);
            await this.persist(run);
            this.broadcast(run, chunk.type, event);
            break;
          }
          case 'done':
            run.status = 'completed';
            if (!this.preview.getUrl(run.conversationId)) {
              const match = run.content.match(/https?:\/\/localhost:\d+/);
              if (match) {
                this.preview.setUrl(run.conversationId, match[0], Number(new URL(match[0]).port), run.outputDir);
                this.realtime.emitToConversation(run.conversationId, 'preview', {
                  status: 'ready',
                url: `${process.env.PUBLIC_BASE_URL || 'http://localhost:3001'}/preview/${run.conversationId}`,
                  port: Number(new URL(match[0]).port),
                  projectPath: run.outputDir,
                });
              }
            }
            await this.finish(run);
            this.broadcast(run, 'done', { messageId: run.assistantMessageId, usage: chunk.usage });
            return;
          case 'stopped':
            if (run.status !== 'stopped') {
              run.status = 'stopped';
              run.events.push({
                type: 'status',
                content: '⏹ 已停止本轮生成',
                subtype: 'stopped',
              });
              run.content = `${run.content ? run.content + '\n\n' : ''}⏹ 已停止本轮生成`;
              await this.persist(run);
              this.broadcast(run, 'stopped', { message: '已停止本轮生成' });
            }
            await this.conversation.updateRunStatus(run.conversationId, 'idle');
            return;
        }
      }
    } catch (error: any) {
      if (run.status === 'stopped' || error?.name === 'AbortError' || /abort|closed/i.test(error?.message || '')) {
        if (run.status !== 'stopped') {
          run.status = 'stopped';
          run.events.push({
            type: 'status',
            content: '⏹ 已停止本轮生成',
            subtype: 'stopped',
          });
          run.content = `${run.content ? run.content + '\n\n' : ''}⏹ 已停止本轮生成`;
          await this.persist(run);
        }
        await this.conversation.updateRunStatus(run.conversationId, 'idle');
        this.broadcast(run, 'stopped', { message: '已停止本轮生成' });
        return;
      }
      this.logger.error(`Agent run failed for ${run.conversationId}:`, error.message);
      run.status = 'error';
      run.errorMessage = error.message || 'Agent run error';
      run.events.push({ type: 'status', content: `❌ ${run.errorMessage}`, subtype: 'error' });
      run.content = `${run.content ? run.content + '\n\n' : ''}❌ ${run.errorMessage}`;
      try {
        await this.persist(run);
        await this.conversation.updateRunStatus(run.conversationId, 'error');
      } catch (persistError: any) {
        this.logger.error(`Failed to persist errored run ${run.conversationId}:`, persistError.message);
      }
      this.broadcast(run, 'error', { message: error.message || 'Agent run error' });
    } finally {
      run.resolve();
    }
  }

  private async persist(run: ActiveRun): Promise<void> {
    await this.conversation.updateMessage(
      run.assistantMessageId,
      run.content,
      run.thinkingChain,
      run.events,
    );
  }

  private appendEvent(run: ActiveRun, ev: any): void {
    if (ev.type === 'thinking' || ev.type === 'text_chunk') {
      const content = ev.content || '';
      const last = run.events[run.events.length - 1];
      if (last?.type === ev.type) {
        last.content = (last.content || '') + content;
        return;
      }
    }
    run.events.push(ev);
  }

  private async finish(run: ActiveRun): Promise<void> {
    await this.persist(run);
    await this.conversation.updateRunStatus(run.conversationId, 'completed');

    const outputDir = path.resolve(run.outputDir);
    for (const ev of run.events) {
      const fp = ev.toolInput?.file_path || ev.toolInput?.path;
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
