import { v4 as uuidv4 } from 'uuid';

export type MuseEventType =
  | 'run.started'
  | 'reasoning.started'
  | 'reasoning.delta'
  | 'reasoning.completed'
  | 'message.delta'
  | 'message.completed'
  | 'tool.started'
  | 'tool.updated'
  | 'tool.completed'
  | 'tool.failed'
  | 'subagent.started'
  | 'subagent.progress'
  | 'subagent.completed'
  | 'subagent.failed'
  | 'mcp.started'
  | 'mcp.completed'
  | 'mcp.failed'
  | 'skill.loaded'
  | 'skill.invoked'
  | 'command.output'
  | 'ask_user.requested'
  | 'ask_user.resolved'
  | 'status'
  | 'run.completed'
  | 'run.failed'
  | 'run.stopped';

export type MuseEventSource = 'model' | 'agent' | 'tool' | 'mcp' | 'skill' | 'system';

export interface MuseEvent<T = unknown> {
  eventId: string;
  runId: string;
  conversationId: string;
  sequence: number;
  timestamp: string;
  type: MuseEventType;
  source: MuseEventSource;
  parentId?: string;
  payload: T;
}

export function createMuseEvent<T>(input: Omit<MuseEvent<T>, 'eventId' | 'timestamp'>): MuseEvent<T> {
  return {
    ...input,
    eventId: uuidv4(),
    timestamp: new Date().toISOString(),
  };
}
