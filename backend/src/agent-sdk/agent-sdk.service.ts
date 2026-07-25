import { Injectable, Logger } from '@nestjs/common';
import { query } from '@anthropic-ai/claude-agent-sdk';
import * as path from 'path';
import * as fs from 'fs';

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
    this.outputDir = path.resolve(process.env.OUTPUT_DIR || './h5-output');
    fs.mkdirSync(this.outputDir, { recursive: true });
    this.logger.log(`Output directory: ${this.outputDir}`);
  }

  getOutputDir(): string {
    return this.outputDir;
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

      // Track current tool_use block for accumulating input_json_delta
      let currentToolUse: { name: string; id: string; args: string } | null = null;

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
              currentToolUse = { name: ev.content_block.name, id: ev.content_block.id, args: '' };
              yield { type: 'tool_start', toolName: ev.content_block.name, toolId: ev.content_block.id, toolInput: {} };
              continue;
            }

            // Tool_use block end → emit accumulated args as toolInput
            if (ev.type === 'content_block_stop' && currentToolUse) {
              let parsed: any = {};
              try { parsed = JSON.parse(currentToolUse.args); } catch { parsed = {}; }
              yield { type: 'tool_update', toolName: currentToolUse.name, toolId: currentToolUse.id, toolInput: parsed };
              currentToolUse = null;
              continue;
            }

            // Deltas
            if (ev.type === 'content_block_delta') {
              const d = ev.delta;
              if (d?.type === 'thinking_delta' && d.thinking) yield { type: 'thinking', content: d.thinking };
              if (d?.type === 'text_delta' && d.text) yield { type: 'text', content: d.text };
              // Accumulate tool input arguments from streaming JSON
              if (d?.type === 'input_json_delta' && currentToolUse) {
                currentToolUse.args += d.partial_json || '';
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
