'use client';

import React, { useRef, useEffect, useState } from 'react';
import { useChatSSE } from '../hooks/useChatSSE';
import ChatMessage from './ChatMessage';

interface Props {
  onPreviewHtml: (html: string) => void;
}

export default function ChatPanel({ onPreviewHtml }: Props) {
  const { messages, isStreaming, sendMessage } = useChatSSE();
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Extract HTML from assistant messages for preview
  useEffect(() => {
    const lastAssistant = [...messages].reverse().find(
      (m) => m.role === 'assistant' && m.content,
    );
    if (lastAssistant) {
      const htmlMatch = lastAssistant.content.match(
        /<html[\s\S]*?<\/html>/i,
      );
      if (htmlMatch) {
        onPreviewHtml(htmlMatch[0]);
      }
    }
  }, [messages, onPreviewHtml]);

  const handleSubmit = async () => {
    const text = input.trim();
    if (!text || isStreaming) return;
    setInput('');
    await sendMessage(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-white/10">
        <h1 className="text-lg font-semibold text-white">AI 工作区</h1>
        <p className="text-xs text-gray-500 mt-0.5">
          描述目标，AI 将创建对应的项目内容
        </p>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center text-gray-500">
            <svg className="w-16 h-16 mb-4 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
            </svg>
            <p className="text-sm">输入描述开始创建内容</p>
            <p className="text-xs mt-1">例如：「创建一个带渐变背景的页面」</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <ChatMessage
            key={`${msg.role}-${i}`}
            message={msg}
            isStreaming={isStreaming}
          />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="flex-shrink-0 border-t border-white/10 p-4">
        <div className="flex gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="描述你想创建或修改的内容..."
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
            ) : (
              '发送'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
