import { Injectable, Logger } from '@nestjs/common';
import {
  getChatCompletionsUrl,
  getOpenAICompatibleConfig,
  getReasoningText,
} from '../../config/ai-config';
import {
  ProviderAdapter,
  ProviderCompletion,
  ProviderRequest,
  ProviderStreamEvent,
  ProviderUsage,
} from './provider.types';

function usageOf(value: any): ProviderUsage | undefined {
  if (!value) return undefined;
  return {
    input_tokens: value.prompt_tokens ?? value.input_tokens ?? 0,
    output_tokens: value.completion_tokens ?? value.output_tokens ?? 0,
  };
}

function errorMessage(value: any): string {
  return value?.error?.message || value?.message || 'AI upstream error';
}

/** Adapter for OpenAI Chat Completions-compatible providers. */
@Injectable()
export class OpenAICompatibleAdapter implements ProviderAdapter {
  readonly name = 'openai-compatible';
  private readonly logger = new Logger(OpenAICompatibleAdapter.name);
  private readonly config = getOpenAICompatibleConfig();

  private headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.config.apiKey || ''}`,
    };
  }

  private async request(request: ProviderRequest): Promise<Response> {
    const response = await fetch(getChatCompletionsUrl(this.config.baseUrl), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(request),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`AI upstream ${response.status}: ${detail || 'request failed'}`);
    }
    return response;
  }

  async *stream(request: ProviderRequest): AsyncIterable<ProviderStreamEvent> {
    let response: Response;
    try {
      response = await this.request({ ...request, stream: true });
    } catch (error: any) {
      this.logger.error(error.message);
      yield { type: 'error', message: error.message || 'AI upstream error' };
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      yield { type: 'error', message: 'AI upstream returned no body' };
      return;
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let completed = false;
    const emitLine = (line: string): ProviderStreamEvent[] => {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) return [];
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') return [];

      let chunk: any;
      try { chunk = JSON.parse(payload); } catch { return []; }
      if (!chunk.choices && chunk.usage) {
        return completed ? [] : [{ type: 'completed', reason: 'stop', usage: usageOf(chunk.usage) }];
      }

      const choice = chunk.choices?.[0];
      if (!choice) return [];
      const delta = choice.delta || {};
      const events: ProviderStreamEvent[] = [];
      const reasoning = getReasoningText(delta.reasoning_content || delta.reasoning || delta.thinking);
      if (reasoning) events.push({ type: 'reasoning_delta', text: reasoning });
      if (typeof delta.content === 'string' && delta.content) {
        events.push({ type: 'text_delta', text: delta.content });
      }
      for (const call of delta.tool_calls || []) {
        events.push({
          type: 'tool_call_delta',
          index: call.index ?? 0,
          id: call.id,
          name: call.function?.name,
          arguments: call.function?.arguments,
        });
      }
      if (choice.finish_reason) {
        completed = true;
        events.push({ type: 'completed', reason: choice.finish_reason, usage: usageOf(chunk.usage) });
      }
      return events;
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        for (const event of emitLine(line)) {
          if (event.type === 'completed') completed = true;
          yield event;
        }
      }
    }
    if (buffer) {
      for (const event of emitLine(buffer)) {
        if (event.type === 'completed') completed = true;
        yield event;
      }
    }
  }

  async complete(request: ProviderRequest): Promise<ProviderCompletion> {
    const response = await this.request({ ...request, stream: false });
    const data: any = await response.json();
    const choice = data.choices?.[0];
    return {
      message: choice?.message || {},
      finishReason: choice?.finish_reason || 'stop',
      usage: usageOf(data.usage),
    };
  }
}
