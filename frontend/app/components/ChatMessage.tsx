'use client';

import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatMessage as ChatMessageType, EventLog } from '../hooks/useChatSSE';
import TodoList, { buildTodoItems } from './messages/TodoList';

interface Props {
  message: ChatMessageType;
  isStreaming: boolean;
}

/* ── Icons ── */
function toolEmoji(name: string): string {
  if (name === 'Skill') return '⚡';
  if (name?.startsWith('mcp__')) return '🔌';
  if (/bash|sh|shell|command|exec/i.test(name)) return '💻';
  if (/write|Write/i.test(name)) return '📄';
  if (/read|Read|grep|Glob/i.test(name)) return '📖';
  if (/task|Task/i.test(name)) return '📋';
  if (/search|web/i.test(name)) return '🔍';
  if (/fetch|curl/i.test(name)) return '🌐';
  if (/ask|question/i.test(name)) return '💬';
  if (/edit|Edit/i.test(name)) return '✏️';
  return '🔧';
}

function toolName(name: string): string {
  // Add spaces before uppercase letters for CamelCase names
  return name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2');
}

/* ── Format tool input for display ── */
function formatToolInput(toolName: string, input: any): string {
  if (!input) return '';
  switch (toolName) {
    case 'Bash':
    case 'bash':
      return input.command || input.script || '';
    case 'Write':
    case 'write':
      return input.file_path || input.path || '';
    case 'Read':
    case 'read':
      return input.file_path || input.path || '';
    case 'Edit':
    case 'edit':
      return input.file_path || input.pattern || '';
    case 'TaskCreate':
      return input.title || input.description || '';
    case 'WebSearch':
      return input.query || '';
    case 'WebFetch':
      return input.url || '';
    default:
      const simple = JSON.stringify(input);
      return simple.length > 200 ? simple.slice(0, 200) + '…' : simple;
  }
}

/** Merge consecutive streaming deltas into one displayable thinking/text block. */
function coalesceEvents(events: EventLog[]): EventLog[] {
  const out: EventLog[] = [];
  for (const ev of events) {
    if (ev.type === 'thinking' || ev.type === 'text_chunk') {
      const content = ev.content || '';
      if (!content) continue;
      const last = out[out.length - 1];
      if (last?.type === ev.type) {
        last.content += content;
      } else {
        out.push({ ...ev, content });
      }
    } else {
      out.push(ev);
    }
  }
  return out;
}

/**
 * Older messages only persisted thinkingChain + tool events. Split the chain
 * into likely per-turn segments so those tasks still read as an interleaved
 * sequence instead of one giant thinking block.
 */
function splitLegacyThinking(chain?: string, desiredSegments = 1): string[] {
  const text = chain?.trim();
  if (!text) return [];

  const paragraphs: string[] = text
    .split(/\n\s*\n+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (paragraphs.length <= 1) {
    const parts = text
      .split(/(?=(?:Let me|I['’]?m\b|I['’]?ll\b|The file|The game|Game is done|Now |Next |Finally |After |Before |However ))/i)
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length > 1) return parts;
    return [text];
  }

  // Some legacy chains are a single long paragraph containing several turns.
  // Split the longest block at a clear intent boundary until we have enough
  // blocks to place one thought before each persisted tool call.
  const intentBoundaries = [
    'The file path issue',
    "I'm on macOS",
    'The game has been',
    'Game is done',
    'Let me write the file',
  ];
  while (paragraphs.length < desiredSegments) {
    const longestIndex = paragraphs.reduce(
      (best, part, index) => part.length > paragraphs[best].length ? index : best,
      0,
    );
    const longest = paragraphs[longestIndex];
    if (longest.length < 120) break;

    const boundary = intentBoundaries.find((marker) => {
      const at = longest.indexOf(marker);
      return at > 30 && at < longest.length - 40;
    });
    if (!boundary) break;

    const at = longest.indexOf(boundary);
    paragraphs.splice(
      longestIndex,
      1,
      longest.slice(0, at).trim(),
      longest.slice(at).trim(),
    );
  }

  return paragraphs.filter(Boolean);
}

/**
 * Build the display order for an assistant message. New records carry
 * thinking/text events already; legacy records are reconstructed from
 * thinkingChain + content around the persisted tool events.
 */
function buildChronologicalEvents(message: ChatMessageType): EventLog[] {
  const raw = message.events || [];
  const hasInlineContent = raw.some(
    (ev) => ev.type === 'thinking' || ev.type === 'text_chunk',
  );
  if (hasInlineContent) return coalesceEvents(raw);

  const toolStartCount = raw.filter((ev) => ev.type === 'tool_start').length;
  const legacyThoughts = splitLegacyThinking(message.thinkingChain, toolStartCount);
  const events: EventLog[] = [];
  let thoughtIndex = 0;

  for (const ev of raw) {
    if (ev.type === 'tool_start' && thoughtIndex < legacyThoughts.length) {
      events.push({ type: 'thinking', content: legacyThoughts[thoughtIndex++] });
    }
    events.push(ev);
  }

  while (thoughtIndex < legacyThoughts.length) {
    events.push({ type: 'thinking', content: legacyThoughts[thoughtIndex++] });
  }

  if (message.content?.trim()) {
    events.push({ type: 'text_chunk', content: message.content });
  }

  return coalesceEvents(events);
}

/* ── Single event item ── */
function EventItem({ ev, isStreaming }: { ev: EventLog; isStreaming: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const inputStr = ev.toolInput ? JSON.stringify(ev.toolInput, null, 2) : '';
  const isLong = inputStr.length > 120;

  if (
    (ev.type === 'tool_start' || ev.type === 'tool_update' || ev.type === 'tool_end') &&
    (ev.toolName === 'TaskCreate' || ev.toolName === 'TaskUpdate')
  ) {
    return null;
  }

  switch (ev.type) {
    case 'thinking':
      return (
        <div className="rounded-lg border border-purple-500/10 bg-purple-500/[0.04] px-2.5 py-1.5">
          <div className="flex items-center gap-1.5 text-[11px] text-purple-400/80 mb-1">
            <span className="flex-shrink-0">🧠</span>
            <span className="font-medium">思考</span>
            {isStreaming && (
              <span className="inline-block w-1.5 h-3.5 bg-purple-400/60 animate-pulse" />
            )}
          </div>
          <div className="text-xs text-purple-300/70 leading-relaxed pl-3 border-l-2 border-purple-500/20 font-light whitespace-pre-wrap break-words">
            {ev.content}
          </div>
        </div>
      );

    case 'tool_start':
      return (
        <div className="flex flex-col gap-1 py-1 px-2.5 rounded-lg bg-amber-500/[0.06] border border-amber-500/[0.12]">
          <div className="flex items-start gap-2 text-xs">
            <span className="flex-shrink-0 mt-0.5">{toolEmoji(ev.toolName || '')}</span>
            <div className="min-w-0 flex-1">
              <span className="font-semibold text-amber-300">{toolName(ev.toolName || '')}</span>
              {ev.toolInput && (
                <div className="font-mono text-gray-400 mt-0.5 truncate" title={inputStr}>
                  {formatToolInput(ev.toolName || '', ev.toolInput)}
                </div>
              )}
            </div>
          </div>
          {/* Expandable full input */}
          {isLong && (
            <div className="pl-5">
              <button
                onClick={() => setExpanded(!expanded)}
                className="text-[10px] text-amber-500/60 hover:text-amber-400 transition-colors"
              >
                {expanded ? '收起' : '展开完整输入'}
              </button>
              {expanded && (
                <pre className="mt-1 text-xs text-gray-300 bg-black/30 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words">
                  {inputStr}
                </pre>
              )}
            </div>
          )}
        </div>
      );

    case 'tool_update':
      return (
        <div className="pl-2 ml-4 border-l-2 border-amber-500/20 py-1">
          <div className="text-[10px] text-amber-400/50 mb-0.5">工具结果</div>
          <pre className="text-xs text-cyan-300/80 whitespace-pre-wrap break-words bg-black/20 rounded p-2 max-h-48 overflow-y-auto">
            {ev.toolInput ? JSON.stringify(ev.toolInput, null, 2).slice(0, 2000) : ev.content || ''}
            {(ev.toolInput && JSON.stringify(ev.toolInput).length > 2000) ? '\n…(内容过长)' : ''}
          </pre>
        </div>
      );

    case 'tool_end':
      return (
        <div className="pl-2 ml-4 border-l-2 border-cyan-500/20 py-1">
          <div className="text-[10px] text-cyan-400/60 mb-0.5">工具完成</div>
          <pre className="text-xs text-cyan-300/80 whitespace-pre-wrap break-words bg-black/20 rounded p-2 max-h-48 overflow-y-auto">
            {typeof ev.toolResult === 'string' ? ev.toolResult : JSON.stringify(ev.toolResult ?? ev.toolInput, null, 2)}
          </pre>
        </div>
      );

    case 'tool_progress':
      return (
        <div className="flex gap-2 text-xs text-gray-500 py-0.5 pl-2">
          <span>{toolEmoji(ev.toolName || '')}</span>
          <span className="italic">{ev.toolName} {ev.subtype === 'running' ? '…' : ev.subtype}</span>
        </div>
      );

    case 'skill_load':
      return (
        <div className="flex gap-2 text-xs text-green-300/70 py-0.5 pl-2">
          <span>⚡</span>
          <span>Skill {ev.skillName || ''} {ev.status || 'ready'}</span>
        </div>
      );

    case 'skill_invoke':
      return (
        <div className="flex flex-col gap-1 py-1 px-2.5 rounded-lg bg-emerald-500/[0.06] border border-emerald-500/[0.12]">
          <div className="flex items-start gap-2 text-xs">
            <span className="flex-shrink-0 mt-0.5">⚡</span>
            <div className="min-w-0 flex-1">
              <span className="font-semibold text-emerald-300">
                Skill {ev.skillName || ''}
              </span>
              {ev.input && Object.keys(ev.input).length > 0 && (
                <pre className="mt-1 text-[11px] text-gray-400 whitespace-pre-wrap break-words">
                  {JSON.stringify(ev.input, null, 2)}
                </pre>
              )}
              {ev.status === 'result' && ev.output !== undefined && (
                <pre className="mt-1 text-[11px] text-cyan-300/70 whitespace-pre-wrap break-words">
                  {typeof ev.output === 'string' ? ev.output : JSON.stringify(ev.output, null, 2)}
                </pre>
              )}
            </div>
          </div>
        </div>
      );

    case 'mcp_status':
      return (
        <div className="flex gap-2 text-xs text-blue-300/70 py-0.5 pl-2">
          <span>🔌</span>
          <span>MCP {ev.serverName || ''} {ev.status || ''}</span>
        </div>
      );

    case 'mcp_call':
      return (
        <div className="flex flex-col gap-1 py-1 px-2.5 rounded-lg bg-blue-500/[0.06] border border-blue-500/[0.12]">
          <div className="flex items-start gap-2 text-xs">
            <span className="flex-shrink-0 mt-0.5">🔌</span>
            <div className="min-w-0 flex-1">
              <span className="font-semibold text-blue-300">
                {ev.serverName || 'MCP'} · {ev.toolName || 'tool'}
              </span>
              {ev.input && Object.keys(ev.input).length > 0 && (
                <pre className="mt-1 text-[11px] text-gray-400 whitespace-pre-wrap break-words">
                  {JSON.stringify(ev.input, null, 2)}
                </pre>
              )}
              {ev.status === 'result' && ev.output !== undefined && (
                <pre className="mt-1 text-[11px] text-cyan-300/70 whitespace-pre-wrap break-words">
                  {typeof ev.output === 'string' ? ev.output : JSON.stringify(ev.output, null, 2)}
                </pre>
              )}
            </div>
          </div>
        </div>
      );

    case 'status':
      return (
        <div className="flex gap-2 text-xs text-green-300/70 py-0.5 pl-2">
          <span>✅</span>
          <span>{ev.content}</span>
        </div>
      );

    case 'command_output': {
      const isLongOutput = (ev.content?.length || 0) > 200;
      const display = expanded ? ev.content : ev.content?.slice(0, 200);
      return (
        <div className="flex flex-col gap-1 text-xs py-1 pl-2">
          {isLongOutput && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-[10px] text-cyan-500/60 hover:text-cyan-400 self-start transition-colors"
            >
              {expanded ? '收起输出' : `展开完整输出 (${ev.content?.length} 字符)`}
            </button>
          )}
          <pre className="bg-black/30 rounded-lg p-2.5 text-cyan-300/80 overflow-x-auto max-h-64 leading-relaxed border border-white/5">
            {display}
            {isLongOutput && !expanded && '…'}
          </pre>
        </div>
      );
    }

    case 'text_chunk':
      return (
        <div className="markdown-content text-sm leading-relaxed">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{ev.content || ''}</ReactMarkdown>
          {isStreaming && (
            <span className="inline-block w-2 h-4 bg-cyan-300/60 animate-pulse" />
          )}
        </div>
      );

    default:
      return null;
  }
}

export default function ChatMessage({ message, isStreaming }: Props) {
  const isUser = message.role === 'user';
  const activity = isUser ? [] : buildChronologicalEvents(message);
  const todoItems = isUser ? [] : buildTodoItems(message.events);
  const hasActivity = activity.length > 0;
  const hasInlineText = activity.some((ev) => ev.type === 'text_chunk');

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div
        className={`max-w-[88%] rounded-2xl px-4 py-3 ${
          isUser
            ? 'bg-blue-600/20 border border-blue-500/30 text-blue-100'
            : 'bg-white/[0.03] border border-white/[0.08] text-gray-200'
        }`}
      >
        {/* ── Chronological event log (thinking → tool → thinking → text) ── */}
        {!isUser && hasActivity && (
          <div className="space-y-1.5 mb-3">
            {todoItems.length > 0 && <TodoList items={todoItems} />}
            {activity.map((ev, i) => (
              <EventItem
                key={`${ev.type}-${i}-${ev.toolId || ''}`}
                ev={ev}
                isStreaming={isStreaming && i === activity.length - 1}
              />
            ))}
          </div>
        )}

        {/* ── Main content is rendered inline when events carry text_chunk ── */}
        <div className="markdown-content text-sm leading-relaxed">
          {isUser ? (
            <p>{message.content}</p>
          ) : !hasInlineText ? (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {message.content || (isStreaming && !hasActivity ? '处理中…' : '')}
            </ReactMarkdown>
          ) : null}
        </div>

        {/* ── Streaming indicator ── */}
        {isStreaming && !isUser && !message.content && !hasInlineText && (
          <div className="flex items-center gap-1.5 mt-2 text-xs text-gray-500">
            <span className="animate-pulse">●</span>
            处理中…
          </div>
        )}
      </div>
    </div>
  );
}
