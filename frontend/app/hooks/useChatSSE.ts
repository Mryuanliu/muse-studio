'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

export interface ToolCall {
  toolName: string;
  toolId: string;
  toolInput?: any;
}

export interface ChatAttachment {
  name: string;
  mimeType: string;
  path: string;
  url: string;
}

/** Chronological event in the assistant's response */
export interface EventLog {
  type: 'thinking' | 'tool_start' | 'tool_update' | 'tool_end' | 'tool_progress' | 'status' | 'command_output'
       | 'text_chunk' | 'skill_load' | 'skill_invoke' | 'mcp_status' | 'mcp_call' | 'ask_user'
       | 'subagent_start' | 'subagent_progress' | 'subagent_end';
  content?: string;
  toolName?: string;
  toolId?: string;
  toolInput?: any;
  toolResult?: any;
  subtype?: string;
  skillName?: string;
  serverName?: string;
  status?: string;
  input?: any;
  output?: any;
  requestId?: string;
  conversationId?: string;
  toolUseID?: string;
  questions?: Array<{
    question: string;
    header?: string;
    options?: Array<{ label: string; description?: string; preview?: string }>;
    multiSelect?: boolean;
  }>;
  answers?: Record<string, string>;
  taskId?: string;
  parentToolUseId?: string | null;
  description?: string;
  subagentType?: string;
  summary?: string;
  outputFile?: string;
  taskUsage?: { total_tokens?: number; tool_uses?: number; duration_ms?: number };
}

export type MuseEventType =
  | 'run.started' | 'reasoning.started' | 'reasoning.delta' | 'reasoning.completed'
  | 'message.delta' | 'message.completed'
  | 'tool.started' | 'tool.updated' | 'tool.completed' | 'tool.failed'
  | 'subagent.started' | 'subagent.progress' | 'subagent.completed' | 'subagent.failed'
  | 'mcp.started' | 'mcp.completed' | 'mcp.failed'
  | 'skill.loaded' | 'skill.invoked'
  | 'command.output'
  | 'ask_user.requested' | 'ask_user.resolved' | 'status'
  | 'run.completed' | 'run.failed' | 'run.stopped';

export interface MuseEvent {
  eventId: string;
  runId: string;
  conversationId: string;
  sequence: number;
  timestamp: string;
  type: MuseEventType;
  source: 'model' | 'agent' | 'tool' | 'mcp' | 'skill' | 'system';
  parentId?: string;
  payload?: Record<string, any>;
}

export interface ChatMessage {
  id?: string;
  role: 'user' | 'assistant';
  /** Final assembled text content */
  content: string;
  /** Chronological event log */
  events?: EventLog[];
  /** Versioned, runtime-independent event log */
  museEvents?: MuseEvent[];
  attachments?: ChatAttachment[];
}

function parseMuseEvents(value: any): MuseEvent[] | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) return value as MuseEvent[];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as MuseEvent[] : undefined;
  } catch {
    return undefined;
  }
}

function parseAttachments(value: any): ChatAttachment[] | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) return value as ChatAttachment[];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as ChatAttachment[] : undefined;
  } catch {
    return undefined;
  }
}

function normalizeMessages(messages: any[]): ChatMessage[] {
  return (messages || []).map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content || '',
    events: eventsFromMuseEvents(parseMuseEvents(m.museEvents)),
    museEvents: parseMuseEvents(m.museEvents),
    attachments: parseAttachments(m.attachments),
  }));
}

function payloadOf(event: MuseEvent): Record<string, any> {
  return event.payload || {};
}

/** Convert the canonical Muse event into the compact view model used by ChatMessage. */
function toViewEvent(event: MuseEvent): EventLog | undefined {
  const payload = payloadOf(event);
  switch (event.type) {
    case 'reasoning.delta':
      return { type: 'thinking', content: payload.content || payload.text || '' };
    case 'message.delta':
      return { type: 'text_chunk', content: payload.content || payload.text || '' };
    case 'tool.started':
      return { type: 'tool_start', toolName: payload.toolName, toolId: payload.toolId, toolInput: payload.toolInput };
    case 'tool.updated':
      return { type: 'tool_update', toolName: payload.toolName, toolId: payload.toolId, toolInput: payload.toolInput, status: payload.status };
    case 'tool.completed':
      return { type: 'tool_end', toolName: payload.toolName, toolId: payload.toolId, toolInput: payload.toolInput, toolResult: payload.toolResult, status: payload.status || 'completed' };
    case 'tool.failed':
      return { type: 'tool_end', toolName: payload.toolName, toolId: payload.toolId, toolInput: payload.toolInput, toolResult: payload.toolResult, status: 'failed' };
    case 'subagent.started':
      return { type: 'subagent_start', ...payload };
    case 'subagent.progress':
      return { type: 'subagent_progress', ...payload };
    case 'subagent.completed':
      return { type: 'subagent_end', ...payload, status: payload.status || 'completed' };
    case 'subagent.failed':
      return { type: 'subagent_end', ...payload, status: payload.status || 'failed' };
    case 'mcp.started':
      return { type: 'mcp_call', ...payload };
    case 'mcp.completed':
      return { type: 'mcp_call', ...payload, status: payload.status || 'result' };
    case 'mcp.failed':
      return { type: 'mcp_call', ...payload, status: payload.status || 'error' };
    case 'skill.loaded':
      return { type: 'skill_load', ...payload };
    case 'skill.invoked':
      return { type: 'skill_invoke', ...payload };
    case 'command.output':
      return { type: 'command_output', content: payload.content };
    case 'ask_user.requested':
      return { type: 'ask_user', ...payload, status: payload.status || 'pending' };
    case 'ask_user.resolved':
      return { type: 'ask_user', ...payload, status: payload.status || 'submitted' };
    case 'status':
      return { type: 'status', content: payload.content, subtype: payload.subtype || payload.status };
    case 'run.completed':
      return { type: 'status', content: payload.summary || '任务已完成', subtype: 'completed' };
    case 'run.failed':
      return { type: 'status', content: payload.message || '任务未正常完成', subtype: 'error' };
    case 'run.stopped':
      return { type: 'status', content: payload.message || '已停止本轮生成', subtype: 'stopped' };
    default:
      return undefined;
  }
}

export function eventsFromMuseEvents(events?: MuseEvent[]): EventLog[] | undefined {
  if (!events?.length) return undefined;
  return [...events]
    .sort((a, b) => a.sequence - b.sequence)
    .map(toViewEvent)
    .filter((event): event is EventLog => Boolean(event));
}

/**
 * SSE hook for the agent run endpoint.
 * Supports both starting a new run and reattaching to a run that is still
 * active after a page refresh. The backend sends a full snapshot first, then
 * streams only the deltas that happened after that snapshot.
 */
export function useChatSSE(opts?: {
  initialMessages?: ChatMessage[];
  initialConversationId?: string;
  initialSdkSessionId?: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(opts?.initialMessages || []);
  const [isStreaming, setIsStreaming] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(opts?.initialConversationId || null);
  const [sdkSessionId, setSdkSessionId] = useState<string | null>(opts?.initialSdkSessionId || null);
  const abortRef = useRef<AbortController | null>(null);

  // Sync when opts change (historical conversation loaded)
  useEffect(() => {
    if (opts?.initialMessages) setMessages(opts.initialMessages);
    if (opts?.initialConversationId) setConversationId(opts.initialConversationId);
    if (opts?.initialSdkSessionId) setSdkSessionId(opts.initialSdkSessionId);
  }, [opts?.initialMessages, opts?.initialConversationId, opts?.initialSdkSessionId]);

  const updateLastAssistant = (updater: (msg: ChatMessage) => ChatMessage) => {
    setMessages((prev) => {
      const arr = [...prev];
      const last = arr[arr.length - 1];
      if (last?.role === 'assistant') arr[arr.length - 1] = updater(last);
      return arr;
    });
  };

  const connectRun = useCallback(async (
    body: {
      prompt?: string;
      conversationId?: string;
      resumeSessionId?: string;
      reattach?: boolean;
      attachments?: ChatAttachment[];
      agentId?: string;
    },
    mode: 'send' | 'attach',
  ) => {
    if (isStreaming) return;

    if (mode === 'send') {
      setMessages((prev) => [...prev, {
        role: 'user',
        content: body.prompt || '',
        attachments: body.attachments,
      }]);
      setMessages((prev) => [...prev, { role: 'assistant', content: '', events: [] }]);
    }
    setIsStreaming(true);

    const abortCtrl = new AbortController();
    abortRef.current = abortCtrl;

    let fullContent = '';
    const applyMuseEvent = (event: MuseEvent) => {
      const viewEvent = toViewEvent(event);
      const payload = payloadOf(event);
      if (event.type === 'message.delta') fullContent += payload.content || payload.text || '';
      if (event.type === 'run.completed' && !fullContent.trim() && payload.summary) {
        fullContent = payload.summary;
      }
      setMessages((prev) => {
        const arr = [...prev];
        const last = arr[arr.length - 1];
        if (last?.role === 'assistant') {
          const museEvents = [...(last.museEvents || [])];
          if (!museEvents.some((item) => item.eventId === event.eventId)) {
            museEvents.push(event);
          }
          arr[arr.length - 1] = {
            ...last,
            museEvents,
            events: viewEvent ? [...(last.events || []), viewEvent] : last.events,
          };
        }
        return arr;
      });
      if (event.type === 'message.delta' || event.type === 'run.completed') {
        updateLastAssistant((msg) => ({ ...msg, content: fullContent }));
      }
    };

    try {
      const res = await fetch('http://localhost:3001/agent/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: abortCtrl.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `HTTP ${res.status}`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buf = '';
      let lastEvent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed.startsWith('event: ')) { lastEvent = trimmed.slice(7); continue; }
          if (!trimmed.startsWith('data: ')) continue;

          const payload = trimmed.slice(6);
          let data: Record<string, any>;
          try { data = JSON.parse(payload); } catch { continue; }

          switch (lastEvent) {
            case 'snapshot': {
              const snapshotMessages = normalizeMessages(data.messages || []);
              const currentSnapshotAssistant = [...snapshotMessages].reverse().find((m) => m.role === 'assistant');
              setMessages(snapshotMessages);
              if (data.conversationId) setConversationId(data.conversationId);
              if (data.sdkSessionId) setSdkSessionId(data.sdkSessionId);
              if (data.messageId) {
                updateLastAssistant((msg) => ({ ...msg, id: data.messageId }));
              }
              fullContent = currentSnapshotAssistant?.content || '';
              break;
            }

            case 'muse_event':
              applyMuseEvent(data as MuseEvent);
              break;

            case 'meta':
              if (data.conversationId) setConversationId(data.conversationId);
              if (data.sdkSessionId) setSdkSessionId(data.sdkSessionId);
              if (data.messageId) updateLastAssistant((msg) => ({ ...msg, id: data.messageId }));
              break;

            case 'heartbeat':
              break;

            case 'done':
              break;

            case 'stopped': {
              break;
            }

            case 'error':
              throw new Error(data.message || 'SSE error');
          }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setMessages((prev) => {
        const arr = [...prev];
        const last = arr[arr.length - 1];
        if (last?.role === 'assistant') arr[arr.length - 1] = { ...last, content: `❌ ${err.message}` };
        return arr;
      });
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [isStreaming]);

  const sendMessage = useCallback(async (
    text: string,
    conversationOverride?: string,
    attachments?: ChatAttachment[],
    agentId?: string,
  ) => {
    if ((!text.trim() && !attachments?.length) || isStreaming) return;
    await connectRun({
      prompt: text,
      conversationId: conversationOverride || conversationId || undefined,
      resumeSessionId: sdkSessionId || undefined,
      attachments,
      agentId,
    }, 'send');
  }, [connectRun, conversationId, sdkSessionId, isStreaming]);

  const attach = useCallback(async (convId: string, sessionId?: string) => {
    if (isStreaming || !convId) return;
    await connectRun({
      conversationId: convId,
      resumeSessionId: sessionId || undefined,
      reattach: true,
    }, 'attach');
  }, [connectRun, isStreaming]);

  const stop = useCallback(async () => {
    abortRef.current?.abort();
    if (!conversationId) return;
    try {
      await fetch('http://localhost:3001/agent/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversationId }),
      });
    } catch {
      // the local SSE stream is already aborted
    }
  }, [conversationId]);

  return { messages, isStreaming, sendMessage, attach, stop, conversationId, sdkSessionId, setConversationId, setMessages };
}
