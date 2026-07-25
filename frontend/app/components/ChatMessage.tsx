'use client';

import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatMessage as ChatMessageType, EventLog } from '../hooks/useChatSSE';

interface Props {
  message: ChatMessageType;
  isLast: boolean;
}

/* ── Icons ── */
function toolEmoji(name: string): string {
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

/* ── Single event item ── */
function EventItem({ ev, isStreaming }: { ev: EventLog; isStreaming: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const inputStr = ev.toolInput ? JSON.stringify(ev.toolInput, null, 2) : '';
  const isLong = inputStr.length > 120;

  switch (ev.type) {
    case 'thinking':
      // During streaming (isStreaming), thinking is rendered as typewriter block below
      if (isStreaming) return null;
      // History: show as inline line
      return (
        <div className="flex gap-2 text-xs text-purple-300/60 py-0.5 pl-2">
          <span className="flex-shrink-0 mt-0.5">🧠</span>
          <span className="italic leading-relaxed whitespace-pre-wrap break-words">{ev.content}</span>
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

    case 'tool_progress':
      return (
        <div className="flex gap-2 text-xs text-gray-500 py-0.5 pl-2">
          <span>{toolEmoji(ev.toolName || '')}</span>
          <span className="italic">{ev.toolName} {ev.subtype === 'running' ? '…' : ev.subtype}</span>
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
      return null;

    default:
      return null;
  }
}

export default function ChatMessage({ message, isLast }: Props) {
  const [showFullThinking, setShowFullThinking] = useState(false);
  const [typewriterChars, setTypewriterChars] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isUser = message.role === 'user';
  const hasEvents = !!message.events && message.events.length > 0;

  // Typewriter only for real-time streaming, not historical messages
  const thinkingLen = message.thinkingChain?.length || 0;
  useEffect(() => {
    if (!isLast || !thinkingLen) {
      setTypewriterChars(thinkingLen);
      return;
    }
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setTypewriterChars((prev) => {
        if (prev >= thinkingLen) {
          if (timerRef.current) clearInterval(timerRef.current);
          return thinkingLen;
        }
        return prev + 1;
      });
    }, 15);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [thinkingLen, isLast]);

  // Tool counts for badges
  const toolCalls = (message.events || []).filter((e) => e.type === 'tool_start' || e.type === 'tool_update');
  const uniqueTools = [...new Set(toolCalls.map((t) => t.toolName).filter(Boolean))];

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div
        className={`max-w-[88%] rounded-2xl px-4 py-3 ${
          isUser
            ? 'bg-blue-600/20 border border-blue-500/30 text-blue-100'
            : 'bg-white/[0.03] border border-white/[0.08] text-gray-200'
        }`}
      >
        {/* ── Chronological event log (thinking, tool, status, etc. in order) ── */}
        {!isUser && hasEvents && (
          <div className="space-y-1 mb-3">
            {message.events!.map((ev, i) => (
              <EventItem key={`ev-${i}`} ev={ev} isStreaming={isLast} />
            ))}
          </div>
        )}

        {/* ── Typewriter thinking block (only for NEW streaming content) ── */}
        {!isUser && isLast && thinkingLen > 0 && (
          <div className="mb-3">
            <div className="flex items-center gap-1.5 text-[11px] text-purple-400/70 mb-1">
              <span>🧠 思考过程</span>
              {typewriterChars < thinkingLen && (
                <span className="inline-block w-1.5 h-3.5 bg-purple-400/60 animate-pulse" />
              )}
            </div>
            <div className="text-xs text-purple-300/70 leading-relaxed pl-4 border-l-2 border-purple-500/20 font-light whitespace-pre-wrap">
              {message.thinkingChain?.slice(0, typewriterChars) || ''}
            </div>
          </div>
        )}

        {/* ── Tool badges ── */}
        {uniqueTools.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {uniqueTools.map((name, i) => (
              <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400/80 font-mono">
                {toolEmoji(name!)} {toolName(name!)}
              </span>
            ))}
            {toolCalls.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-500/10 text-gray-500">×{toolCalls.length}</span>
            )}
          </div>
        )}

        {/* ── Main markdown content ── */}
        <div className="markdown-content text-sm leading-relaxed">
          {isUser ? (
            <p>{message.content}</p>
          ) : (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {message.content || (isLast && !hasEvents ? '处理中…' : '')}
            </ReactMarkdown>
          )}
        </div>

        {/* ── Streaming indicator ── */}
        {isLast && !isUser && !message.content && (
          <div className="flex items-center gap-1.5 mt-2 text-xs text-gray-500">
            <span className="animate-pulse">●</span>
            处理中…
          </div>
        )}
      </div>
    </div>
  );
}
