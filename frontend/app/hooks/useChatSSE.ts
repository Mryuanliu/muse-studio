'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

export interface ToolCall {
  toolName: string;
  toolId: string;
  toolInput?: any;
}

/** Chronological event in the assistant's response */
export interface EventLog {
  type: 'thinking' | 'tool_start' | 'tool_update' | 'tool_end' | 'tool_progress' | 'status' | 'command_output'
       | 'text_chunk' | 'skill_load' | 'skill_invoke' | 'mcp_status' | 'mcp_call';
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
}

export interface ChatMessage {
  id?: string;
  role: 'user' | 'assistant';
  /** Final assembled text content */
  content: string;
  /** Full thinking chain (for collapsible display) */
  thinkingChain?: string;
  /** Chronological event log */
  events?: EventLog[];
}

function parseEvents(value: any): EventLog[] | undefined {
  if (!value) return undefined;
  if (Array.isArray(value)) return value as EventLog[];
  try {
    return JSON.parse(value) as EventLog[];
  } catch {
    return undefined;
  }
}

function normalizeMessages(messages: any[]): ChatMessage[] {
  return (messages || []).map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content || '',
    thinkingChain: m.thinkingChain || undefined,
    events: parseEvents(m.events),
  }));
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

  const pushEvent = (ev: EventLog) => {
    setMessages((prev) => {
      const arr = [...prev];
      const last = arr[arr.length - 1];
      if (last?.role === 'assistant') {
        arr[arr.length - 1] = {
          ...last,
          events: [...(last.events || []), ev],
        };
      }
      return arr;
    });
  };

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
    },
    mode: 'send' | 'attach',
  ) => {
    if (isStreaming) return;

    if (mode === 'send') {
      setMessages((prev) => [...prev, { role: 'user', content: body.prompt || '' }]);
      setMessages((prev) => [...prev, { role: 'assistant', content: '', events: [] }]);
    }
    setIsStreaming(true);

    const abortCtrl = new AbortController();
    abortRef.current = abortCtrl;

    let fullContent = '';
    let fullThinking = '';

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
              setMessages(snapshotMessages);
              if (data.conversationId) setConversationId(data.conversationId);
              if (data.sdkSessionId) setSdkSessionId(data.sdkSessionId);
              if (data.messageId) {
                updateLastAssistant((msg) => ({ ...msg, id: data.messageId }));
              }
              const currentAssistant = [...snapshotMessages].reverse().find((m) => m.role === 'assistant');
              fullContent = currentAssistant?.content || '';
              fullThinking = currentAssistant?.thinkingChain || '';
              break;
            }

            case 'meta':
              if (data.conversationId) setConversationId(data.conversationId);
              if (data.sdkSessionId) setSdkSessionId(data.sdkSessionId);
              if (data.messageId) updateLastAssistant((msg) => ({ ...msg, id: data.messageId }));
              break;

            case 'thinking':
              fullThinking += data.content || '';
              pushEvent({ type: 'thinking', content: data.content });
              updateLastAssistant((msg) => ({ ...msg, thinkingChain: fullThinking }));
              break;

            case 'text':
              fullContent += data.content || '';
              pushEvent({ type: 'text_chunk', content: data.content });
              updateLastAssistant((msg) => ({ ...msg, content: fullContent, thinkingChain: fullThinking }));
              break;

            case 'tool_start':
              pushEvent({ type: 'tool_start', toolName: data.toolName, toolId: data.toolId, toolInput: data.toolInput });
              break;

            case 'tool_update':
              // Replace last tool_start's toolInput with final parsed input
              setMessages((prev) => {
                const arr = [...prev];
                const last = arr[arr.length - 1];
                if (last?.role === 'assistant' && last.events) {
                  const evts = [...last.events];
                  for (let i = evts.length - 1; i >= 0; i--) {
                    if (evts[i].type === 'tool_start' && evts[i].toolId === data.toolId) {
                      evts[i] = { ...evts[i], toolInput: data.toolInput };
                      break;
                    }
                  }
                  arr[arr.length - 1] = { ...last, events: evts };
                }
                return arr;
              });
              break;

            case 'tool_progress':
              pushEvent({ type: 'tool_progress', toolName: data.toolName, toolId: data.toolId, subtype: data.status });
              break;

            case 'tool_end':
              pushEvent({ type: 'tool_end', toolName: data.toolName, toolId: data.toolId, toolInput: data.toolInput, toolResult: data.toolResult });
              break;

            case 'skill_load':
              pushEvent({ type: 'skill_load', skillName: data.skillName, status: data.status });
              break;

            case 'skill_invoke':
              pushEvent({ type: 'skill_invoke', skillName: data.skillName, toolId: data.toolId, status: data.status, input: data.input });
              break;

            case 'mcp_status':
              pushEvent({ type: 'mcp_status', serverName: data.serverName, status: data.status });
              break;

            case 'mcp_call':
              pushEvent({ type: 'mcp_call', serverName: data.serverName, toolName: data.toolName, toolId: data.toolId, status: data.status, input: data.input });
              break;

            case 'status':
              pushEvent({ type: 'status', content: data.content, subtype: data.subtype });
              break;

            case 'command_output':
              pushEvent({ type: 'command_output', content: data.content });
              break;

            case 'done':
              updateLastAssistant((msg) => ({ ...msg, content: fullContent, thinkingChain: fullThinking }));
              break;

            case 'stopped': {
              const stopText = data.content || '已停止本轮生成';
              fullContent += `\n\n${stopText}`;
              pushEvent({ type: 'status', content: stopText, subtype: 'stopped' });
              updateLastAssistant((msg) => ({ ...msg, content: fullContent, thinkingChain: fullThinking }));
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

  const sendMessage = useCallback(async (text: string, conversationOverride?: string) => {
    if (!text.trim() || isStreaming) return;
    await connectRun({
      prompt: text,
      conversationId: conversationOverride || conversationId || undefined,
      resumeSessionId: sdkSessionId || undefined,
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

  return { messages, isStreaming, sendMessage, attach, stop, conversationId, setConversationId, setMessages };
}
