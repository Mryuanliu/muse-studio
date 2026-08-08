import { query } from '@anthropic-ai/claude-agent-sdk';
import * as path from 'path';
import * as fs from 'fs';
import { PAGE_SYSTEM_PROMPT } from './page-system-prompt';
import { AgentChunk, ChatAttachment, SandboxConfig } from './types';

const SANDBOX_AGENTS = {
  'frontend-builder': {
    description: '生成和修改前端项目代码，负责页面结构、组件、样式与交互实现。',
    prompt: '你是一名前端实现工程师。只修改当前沙箱工作区内的项目文件，遵循已加载 skill 的工程规范。完成任务并返回结果后必须立即结束，不残留后台进程，不继续修改文件。',
    tools: ['Read', 'Grep', 'Glob', 'Write', 'Edit', 'Bash', 'TaskCreate', 'TaskUpdate', 'TaskList'],
    permissionMode: 'bypassPermissions' as const,
  },
  'code-reviewer': {
    description: '审查前端代码质量、类型安全、可维护性和明显缺陷。',
    prompt: '你是一名前端代码评审工程师。使用只读工具检查代码，返回按严重程度排序的问题列表，并给出修改建议。',
    tools: ['Read', 'Grep', 'Glob', 'TaskList'],
    permissionMode: 'dontAsk' as const,
  },
  'preview-verifier': {
    description: '启动和验证前端 dev server 是否可访问。',
    prompt: '你负责验证预览服务。使用 Bash 检查端口和页面响应，使用 preview MCP 启动/停止 dev server。返回可访问 URL 或失败原因。',
    tools: ['Read', 'Bash', 'TaskList'],
    permissionMode: 'bypassPermissions' as const,
  },
};

export class AgentSdkService {
  private outputDir: string;
  private currentQuery?: ReturnType<typeof query>;
  private abortController?: AbortController;
  private stopped = false;

  constructor(private readonly config: SandboxConfig) {
    this.outputDir = path.resolve(config.outputDir);
    fs.mkdirSync(this.outputDir, { recursive: true });
    process.stderr.write(`[sandbox] output directory: ${this.outputDir}\n`);
  }

  getOutputDir(): string {
    return this.outputDir;
  }

  stop(): void {
    this.stopped = true;
    this.abortController?.abort();
    try {
      this.currentQuery?.close();
    } catch {
      // query may already be closed
    }
  }

  isStopped(): boolean {
    return this.stopped;
  }

  /** Force a file target into the platform output directory. */
  constrainPath(target: string): string {
    const outputRoot = path.resolve(this.outputDir);
    const absolute = path.resolve(outputRoot, target);
    const relative = path.relative(outputRoot, absolute);
    const isInside = relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
    if (isInside) return absolute;

    const filename = path.basename(target).replace(/^\.+/, '') || 'output.html';
    return path.join(outputRoot, filename);
  }

  private isOutsidePath(raw: string): boolean {
    const clean = raw.replace(/^['"]|['"]$/g, '');
    if (!clean || clean.startsWith('-')) return false;
    if (clean.startsWith('~/')) return true;

    const outputRoot = path.resolve(this.outputDir);
    const absolute = path.resolve(outputRoot, clean);
    const relative = path.relative(outputRoot, absolute);
    return relative.startsWith('..') || path.isAbsolute(relative);
  }

  private bashWritesOutside(command: string): boolean {
    if (!command) return false;
    const targets: string[] = [];
    for (const match of command.matchAll(/(?:^|[\s;|])(?:>>|>)\s*([^\s&|;]+)/g)) {
      targets.push(match[1]);
    }
    for (const match of command.matchAll(/\b(?:mkdir|touch|install|tee)\s+(?:-p\s+)?([^\s&|;]+)/g)) {
      targets.push(match[1]);
    }
    return targets.some((target) => this.isOutsidePath(target));
  }

  private imagePrompt(prompt: string, attachments: ChatAttachment[]): string | AsyncIterable<any> {
    if (!attachments.length) return prompt;

    const content: any[] = [];
    if (prompt.trim()) content.push({ type: 'text', text: prompt });
    for (const attachment of attachments) {
      const file = path.resolve(this.outputDir, attachment.path);
      const relative = path.relative(this.outputDir, file);
      if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(file)) {
        throw new Error(`Attachment is outside the workspace or missing: ${attachment.path}`);
      }
      const mimeType = attachment.mimeType.toLowerCase();
      if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mimeType)) {
        throw new Error(`Unsupported image type: ${attachment.mimeType}`);
      }
      content.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: mimeType,
          data: fs.readFileSync(file).toString('base64'),
        },
      });
    }

    return (async function* () {
      yield {
        type: 'user',
        message: { role: 'user', content },
        parent_tool_use_id: null,
      };
    })();
  }

  private syncSkills(): string[] {
    const enabled = this.config.enabledSkills || [];
    const destRoot = path.join(this.outputDir, '.claude', 'skills');
    fs.rmSync(destRoot, { recursive: true, force: true });
    const sourceRoot = path.resolve(this.config.skillsRoot);
    if (!fs.existsSync(sourceRoot)) return enabled;

    for (const name of enabled) {
      const source = path.join(sourceRoot, name);
      if (fs.existsSync(source)) {
        fs.cpSync(source, path.join(destRoot, name), { recursive: true });
      }
    }
    return enabled;
  }

  private mcpServers() {
    const servers: Record<string, any> = {};
    for (const name of this.config.enabledMcps || []) {
      const definition = this.config.mcpServers?.[name];
      if (definition?.type === 'http') {
        const bridge = path.join(this.config.mcpDir, 'remote-http-bridge.mjs');
        servers[name] = {
          command: 'node',
          args: [bridge],
          env: {
            ...(definition.env || {}),
            MUSE_REMOTE_MCP_URL: definition.url,
            MUSE_REMOTE_MCP_HEADERS: JSON.stringify(definition.headers || {}),
            MUSE_REMOTE_MCP_TIMEOUT: String(definition.timeout || 30000),
          },
        };
        continue;
      }
      const args = definition?.args?.length ? definition.args.map((arg) => arg === `${name}-server.mjs` ? path.join(this.config.mcpDir, arg) : arg) : [path.join(this.config.mcpDir, `${name}-server.mjs`)];
      servers[name] = {
        command: definition?.command || 'node',
        args,
        env: {
          ...(definition?.env || {}),
          SANDBOX_ROOT: this.outputDir,
          PREVIEW_ROOT: this.outputDir,
          PREVIEW_TASK_ID: this.config.previewTaskId || '',
        },
      };
    }
    return servers;
  }

  private async waitForUserAnswer(
    input: Record<string, unknown>,
    options: { requestId: string; toolUseID: string; signal: AbortSignal },
  ): Promise<Record<string, any>> {
    const backendUrl = this.config.backendUrl || process.env.BACKEND_URL || 'http://localhost:3001';
    const conversationId = this.config.conversationId || this.config.previewTaskId || '';
    const questions = Array.isArray((input as any).questions) ? (input as any).questions : [];

    const payload = {
      requestId: options.requestId,
      toolUseID: options.toolUseID,
      conversationId,
      questions,
    };
    while (!options.signal.aborted) {
      try {
        const res = await fetch(`${backendUrl}/agent/ask-user/wait`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: options.signal,
        });
        if (res.ok) return res.json();
        if (res.status >= 400 && res.status < 500 && res.status !== 409) {
          const message = await res.text().catch(() => '');
          throw new Error(`AskUser registration failed: HTTP ${res.status} ${message}`);
        }
      } catch (error: any) {
        if (options.signal.aborted || error?.name === 'AbortError') throw error;
      }

      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 1000);
        const onAbort = () => {
          clearTimeout(timer);
          reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));
        };
        options.signal.addEventListener('abort', onAbort, { once: true });
      });
    }
    throw Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
  }

  async *run(
    prompt: string,
    resumeSessionId?: string,
    attachments: ChatAttachment[] = [],
  ): AsyncGenerator<AgentChunk, void, undefined> {
    process.stderr.write(`[sandbox] agent run: "${prompt.slice(0, 60)}..."${resumeSessionId ? ' (resume)' : ''}\n`);

    this.stopped = false;
    this.abortController = new AbortController();
    let sdkSessionId: string | undefined;
    let sessionYielded = false;
    const enabledSkills = this.syncSkills();

    const makeQuery = (resume?: string) => query({
      prompt: this.imagePrompt(prompt, attachments) as any,
      options: {
        env: {
          ...process.env as Record<string, string>,
          ANTHROPIC_BASE_URL: this.config.proxyUrl || 'http://localhost:3001',
          ANTHROPIC_API_KEY: 'test-key',
        },
        cwd: this.outputDir,
        tools: { type: 'preset', preset: 'claude_code' },
        abortController: this.abortController,
        // Max API round-trips (model → tool_use → tool_result → model...).
        // Each Write/Bash/Read call counts as one turn. Override via MAX_TURNS env.
        maxTurns: parseInt(process.env.MAX_TURNS || '100', 10),
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        canUseTool: async (toolName, input, options) => {
          if (toolName !== 'AskUserQuestion') {
            return { behavior: 'allow' as const };
          }
          const answer = await this.waitForUserAnswer(input, options);
          return {
            behavior: 'allow' as const,
            updatedInput: {
              ...input,
              answers: answer.answers || {},
              ...(answer.response ? { response: answer.response } : {}),
              ...(answer.annotations ? { annotations: answer.annotations } : {}),
            },
          };
        },
        includePartialMessages: true,
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: [PAGE_SYSTEM_PROMPT, this.config.systemPrompt].filter(Boolean).join('\n\n'),
        },
        agents: SANDBOX_AGENTS,
        forwardSubagentText: true,
        agentProgressSummaries: true,
        toolConfig: {
          askUserQuestion: { previewFormat: 'html' },
        },
        skills: enabledSkills,
        mcpServers: this.mcpServers(),
        strictMcpConfig: true,
        settingSources: [],
        hooks: {
          PreToolUse: [
            {
              matcher: 'Write|Edit',
              hooks: [
                async (input: any) => {
                  const toolInput = input.tool_input || {};
                  const target = typeof toolInput.file_path === 'string'
                    ? toolInput.file_path
                    : toolInput.path;
                  if (typeof target !== 'string') {
                    return {
                      continue: true,
                      hookSpecificOutput: {
                        hookEventName: 'PreToolUse' as const,
                        permissionDecision: 'allow' as const,
                      },
                    };
                  }

                  const constrained = this.constrainPath(target);
                  return {
                    continue: true,
                    hookSpecificOutput: {
                      hookEventName: 'PreToolUse' as const,
                      permissionDecision: 'allow' as const,
                      updatedInput: {
                        ...toolInput,
                        file_path: constrained,
                        path: constrained,
                      },
                      additionalContext: `所有生成文件必须保存到项目输出目录：${this.outputDir}`,
                    },
                  };
                },
              ],
            },
            {
              matcher: 'Bash',
              hooks: [
                async (input: any) => {
                  const command = typeof input.tool_input?.command === 'string'
                    ? input.tool_input.command
                    : '';
                  if (this.bashWritesOutside(command)) {
                    return {
                      continue: true,
                      hookSpecificOutput: {
                        hookEventName: 'PreToolUse' as const,
                        permissionDecision: 'deny' as const,
                        permissionDecisionReason: `Bash 不允许把文件写到沙箱工作区之外：${this.outputDir}`,
                      },
                    };
                  }
                  return {
                    continue: true,
                    hookSpecificOutput: {
                      hookEventName: 'PreToolUse' as const,
                      permissionDecision: 'allow' as const,
                    },
                  };
                },
              ],
            },
          ],
        },
        ...(resume ? { resume } : {}),
      },
    });

    try {
      const tryQuery = async (): Promise<Awaited<ReturnType<typeof makeQuery>>> => {
        try {
          return makeQuery(resumeSessionId);
        } catch (e: any) {
          if (resumeSessionId && (e.message?.includes('No conversation found') || e.message?.includes('not found'))) {
            process.stderr.write(`[sandbox] session ${resumeSessionId} not found, starting fresh\n`);
            return makeQuery();
          }
          throw e;
        }
      };

      const q = await tryQuery();
      this.currentQuery = q;

      // Track tool_use blocks by stream index so parallel tool calls keep
      // their input_json_delta fragments separate.
      const toolBlocks = new Map<string, { name: string; id: string; args: string }>();
      const completedTools = new Map<string, { name: string; serverName?: string; skillName?: string; input?: any }>();
      const toolKey = (ev: any) => ev.index != null ? `idx:${ev.index}` : `id:${ev.content_block?.id || ''}`;

      for await (const msg of q) {
        // Capture session ID from any message
        if (!sdkSessionId) {
          sdkSessionId = (msg as any).session_id;
          if (sdkSessionId && !sessionYielded) {
            sessionYielded = true;
            yield { type: 'session', sessionId: sdkSessionId };
          }
        }

        switch (msg.type) {

          // When forwardSubagentText is enabled, subagent turns arrive as
          // assistant messages with a parent tool-use id instead of only as
          // partial stream events. Surface their text as progress without
          // mixing it into the parent agent's final answer.
          case 'assistant': {
            const assistant = msg as any;
            if (assistant.parent_tool_use_id) {
              const blocks = Array.isArray(assistant.message?.content)
                ? assistant.message.content
                : [];
              const text = blocks
                .filter((block: any) => block?.type === 'text' && typeof block.text === 'string')
                .map((block: any) => block.text)
                .join('\n')
                .trim();
              if (text) {
                yield {
                  type: 'subagent_progress',
                  taskId: assistant.task_id,
                  parentToolUseId: assistant.parent_tool_use_id,
                  summary: text,
                  status: 'running',
                };
              }
            }
            continue;
          }

          // ── Structured tool results ──
          case 'user': {
            const um = msg as any;
            if (um.parent_tool_use_id && um.tool_use_result !== undefined) {
              const meta = completedTools.get(um.parent_tool_use_id);
              if (meta?.name === 'Skill') {
                yield {
                  type: 'skill_invoke',
                  skillName: meta.skillName || '',
                  toolId: um.parent_tool_use_id,
                  status: 'result',
                  output: um.tool_use_result,
                };
                completedTools.delete(um.parent_tool_use_id);
              } else if (meta?.serverName) {
                yield {
                  type: 'mcp_call',
                  serverName: meta.serverName,
                  toolName: meta.name,
                  toolId: um.parent_tool_use_id,
                  status: 'result',
                  output: um.tool_use_result,
                };
                completedTools.delete(um.parent_tool_use_id);
              } else if (meta) {
                yield {
                  type: 'tool_end',
                  toolName: meta.name,
                  toolId: um.parent_tool_use_id,
                  toolInput: meta.input,
                  toolResult: um.tool_use_result,
                };
                completedTools.delete(um.parent_tool_use_id);
              }
            }
            continue;
          }

          // ── Raw API streaming events ──
          case 'stream_event': {
            const ev = (msg as any).event;
            if (!ev) continue;

            // Tool_use block start
            if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
              const block = {
                name: ev.content_block.name,
                id: ev.content_block.id,
                args: '',
              };
              toolBlocks.set(toolKey(ev), block);
              if (block.name === 'Skill') {
                yield {
                  type: 'skill_invoke',
                  skillName: '',
                  toolId: block.id,
                  status: 'start',
                  input: {},
                };
              } else if (block.name.startsWith('mcp__')) {
                yield {
                  type: 'mcp_call',
                  serverName: block.name.split('__')[1] || '',
                  toolName: block.name,
                  toolId: block.id,
                  status: 'start',
                  input: {},
                };
              } else {
                yield { type: 'tool_start', toolName: block.name, toolId: block.id, toolInput: {} };
              }
              continue;
            }

            // Tool_use block end → emit accumulated args as toolInput
            if (ev.type === 'content_block_stop') {
              const block = toolBlocks.get(toolKey(ev));
              if (!block) continue;
              let parsed: any = {};
              try { parsed = JSON.parse(block.args); } catch { parsed = {}; }
              if (block.name === 'Skill') {
                yield {
                  type: 'skill_invoke',
                  skillName: parsed.skill_name || parsed.skill || parsed.name || '',
                  toolId: block.id,
                  status: 'update',
                  input: parsed,
                };
              } else if (block.name.startsWith('mcp__')) {
                yield {
                  type: 'mcp_call',
                  serverName: block.name.split('__')[1] || '',
                  toolName: block.name,
                  toolId: block.id,
                  status: 'update',
                  input: parsed,
                };
              } else {
                yield { type: 'tool_update', toolName: block.name, toolId: block.id, toolInput: parsed };
              }
              completedTools.set(block.id, {
                name: block.name,
                serverName: block.name.startsWith('mcp__') ? block.name.split('__')[1] : undefined,
                skillName: parsed.skill_name || parsed.skill || parsed.name || '',
                input: parsed,
              });
              toolBlocks.delete(toolKey(ev));
              continue;
            }

            // Deltas
            if (ev.type === 'content_block_delta') {
              const d = ev.delta;
              if (d?.type === 'thinking_delta' && d.thinking) yield { type: 'thinking', content: d.thinking };
              if (d?.type === 'text_delta' && d.text) yield { type: 'text', content: d.text };
              // Accumulate tool input arguments from streaming JSON
              if (d?.type === 'input_json_delta') {
                const block = toolBlocks.get(toolKey(ev));
                if (block) block.args += d.partial_json || '';
              }
              continue;
            }
            continue;
          }

          // ── Tool progress ──
          case 'tool_progress': {
            const tp = msg as any;
            yield {
              type: 'tool_progress',
              toolName: tp.tool_name,
              toolId: tp.tool_use_id,
              subtype: tp.status || 'running',
              taskId: tp.task_id,
              parentToolUseId: tp.parent_tool_use_id,
            };
            continue;
          }

          // ── Status updates (only if has text content) ──
          case 'system': {
            const sm = msg as any;
            if (sm.subtype === 'init') {
              for (const skill of sm.skills || []) {
                yield { type: 'skill_load', skillName: skill, status: 'ready' };
              }
              for (const mcp of sm.mcp_servers || []) {
                yield { type: 'mcp_status', serverName: mcp.name, status: mcp.status };
              }
            }
            if (sm.subtype === 'task_started') {
              yield {
                type: 'subagent_start',
                taskId: sm.task_id,
                toolId: sm.tool_use_id,
                parentToolUseId: sm.tool_use_id || null,
                description: sm.description,
                subagentType: sm.subagent_type,
                summary: sm.prompt,
                status: 'running',
              };
            } else if (sm.subtype === 'task_progress') {
              yield {
                type: 'subagent_progress',
                taskId: sm.task_id,
                toolId: sm.tool_use_id,
                description: sm.description,
                subagentType: sm.subagent_type,
                summary: sm.summary,
                status: 'running',
                taskUsage: sm.usage,
              };
            } else if (sm.subtype === 'task_notification') {
              yield {
                type: 'subagent_end',
                taskId: sm.task_id,
                toolId: sm.tool_use_id,
                summary: sm.summary,
                outputFile: sm.output_file,
                status: sm.status,
                taskUsage: sm.usage,
              };
            } else if (sm.subtype === 'task_updated') {
              yield {
                type: 'subagent_progress',
                taskId: sm.task_id,
                summary: sm.patch?.error,
                status: sm.patch?.status || 'running',
              };
            }
            const text = typeof sm.text === 'string' ? sm.text : null;
            if (text) yield { type: 'status', content: text, subtype: sm.subtype };
            continue;
          }

          // ── Result ──
          case 'result': {
            const result = msg as any;
            yield { type: 'done', usage: { input_tokens: result.usage?.input_tokens ?? 0, output_tokens: result.usage?.output_tokens ?? 0, total_cost_usd: result.total_cost_usd } };
            continue;
          }

          default:
            continue;
        }
      }
      if (this.stopped) {
        yield { type: 'stopped' };
      }
    } catch (error: any) {
      if (this.stopped) {
        yield { type: 'stopped' };
        return;
      }
      process.stderr.write(`[sandbox] agent SDK error: ${error.message}\n`);
      throw error;
    }
  }
}
