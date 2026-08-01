import { Injectable, Logger } from '@nestjs/common';
import { query } from '@anthropic-ai/claude-agent-sdk';
import * as path from 'path';
import * as fs from 'fs';
import { resolveOutputDir } from '../output-dir';
import { GAME_SYSTEM_PROMPT } from './game-system-prompt';

export interface AgentChunk {
  type: 'session' | 'thinking' | 'text' | 'tool_start' | 'tool_update' | 'tool_end'
       | 'tool_progress' | 'status' | 'command_output' | 'done';
  sessionId?: string;
  content?: string;
  toolName?: string;
  toolId?: string;
  /** partial JSON for tool_update, full object for tool_end */
  toolInput?: any;
  toolResult?: string;
  subtype?: string;
  usage?: { input_tokens: number; output_tokens: number; total_cost_usd?: number };
}

@Injectable()
export class AgentSdkService {
  private readonly logger = new Logger(AgentSdkService.name);
  private outputDir: string;

  constructor() {
    this.outputDir = resolveOutputDir();
    fs.mkdirSync(this.outputDir, { recursive: true });
    this.logger.log(`Output directory: ${this.outputDir}`);
  }

  getOutputDir(): string {
    return this.outputDir;
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

  async *run(
    prompt: string,
    resumeSessionId?: string,
  ): AsyncGenerator<AgentChunk, void, undefined> {
    this.logger.log(`Agent SDK run: "${prompt.slice(0, 60)}..."${resumeSessionId ? ' (resume)' : ''}`);

    let sdkSessionId: string | undefined;
    let sessionYielded = false;

    const makeQuery = (resume?: string) => query({
      prompt,
      options: {
        env: {
          ...process.env as Record<string, string>,
          ANTHROPIC_BASE_URL: 'http://localhost:3001',
          ANTHROPIC_API_KEY: 'test-key',
        },
        cwd: this.outputDir,
        tools: { type: 'preset', preset: 'claude_code' },
        // Max API round-trips (model → tool_use → tool_result → model...).
        // Each Write/Bash/Read call counts as one turn. Override via MAX_TURNS env.
        maxTurns: parseInt(process.env.MAX_TURNS || '100', 10),
        permissionMode: 'bypassPermissions',
        includePartialMessages: true,
        systemPrompt: {
          type: 'preset',
          preset: 'claude_code',
          append: GAME_SYSTEM_PROMPT,
        },
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
                        permissionDecisionReason: 'Bash 不允许把文件写到 h5-output 目录之外',
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
            this.logger.warn(`Session ${resumeSessionId} not found, starting fresh`);
            return makeQuery();
          }
          throw e;
        }
      };

      const q = await tryQuery();

      // Track tool_use blocks by stream index so parallel tool calls keep
      // their input_json_delta fragments separate.
      const toolBlocks = new Map<string, { name: string; id: string; args: string }>();
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

          // ── Raw API streaming events ──
          case 'stream_event': {
            const ev = (msg as any).event;
            if (!ev) continue;

            // Tool_use block start
            if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
              toolBlocks.set(toolKey(ev), {
                name: ev.content_block.name,
                id: ev.content_block.id,
                args: '',
              });
              yield { type: 'tool_start', toolName: ev.content_block.name, toolId: ev.content_block.id, toolInput: {} };
              continue;
            }

            // Tool_use block end → emit accumulated args as toolInput
            if (ev.type === 'content_block_stop') {
              const block = toolBlocks.get(toolKey(ev));
              if (!block) continue;
              let parsed: any = {};
              try { parsed = JSON.parse(block.args); } catch { parsed = {}; }
              yield { type: 'tool_update', toolName: block.name, toolId: block.id, toolInput: parsed };
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
            yield { type: 'tool_progress', toolName: tp.tool_name, toolId: tp.tool_use_id, subtype: tp.status || 'running' };
            continue;
          }

          // ── Status updates (only if has text content) ──
          case 'system': {
            const sm = msg as any;
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
    } catch (error: any) {
      this.logger.error('Agent SDK error:', error.message);
      throw error;
    }
  }
}
