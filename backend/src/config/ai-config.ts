export interface OpenAICompatibleConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
  reasoningEffort?: 'low' | 'medium' | 'high';
}

const TEAM_ROUTER_BASE_URL = 'https://api.teamorouter.com/v1';
const TEAM_ROUTER_MODEL = 'gpt-5.6-luna';

/** Read the single upstream configuration used by the provider adapter. */
export function getOpenAICompatibleConfig(): OpenAICompatibleConfig {
  return {
    baseUrl: process.env.AI_BASE_URL || TEAM_ROUTER_BASE_URL,
    model: process.env.AI_MODEL || TEAM_ROUTER_MODEL,
    apiKey: process.env.AI_API_KEY || undefined,
    reasoningEffort: parseReasoningEffort(process.env.AI_REASONING_EFFORT || 'medium'),
  };
}

function parseReasoningEffort(value: string): 'low' | 'medium' | 'high' {
  return value === 'low' || value === 'medium' || value === 'high' ? value : 'high';
}

export function getChatCompletionsUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, '')}/chat/completions`;
}

export function getReasoningText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
