'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useChatSSE, ChatMessage } from '../../hooks/useChatSSE';
import ChatMessageComponent from '../../components/ChatMessage';
import PreviewPanel from '../../components/PreviewPanel';

function TaskChat({ convId, initialMsgs, sdkSessionId }: { convId?: string; initialMsgs?: ChatMessage[]; sdkSessionId?: string }) {
  const { messages, isStreaming, sendMessage } = useChatSSE({
    initialMessages: initialMsgs,
    initialConversationId: convId,
    initialSdkSessionId: sdkSessionId,
  });
  const [input, setInput] = useState('');
  const [previewHtml, setPreviewHtml] = useState<string | undefined>();
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Extract HTML for preview — match full html docs or doctype+html
  useEffect(() => {
    const last = [...messages].reverse().find((m) => m.role === 'assistant' && m.content);
    if (last) {
      const content = last.content;
      // Try full <html>...</html> first, then <!DOCTYPE html>...</html>, then standalone <!DOCTYPE
      const m = content.match(/(?:<html[\s\S]*?<\/html>|<!(?:DOCTYPE|doctype)\s+html[\s\S]*?<\/html>)/i)
             || content.match(/<(?:html|!DOCTYPE|!doctype)[\s\S]*?(?:<\/html>|$)/i);
      if (m) setPreviewHtml(m[0]);
    }
  }, [messages]);

  const handleSubmit = () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput('');
    sendMessage(text);
  };

  return (
    <div className="flex h-screen">
      {/* Left: Chat (narrower) */}
      <div className="w-[35%] min-w-[320px] border-r border-white/10 flex flex-col">
        {/* Header */}
        <div className="flex-shrink-0 px-4 py-3 border-b border-white/10 flex items-center justify-between">
          <Link href="/" className="text-xs text-gray-500 hover:text-gray-300 transition-colors">
            ← 返回列表
          </Link>
          <span className="text-xs text-gray-600">
            {isStreaming ? '生成中...' : '就绪'}
          </span>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center text-gray-500">
              <svg className="w-16 h-16 mb-4 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
              </svg>
              <p className="text-sm">输入描述开始生成 H5 页面</p>
            </div>
          )}

          {messages.map((msg, i) => (
            <ChatMessageComponent key={`${msg.role}-${i}`} message={msg} isLast={i === messages.length - 1} />
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="flex-shrink-0 border-t border-white/10 p-4">
          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
              placeholder="输入 H5 页面描述..."
              rows={2}
              disabled={isStreaming}
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 resize-none outline-none focus:border-blue-500/50 transition-colors disabled:opacity-50"
            />
            <button
              onClick={handleSubmit}
              disabled={!input.trim() || isStreaming}
              className="self-end px-5 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-xl text-sm font-medium transition-colors"
            >
              {isStreaming ? (
                <span className="flex items-center gap-1.5">
                  <span className="inline-block w-2 h-2 bg-white/50 rounded-full animate-pulse" />
                  生成中
                </span>
              ) : '发送'}
            </button>
          </div>
        </div>
      </div>

      {/* Right: Preview (wider) */}
      <div className="flex-1 min-w-0">
        <PreviewPanel html={previewHtml} />
      </div>
    </div>
  );
}

export default function TaskPage() {
  const params = useParams();
  const convId = params?.id as string;
  const isNew = convId === 'new';
  const [loading, setLoading] = useState(true);
  const [initialData, setInitialData] = useState<{
    msgs: ChatMessage[];
    convId: string;
    sdkSessionId?: string;
  } | undefined>();

  useEffect(() => {
    if (isNew) {
      setLoading(false);
      return;
    }
    fetch(`http://localhost:3001/chat/conversations/${convId}`)
      .then((r) => r.json())
      .then((data) => {
        const msgs: ChatMessage[] = (data.messages || []).map((m: any) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          thinkingChain: m.thinkingChain || undefined,
          events: m.events ? (typeof m.events === 'string' ? JSON.parse(m.events) : m.events) : undefined,
        }));
        setInitialData({ msgs, convId: data.id, sdkSessionId: data.sdkSessionId || undefined });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [convId, isNew]);

  if (loading) {
    return (
      <div className="h-screen bg-[#0f0f0f] flex items-center justify-center">
        <div className="inline-block w-8 h-8 border-2 border-gray-600 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <TaskChat
      convId={isNew ? undefined : (initialData?.convId || convId)}
      initialMsgs={isNew ? undefined : initialData?.msgs}
      sdkSessionId={isNew ? undefined : initialData?.sdkSessionId}
    />
  );
}
