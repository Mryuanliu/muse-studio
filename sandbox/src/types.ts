export interface AgentChunk {
  type: 'session' | 'thinking' | 'text' | 'tool_start' | 'tool_update' | 'tool_end'
       | 'tool_progress' | 'status' | 'command_output' | 'done'
       | 'skill_load' | 'skill_invoke' | 'mcp_status' | 'mcp_call';
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
}

export interface SandboxConfig {
  outputDir: string;
  skillsRoot: string;
  mcpDir: string;
  enabledSkills: string[];
  enabledMcps: string[];
  proxyUrl?: string;
  previewTaskId?: string;
}
