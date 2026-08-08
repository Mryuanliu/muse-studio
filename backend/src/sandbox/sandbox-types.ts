export interface AgentChunk {
  type: 'session' | 'thinking' | 'text' | 'tool_start' | 'tool_update' | 'tool_end'
       | 'tool_progress' | 'status' | 'command_output' | 'done' | 'stopped'
       | 'skill_load' | 'skill_invoke' | 'mcp_status' | 'mcp_call'
       | 'subagent_start' | 'subagent_progress' | 'subagent_end';
  sessionId?: string;
  content?: string;
  toolName?: string;
  toolId?: string;
  toolInput?: any;
  toolResult?: string;
  subtype?: string;
  usage?: { input_tokens: number; output_tokens: number; total_cost_usd?: number };
  skillName?: string;
  serverName?: string;
  status?: string;
  input?: any;
  output?: any;
  taskId?: string;
  parentToolUseId?: string | null;
  description?: string;
  subagentType?: string;
  summary?: string;
  outputFile?: string;
  taskUsage?: { total_tokens?: number; tool_uses?: number; duration_ms?: number };
}

export interface ChatAttachment {
  name: string;
  mimeType: string;
  path: string;
  url: string;
}

export interface SandboxConfig {
  outputDir: string;
  skillsRoot: string;
  mcpDir: string;
  enabledSkills: string[];
  enabledMcps: string[];
  proxyUrl?: string;
  previewTaskId?: string;
  conversationId?: string;
  backendUrl?: string;
  systemPrompt?: string;
  agentId?: string;
  agentType?: 'codegen' | 'other';
  mcpServers?: Record<string, { command: string; args: string[]; env?: Record<string, string> }>;
}
