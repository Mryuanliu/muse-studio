export interface ProviderRequest {
  model: string;
  messages: any[];
  max_tokens?: number;
  stream?: boolean;
  stream_options?: Record<string, unknown>;
  temperature?: number;
  top_p?: number;
  stop?: string[];
  tools?: any[];
  tool_choice?: any;
  reasoning_effort?: string;
  [key: string]: unknown;
}

export interface ProviderUsage {
  input_tokens: number;
  output_tokens: number;
}

export type ProviderStreamEvent =
  | { type: 'reasoning_delta'; text: string }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call_delta'; index: number; id?: string; name?: string; arguments?: string }
  | { type: 'completed'; reason: string; usage?: ProviderUsage }
  | { type: 'error'; message: string };

export interface ProviderCompletion {
  message: any;
  finishReason: string;
  usage?: ProviderUsage;
}

export interface ProviderAdapter {
  readonly name: string;
  stream(request: ProviderRequest): AsyncIterable<ProviderStreamEvent>;
  complete(request: ProviderRequest): Promise<ProviderCompletion>;
}
