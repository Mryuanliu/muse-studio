import { Injectable } from '@nestjs/common';
import { AgentChunk } from '../sandbox/sandbox-types';
import { createMuseEvent, MuseEvent, MuseEventType, MuseEventSource } from './muse-event.types';

function eventSource(type: string): MuseEventSource {
  if (type.startsWith('mcp_')) return 'mcp';
  if (type.startsWith('skill_')) return 'skill';
  if (type.startsWith('tool_')) return 'tool';
  if (type.startsWith('subagent_')) return 'agent';
  if (type === 'thinking' || type === 'text') return 'model';
  return 'system';
}

function eventType(type: string, status?: string): MuseEventType | undefined {
  const map: Record<string, MuseEventType> = {
    thinking: 'reasoning.delta',
    text: 'message.delta',
    tool_start: 'tool.started',
    tool_update: 'tool.updated',
    tool_end: 'tool.completed',
    tool_progress: 'tool.updated',
    subagent_start: 'subagent.started',
    subagent_progress: 'subagent.progress',
    subagent_end: ['failed', 'stopped', 'killed'].includes(status || '') ? 'subagent.failed' : 'subagent.completed',
    mcp_status: ['error', 'failed'].includes(status || '') ? 'mcp.failed' : 'mcp.started',
    mcp_call: ['error', 'failed'].includes(status || '') ? 'mcp.failed' : status === 'result' ? 'mcp.completed' : 'mcp.started',
    skill_load: 'skill.loaded',
    skill_invoke: 'skill.invoked',
    command_output: 'command.output',
    status: 'status',
  };
  return map[type];
}

/** Converts runtime-specific AgentChunk values into the public Muse protocol. */
@Injectable()
export class MuseEventNormalizer {
  normalize(chunk: AgentChunk, context: { runId: string; conversationId: string; sequence: number }): MuseEvent | undefined {
    const type = eventType(chunk.type, chunk.status || chunk.subtype);
    if (!type) return undefined;
    const payload = { ...chunk } as Record<string, unknown>;
    delete payload.type;
    return createMuseEvent({
      runId: context.runId,
      conversationId: context.conversationId,
      sequence: context.sequence,
      type,
      source: eventSource(chunk.type),
      parentId: chunk.parentToolUseId || chunk.toolId,
      payload,
    });
  }

  lifecycle(input: {
    type: 'run.started' | 'run.completed' | 'run.failed' | 'run.stopped' | 'reasoning.started' | 'reasoning.completed' | 'message.completed' | 'status' | 'ask_user.requested' | 'ask_user.resolved';
    runId: string;
    conversationId: string;
    sequence: number;
    payload?: unknown;
  }): MuseEvent {
    return createMuseEvent({
      runId: input.runId,
      conversationId: input.conversationId,
      sequence: input.sequence,
      type: input.type,
      source: input.type.startsWith('run.') || input.type === 'status' ? 'system' : 'model',
      payload: input.payload || {},
    });
  }
}
