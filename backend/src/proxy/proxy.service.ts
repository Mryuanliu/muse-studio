import { Injectable, Logger } from '@nestjs/common';
import { Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';

/* ── Anthropic request type definitions ── */
interface AnthropicBlock {
  type: string;
  text?: string;
  thinking?: string;
  signature?: string;
  name?: string;
  input?: any;
  id?: string;
  tool_use_id?: string;
  content?: any;
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicBlock[];
}

interface AnthropicRequest {
  model: string;
  max_tokens: number;
  messages: AnthropicMessage[];
  system?: string | AnthropicBlock[];
  stream?: boolean;
  temperature?: number;
  stop_sequences?: string[];
  metadata?: Record<string, any>;
  thinking?: { type: 'enabled'; budget_tokens?: number };
  tools?: any[];
  tool_choice?: any;
  top_p?: number;
}

function toOpenAiToolId(id?: string, fallback?: string): string {
  const base = (id || '').replace(/^toolu_/, '').replace(/^call_/, '');
  if (base) return `call_${base}`;
  return fallback || `call_${Math.random().toString(36).slice(2, 10)}`;
}

function toAnthropicToolId(id?: string): string {
  const base = (id || '').replace(/^call_/, '').replace(/^toolu_/, '');
  if (base) return `toolu_${base}`;
  return id || '';
}

/**
 * ProxyService
 *
 * Translates between the Anthropic Messages API format
 * and OpenAI/DeepSeek format in both streaming and non-streaming modes.
 *
 * This lets @anthropic-ai/claude-agent-sdk (or any Anthropic SDK client)
 * believe it's talking to Anthropic when it's actually calling DeepSeek.
 */
@Injectable()
export class ProxyService {
  private readonly logger = new Logger(ProxyService.name);
  private defaultModel: string;
  private logDir: string;

  constructor() {
    this.defaultModel = process.env.DEEPSEEK_MODEL || 'deepseek-reasoner';
    this.logDir = path.resolve(process.env.PROXY_LOG_DIR || './proxy-logs');
    fs.mkdirSync(this.logDir, { recursive: true });
    this.logger.log(`Proxy active — mapping Anthropic API → ${this.defaultModel}`);
    this.logger.log(`Proxy logs → ${this.logDir}`);
    if (!process.env.DEEPSEEK_API_KEY) {
      this.logger.warn('DEEPSEEK_API_KEY is not set! Run: export DEEPSEEK_API_KEY=sk-...');
    }
  }

  /**
   * Log Anthropic → OpenAI request conversion for debugging.
   * Writes a formatted markdown file per request.
   */
  private logConversion(
    req: AnthropicRequest,
    openAiMessages: any[],
    openAiBody: Record<string, unknown>,
    direction: 'stream' | 'non-stream',
  ) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = path.join(this.logDir, `proxy-${timestamp}.md`);

    const anthropicBody: Record<string, any> = {
      model: req.model,
      max_tokens: req.max_tokens,
      stream: direction === 'stream',
      messages: req.messages,
    };
    if (req.system) anthropicBody.system = req.system;
    if (req.tools?.length) {
      anthropicBody.tools = req.tools.map((t: any) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
      }));
    }
    if (req.thinking) anthropicBody.thinking = req.thinking;

    const lines: string[] = [];
    lines.push(`# Proxy Conversion Log`);
    lines.push(`Timestamp: ${new Date().toISOString()}`);
    lines.push(`Direction: ${direction}`);
    lines.push('');
    lines.push('## Anthropic Request (received from SDK)');
    lines.push('```json');
    lines.push(JSON.stringify(anthropicBody, null, 2));
    lines.push('```');
    lines.push('');
    lines.push('## OpenAI / DeepSeek Request (sent to API)');
    lines.push('```json');
    // Show key fields: model, messages, tools, extra_body, stream
    const oaiSummary: Record<string, any> = {
      model: openAiBody.model,
      max_tokens: openAiBody.max_tokens,
      stream: openAiBody.stream,
      messages: openAiMessages,
    };
    if (openAiBody.tools) oaiSummary.tools = openAiBody.tools;
    if (openAiBody.tool_choice) oaiSummary.tool_choice = openAiBody.tool_choice;
    if ((openAiBody as any).extra_body) oaiSummary.extra_body = (openAiBody as any).extra_body;
    lines.push(JSON.stringify(oaiSummary, null, 2));
    lines.push('```');
    lines.push('');

    // Message count comparison
    lines.push('## Message Count Comparison');
    lines.push('');
    lines.push('| | Anthropic | OpenAI |');
    lines.push('|---|---|---|');
    const anthMsgCount = req.messages?.length || 0;
    const oaiMsgCount = openAiMessages?.length || 0;
    lines.push(`| Messages | ${anthMsgCount} | ${oaiMsgCount} |`);
    const anthToolCount = req.tools?.length || 0;
    const oaiToolCount = (openAiBody.tools as any[])?.length || 0;
    lines.push(`| Tool definitions | ${anthToolCount} | ${oaiToolCount} |`);
    lines.push('');

    // Per-message comparison
    lines.push('## Per-Message Comparison');
    lines.push('');
    const anthMsgs = req.messages || [];
    for (let i = 0; i < Math.max(anthMsgs.length, openAiMessages.length); i++) {
      lines.push(`### Message ${i}`);
      lines.push('');
      lines.push('**Anthropic:**');
      lines.push('```json');
      lines.push(JSON.stringify(anthMsgs[i] || '(missing)', null, 2));
      lines.push('```');
      lines.push('');
      lines.push('**OpenAI:**');
      lines.push('```json');
      lines.push(JSON.stringify(openAiMessages[i] || '(missing)', null, 2));
      lines.push('```');
      lines.push('');
    }

    fs.writeFileSync(filePath, lines.join('\n'), 'utf-8');
    this.logger.debug(`Conversion log written: ${filePath}`);
  }

  // ──────────────────────────────────────────────
  //  PUBLIC: Streaming entry-point
  // ──────────────────────────────────────────────

  async streamMessage(req: AnthropicRequest, res: Response): Promise<void> {
    const msgId = `msg_${uuidv4().replace(/-/g, '').slice(0, 24)}`;
    const dsMessages = this.toOpenAI(req);
    const useThinking = !!req.thinking || /reasoner|thinking/.test(this.defaultModel);

    let msgStarted = false;
    let streamEnded = false;
    let blockIdx = 0;
    let inThink = false;
    let inText = false;
    // Tool call tracking: OAI tool_call_index → accumulated state
    const pendingTools = new Map<number, { id: string; name: string; args: string; blockIndex: number }>();
    let fullThink = '';

    const sse = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const closeThinkingBlock = () => {
      if (!inThink) return;
      sse('content_block_stop', { type: 'content_block_stop', index: blockIdx });
      blockIdx++;
      inThink = false;
      const sig = `proxy:${Buffer.from(fullThink.slice(0, 32)).toString('base64').slice(0, 32)}`;
      sse('content_block_start', { type: 'content_block_start', index: blockIdx, content_block: { type: 'signature', signature: sig } });
      sse('content_block_stop', { type: 'content_block_stop', index: blockIdx });
      blockIdx++;
    };

    const closeTextBlock = () => {
      if (!inText) return;
      sse('content_block_stop', { type: 'content_block_stop', index: blockIdx });
      blockIdx++;
      inText = false;
    };

    const closePendingToolBlocks = () => {
      for (const tool of pendingTools.values()) {
        sse('content_block_stop', { type: 'content_block_stop', index: tool.blockIndex });
      }
      pendingTools.clear();
    };

    try {
      // Build the DeepSeek request body
      const body: Record<string, unknown> = {
        model: this.defaultModel,
        messages: dsMessages,
        max_tokens: req.max_tokens || 4096,
        stream: true,
        stream_options: { include_usage: true },
      };
      if (req.temperature !== undefined) body.temperature = req.temperature;
      if (req.stop_sequences?.length) body.stop = req.stop_sequences;
      if (req.top_p !== undefined) body.top_p = req.top_p;
      if (useThinking) body.extra_body = { thinking_mode: process.env.DEEPSEEK_THINKING_MODE || 'thinking' };

      // ── Convert Anthropic tools → OpenAI functions ──
      if (req.tools?.length) {
        body.tools = req.tools.map((t: any) => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description || '',
            parameters: t.input_schema || { type: 'object', properties: {} },
          },
        }));
      }
      if (req.tool_choice) {
        body.tool_choice = this.mapToolChoice(req.tool_choice);
      }

      // Log the format conversion (non-critical, wrap in try-catch)
      try { this.logConversion(req, dsMessages, body, 'stream'); } catch (e: any) { this.logger.warn(`logConversion failed: ${e.message}`); }

      // Use raw fetch to sidestep OpenAI SDK typing issues with extra_body
      const raw = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify(body),
      });

      if (!raw.ok) {
        const errText = await raw.text().catch(() => 'unknown');
        throw new Error(`DeepSeek API ${raw.status}: ${errText}`);
      }

      const reader = raw.body?.getReader();
      if (!reader) throw new Error('DeepSeek returned no body');

      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });

        // Split SSE stream on double newlines
        const lines = buf.split('\n');
        buf = lines.pop() || ''; // keep incomplete fragment

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data: ')) continue;

          const payload = trimmed.slice(6);
          if (payload === '[DONE]') continue;

          let chunk: Record<string, any>;
          try { chunk = JSON.parse(payload); } catch { continue; }

          // ── Token-usage-only chunk (end of stream) ──
          if (!chunk.choices && chunk.usage) {
            if (streamEnded) continue; // already finished via finish_reason
            closePendingToolBlocks();
            closeTextBlock();
            closeThinkingBlock();
            sse('message_delta', {
              type: 'message_delta',
              delta: { stop_reason: 'end_turn', stop_sequence: null },
              usage: { input_tokens: chunk.usage.prompt_tokens ?? 0, output_tokens: chunk.usage.completion_tokens ?? 0 },
            });
            sse('message_stop', { type: 'message_stop' });
            continue;
          }

          const choice = chunk.choices?.[0];
          if (!choice) continue;
          const delta = choice.delta || {};
          const finish = choice.finish_reason;
          const rc = (delta as any).reasoning_content;

          // ── message_start ──
          if (!msgStarted) {
            msgStarted = true;
            sse('message_start', {
              type: 'message_start',
              message: { id: msgId, type: 'message', role: 'assistant', content: [], model: req.model, stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } },
            });
          }

          // ── Thinking block ──
          if (rc && rc.length > 0) {
            if (!inThink) {
              sse('content_block_start', { type: 'content_block_start', index: blockIdx, content_block: { type: 'thinking', thinking: '' } });
              inThink = true;
            }
            fullThink += rc;
            sse('content_block_delta', { type: 'content_block_delta', index: blockIdx, delta: { type: 'thinking_delta', thinking: rc } });
          }

          // ── Text block ──
          if (delta.content && delta.content.length > 0) {
            if (inThink) {
              closeThinkingBlock();
              closePendingToolBlocks();
              sse('content_block_start', { type: 'content_block_start', index: blockIdx, content_block: { type: 'text', text: '' } });
              inText = true;
            } else if (!inText) {
              closePendingToolBlocks();
              sse('content_block_start', { type: 'content_block_start', index: blockIdx, content_block: { type: 'text', text: '' } });
              inText = true;
            }
            sse('content_block_delta', { type: 'content_block_delta', index: blockIdx, delta: { type: 'text_delta', text: delta.content } });
          }

          // ── Tool calls (OpenAI tool_calls → Anthropic tool_use blocks) ──
          const toolCalls = (delta as any).tool_calls;
          if (toolCalls?.length) {
            for (const tc of toolCalls) {
              const idx = tc.index ?? 0;
              const existing = pendingTools.get(idx);
              if (tc.id && !existing) {
                // New tool call — start a tool_use content block
                closeThinkingBlock();
                closeTextBlock();
                // Map call_xxx → toolu_xxx
                const toolUseId = toAnthropicToolId(tc.id);
                const blockIndex = blockIdx;
                pendingTools.set(idx, { id: toolUseId, name: tc.function?.name || '', args: '', blockIndex });
                sse('content_block_start', {
                  type: 'content_block_start',
                  index: blockIndex,
                  content_block: { type: 'tool_use', id: toolUseId, name: tc.function?.name || '', input: {} },
                });
                blockIdx++;
              } else if (tc.id && existing) {
                if (tc.function?.name) existing.name = tc.function.name;
              }
              const pendingTool = existing || pendingTools.get(idx);
              if (pendingTool && tc.function?.arguments) {
                pendingTool.args += tc.function.arguments;
                sse('content_block_delta', {
                  type: 'content_block_delta',
                  index: pendingTool.blockIndex,
                  delta: { type: 'input_json_delta', partial_json: tc.function.arguments },
                });
              }
            }
          }

          // ── Finish ──
          if (finish) {
            closePendingToolBlocks();
            closeThinkingBlock();
            closeTextBlock();
            // Always send message_delta/message_stop on finish.
            // The usage-only chunk (if it arrives later) is a duplicate but harmless.
            sse('message_delta', {
              type: 'message_delta',
              delta: { stop_reason: this.finishMap(finish), stop_sequence: null },
              usage: { input_tokens: chunk.usage?.prompt_tokens ?? 0, output_tokens: chunk.usage?.completion_tokens ?? 0 },
            });
            sse('message_stop', { type: 'message_stop' });
            streamEnded = true;
          }
        }
      }

      // Guard: close any dangling blocks if stream ended without proper events
      closeThinkingBlock();
      closePendingToolBlocks();
      closeTextBlock();
      res.end();
    } catch (err: any) {
      this.logger.error('Streaming error:', err.message);
      if (!res.headersSent) {
        res.status(500).json({ type: 'error', error: { type: 'api_error', message: err.message || 'DeepSeek API error' } });
        return;
      }
      try { sse('error', { type: 'error', error: { type: 'api_error', message: err.message } }); } catch { /* closed */ }
      res.end();
    }
  }

  // ──────────────────────────────────────────────
  //  PUBLIC: Non‑streaming entry-point
  // ──────────────────────────────────────────────

  async sendMessage(req: AnthropicRequest): Promise<any> {
    const msgId = `msg_${uuidv4().replace(/-/g, '').slice(0, 24)}`;
    const dsMessages = this.toOpenAI(req);
    const useThinking = !!req.thinking || /reasoner|thinking/.test(this.defaultModel);

    const body: Record<string, unknown> = {
      model: this.defaultModel,
      messages: dsMessages,
      max_tokens: req.max_tokens || 4096,
    };
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.stop_sequences?.length) body.stop = req.stop_sequences;
    if (req.top_p !== undefined) body.top_p = req.top_p;
    if (useThinking) body.extra_body = { thinking_mode: process.env.DEEPSEEK_THINKING_MODE || 'thinking' };

    // ── Convert tools for non-streaming ──
    if (req.tools?.length) {
      body.tools = req.tools.map((t: any) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description || '',
          parameters: t.input_schema || { type: 'object', properties: {} },
        },
      }));
    }
    if (req.tool_choice) body.tool_choice = this.mapToolChoice(req.tool_choice);

    try { this.logConversion(req, dsMessages, body, 'non-stream'); } catch (e: any) { this.logger.warn(`logConversion failed: ${e.message}`); }

    try {
      const raw = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify(body),
      });

      if (!raw.ok) {
        const errText = await raw.text().catch(() => 'unknown');
        throw new Error(`DeepSeek API ${raw.status}: ${errText}`);
      }

      const data: any = await raw.json();
      const choice = data.choices?.[0];
      const msg = choice?.message || {};
      const rc: string = msg.reasoning_content || '';
      const fr = choice?.finish_reason || 'stop';

      const content: AnthropicBlock[] = [];
      if (rc) {
        content.push({ type: 'thinking', thinking: rc });
        content.push({ type: 'signature', signature: `proxy:${Buffer.from(rc.slice(0, 32)).toString('base64').slice(0, 32)}` });
      }
      // Convert OpenAI tool_calls → Anthropic tool_use blocks
      for (const tc of (msg.tool_calls || [])) {
        let args: any = {};
        try { args = JSON.parse(tc.function?.arguments || '{}'); } catch { args = {}; }
        content.push({
          type: 'tool_use',
          id: toAnthropicToolId(tc.id),
          name: tc.function?.name || '',
          input: args,
        });
      }
      content.push({ type: 'text', text: msg.content || '' });

      return {
        id: msgId,
        type: 'message',
        role: 'assistant',
        content,
        model: req.model,
        stop_reason: this.finishMap(fr),
        stop_sequence: null,
        usage: { input_tokens: data.usage?.prompt_tokens ?? 0, output_tokens: data.usage?.completion_tokens ?? 0 },
      };
    } catch (err: any) {
      this.logger.error('Non-streaming error:', err.message);
      throw err;
    }
  }

  // ──────────────────────────────────────────────
  //  PRIVATE helpers
  // ──────────────────────────────────────────────

  /** Convert Anthropic message list → OpenAI message list. */
  private toOpenAI(req: AnthropicRequest): any[] {
    const out: any[] = [];
    // system prompt
    if (req.system) {
      const txt = this.textOf(req.system);
      if (txt) out.push({ role: 'system', content: txt });
    }

    // Track tool_call_id mapping: toolu_xxx → call_xxx
    let toolCallIdCounter = 0;

    for (const m of req.messages) {
      const blocks = typeof m.content === 'string'
        ? [{ type: 'text', text: m.content }]
        : Array.isArray(m.content)
          ? m.content
          : [];

      if (m.role === 'user') {
        // Check if this is a tool_result message
        const toolResults = blocks.filter((b) => b.type === 'tool_result');
        const textBlocks = blocks.filter((b) => b.type === 'text');

        if (toolResults.length > 0) {
          // Each tool_result → separate 'tool' role message
          for (const tr of toolResults) {
            const trContent = typeof tr.content === 'string' ? tr.content
              : Array.isArray(tr.content)
                ? tr.content.map((c: any) => c.text || '').join('\n')
                : typeof tr.content === 'object' && tr.content !== null
                  ? JSON.stringify(tr.content)
                  : '';
            // Map toolu_xxx to call_xxx
            const callId = toOpenAiToolId(tr.tool_use_id);
            out.push({ role: 'tool', tool_call_id: callId, content: trContent });
          }
          // OpenAI cannot attach free text to tool_result messages, so emit it
          // as a separate user turn after the tool results. Claude Code's
          // synthetic "Continue from where you left off." is a no-op for
          // DeepSeek and only encourages a premature stop.
          const text = textBlocks.map((b) => b.text || '').join('\n');
          if (text && text.trim() !== 'Continue from where you left off.') {
            out.push({ role: 'user', content: text });
          }
        } else {
          // Regular user message
          out.push({ role: 'user', content: this.textOf(m.content) || '' });
        }
      } else {
        // Assistant message — can have text, thinking, and tool_use blocks
        let text = '';
        let rc = '';
        const toolCalls: any[] = [];

        for (const b of blocks) {
          if (b.type === 'text' && b.text) text += b.text;
          else if (b.type === 'thinking' && b.thinking) rc += b.thinking;
          else if (b.type === 'tool_use' && b.name) {
            // Anthropic tool_use → OpenAI tool_call
            toolCallIdCounter++;
            const callId = toOpenAiToolId(b.id, `call_${toolCallIdCounter}`);
            toolCalls.push({
              id: callId,
              type: 'function',
              function: {
                name: b.name,
                arguments: JSON.stringify(b.input || {}),
              },
            });
          }
        }

        if (toolCalls.length > 0) {
          // OpenAI expects content: null when tool_calls are present
          const msg: any = { role: 'assistant', content: text || null, tool_calls: toolCalls };
          if (rc) msg.reasoning_content = rc;
          out.push(msg);
        } else if (rc) {
          out.push({ role: 'assistant', content: text || ' ', reasoning_content: rc });
        } else {
          const trimmed = text.trim();
          if (trimmed && trimmed !== 'No response requested.') {
            out.push({ role: 'assistant', content: text || ' ' });
          } else if (!trimmed) {
            out.push({ role: 'assistant', content: ' ' });
          }
        }
      }
    }
    return out;
  }

  /** Anthropic tool_choice → OpenAI tool_choice. */
  private mapToolChoice(tc: any): any {
    if (!tc || tc.type === 'auto') return 'auto';
    if (tc.type === 'any' || tc.type === 'required') return 'required';
    if (tc.type === 'tool' && tc.name) {
      return { type: 'function', function: { name: tc.name } };
    }
    return 'auto';
  }

  /** Extract plain text from Anthropic content (string | block[]). */
  private textOf(c: string | AnthropicBlock[]): string {
    if (typeof c === 'string') return c;
    return c.filter(b => b.type === 'text').map(b => b.text || '').join('\n');
  }

  /** OpenAI finish_reason → Anthropic stop_reason. */
  private finishMap(r: string | null): string {
    switch (r) {
      case 'stop': return 'end_turn';
      case 'length': return 'max_tokens';
      case 'content_filter': return 'content_filtered';
      case 'tool_calls': return 'tool_use';
      case 'function_call': return 'tool_use';
      default: return 'end_turn';
    }
  }
}
