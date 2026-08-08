'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';

/* ── Types ── */
interface ColumnSchema {
  name: string;
  type: string;
  pk?: boolean;
  fk?: string;
  nullable?: boolean;
  default?: string;
  comment: string;
}

interface TableSchema {
  name: string;
  comment: string;
  columns: ColumnSchema[];
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  museEvents: string | null;
  conversationId: string;
  createdAt: string;
  conversation?: { id: string; title: string };
}

interface ConversationRow {
  id: string;
  title: string;
  sdkSessionId: string | null;
  status: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

/* ── Schema Panel ── */
function SchemaPanel({ tables }: { tables: TableSchema[] }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
      {tables.map((table) => (
        <div key={table.name} className="bg-white/[0.03] border border-white/10 rounded-xl overflow-hidden">
          {/* Table header */}
          <div className="px-4 py-3 border-b border-white/10 bg-white/[0.02]">
            <div className="flex items-center gap-2">
              <code className="text-sm font-semibold text-blue-300">{table.name}</code>
              <span className="text-xs text-gray-500">— {table.comment}</span>
            </div>
          </div>

          {/* Columns */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-white/5 text-gray-500">
                  <th className="text-left py-2 px-4 font-medium w-40">字段名</th>
                  <th className="text-left py-2 px-3 font-medium w-24">类型</th>
                  <th className="text-left py-2 px-3 font-medium w-20">约束</th>
                  <th className="text-left py-2 px-3 font-medium">说明</th>
                </tr>
              </thead>
              <tbody>
                {table.columns.map((col) => (
                  <tr key={col.name} className="border-b border-white/[0.03] hover:bg-white/[0.02]">
                    <td className="py-2 px-4">
                      <code className="text-gray-200 font-mono">{col.name}</code>
                    </td>
                    <td className="py-2 px-3 text-gray-400 font-mono">{col.type}</td>
                    <td className="py-2 px-3">
                      <div className="flex flex-wrap gap-1">
                        {col.pk && <span className="text-yellow-500 text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/10">PK</span>}
                        {col.fk && <span className="text-purple-400 text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10">FK→{col.fk}</span>}
                        {col.nullable && <span className="text-gray-600 text-[10px]">NULL</span>}
                        {col.default && <span className="text-green-600 text-[10px]">DEFAULT {col.default}</span>}
                      </div>
                    </td>
                    <td className="py-2 px-3 text-gray-500">{col.comment}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Markdown Modal ── */
function MarkdownModal({ message, onClose }: { message: Message | null; onClose: () => void }) {
  if (!message) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-[#1a1a2e] border border-white/10 rounded-2xl w-[700px] max-h-[80vh] flex flex-col shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex-shrink-0 flex items-center justify-between px-5 py-4 border-b border-white/10">
          <div>
            <span className={`text-xs font-medium px-2 py-0.5 rounded ${message.role === 'user' ? 'bg-blue-500/20 text-blue-300' : 'bg-green-500/20 text-green-300'}`}>
              {message.role === 'user' ? '用户' : 'AI'}
            </span>
            <span className="text-xs text-gray-500 ml-3">
              {new Date(message.createdAt).toLocaleString('zh-CN')}
            </span>
            {message.conversation && (
              <span className="text-xs text-gray-600 ml-3">
                from: {message.conversation.title}
              </span>
            )}
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-xl leading-none">&times;</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <h4 className="text-xs font-medium text-gray-400 mb-2 uppercase tracking-wide">Content</h4>
            <div className="markdown-content bg-black/20 rounded-lg p-4 border border-white/5">
              <pre className="whitespace-pre-wrap text-sm leading-relaxed">{message.content || '(empty)'}</pre>
            </div>
          </div>

          {message.museEvents && (
            <div>
              <h4 className="text-xs font-medium text-purple-400 mb-2 uppercase tracking-wide">Thinking Chain</h4>
              <div className="bg-purple-900/10 border border-purple-500/20 rounded-lg p-4 text-sm text-purple-200/80 leading-relaxed whitespace-pre-wrap">
                {message.museEvents}
              </div>
            </div>
          )}

          <div className="text-xs text-gray-600 space-y-1 pt-2 border-t border-white/5">
            <p>ID: <code className="text-gray-400">{message.id}</code></p>
            <p>Conversation: <code className="text-gray-400">{message.conversationId}</code></p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Conversations Table ── */
function ConversationsTable() {
  const [data, setData] = useState<{ rows: ConversationRow[]; total: number } | null>(null);

  useEffect(() => {
    fetch('http://localhost:3001/admin/conversations?limit=100')
      .then((r) => r.json())
      .then(setData);
  }, []);

  if (!data) return <div className="text-gray-600 text-sm py-8 text-center">加载中...</div>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10 text-gray-500 text-xs uppercase tracking-wide">
            <th className="text-left py-3 px-3 font-medium">标题</th>
            <th className="text-left py-3 px-3 font-medium">状态</th>
            <th className="text-right py-3 px-3 font-medium">消息数</th>
            <th className="text-right py-3 px-3 font-medium">SDK 会话</th>
            <th className="text-right py-3 px-3 font-medium">更新时间</th>
            <th className="text-right py-3 px-3 font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => (
            <tr key={row.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
              <td className="py-3 px-3">
                <Link href={`/task/${row.id}`} className="text-blue-400 hover:text-blue-300 transition-colors">
                  {row.title}
                </Link>
              </td>
              <td className="py-3 px-3">
                <span className={`text-xs px-2 py-0.5 rounded ${row.status === 'active' ? 'bg-green-500/10 text-green-400' : 'bg-gray-500/10 text-gray-400'}`}>
                  {row.status}
                </span>
              </td>
              <td className="py-3 px-3 text-right text-gray-400">{row.messageCount}</td>
              <td className="py-3 px-3 text-right">
                {row.sdkSessionId ? (
                  <span className="text-green-500 text-xs" title={row.sdkSessionId}>●</span>
                ) : (
                  <span className="text-gray-600 text-xs">—</span>
                )}
              </td>
              <td className="py-3 px-3 text-right text-gray-500 text-xs">
                {new Date(row.updatedAt).toLocaleString('zh-CN')}
              </td>
              <td className="py-3 px-3 text-right">
                <Link href={`/task/${row.id}`} className="text-xs text-gray-500 hover:text-white transition-colors">
                  进入 →
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-gray-600 mt-3">共 {data.total} 条对话</p>
    </div>
  );
}

/* ── Messages Table ── */
function MessagesTable({ onSelectMessage }: { onSelectMessage: (m: Message) => void }) {
  const [data, setData] = useState<{ rows: Message[]; total: number } | null>(null);
  const [page, setPage] = useState(1);
  const limit = 30;

  useEffect(() => {
    fetch(`http://localhost:3001/admin/messages?page=${page}&limit=${limit}`)
      .then((r) => r.json())
      .then(setData);
  }, [page]);

  if (!data) return <div className="text-gray-600 text-sm py-8 text-center">加载中...</div>;

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-gray-500 text-xs uppercase tracking-wide">
              <th className="text-left py-2 px-2 font-medium w-12">角色</th>
              <th className="text-left py-2 px-2 font-medium">内容预览</th>
              <th className="text-left py-2 px-2 font-medium w-20">事件流</th>
              <th className="text-right py-2 px-2 font-medium w-32">时间</th>
              <th className="text-right py-2 px-2 font-medium w-16">详情</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((msg) => (
              <tr key={msg.id} className="border-b border-white/5 hover:bg-white/[0.02] transition-colors">
                <td className="py-2 px-2">
                  <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${msg.role === 'user' ? 'text-blue-300 bg-blue-500/10' : 'text-green-300 bg-green-500/10'}`}>
                    {msg.role === 'user' ? 'U' : 'A'}
                  </span>
                </td>
                <td className="py-2 px-2 text-gray-400 text-xs truncate max-w-[300px]">
                  {msg.content?.slice(0, 80) || '(empty)'}
                </td>
                <td className="py-2 px-2 text-center">
                  {msg.museEvents ? (
                    <span className="text-purple-400 text-xs">{(msg.museEvents.length / 100).toFixed(1)}k chars</span>
                  ) : (
                    <span className="text-gray-600">—</span>
                  )}
                </td>
                <td className="py-2 px-2 text-right text-gray-600 text-xs whitespace-nowrap">
                  {new Date(msg.createdAt).toLocaleString('zh-CN')}
                </td>
                <td className="py-2 px-2 text-right">
                  <button
                    onClick={() => onSelectMessage(msg)}
                    className="text-xs text-blue-500 hover:text-blue-400 transition-colors"
                  >
                    查看
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between mt-3">
        <p className="text-xs text-gray-600">共 {data.total} 条消息</p>
        <div className="flex gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="text-xs px-3 py-1 rounded bg-white/5 hover:bg-white/10 disabled:opacity-30 transition-colors"
          >
            上一页
          </button>
          <span className="text-xs text-gray-500 self-center">{page} / {Math.ceil(data.total / limit)}</span>
          <button
            onClick={() => setPage((p) => p + 1)}
            disabled={page >= Math.ceil(data.total / limit)}
            className="text-xs px-3 py-1 rounded bg-white/5 hover:bg-white/10 disabled:opacity-30 transition-colors"
          >
            下一页
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Admin Page ── */
export default function AdminPage() {
  const [schema, setSchema] = useState<TableSchema[] | null>(null);
  const [tab, setTab] = useState<'conversations' | 'messages'>('conversations');
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);

  useEffect(() => {
    fetch('http://localhost:3001/admin/schema')
      .then((r) => r.json())
      .then((data) => setSchema(data.tables));
  }, []);

  return (
    <div className="min-h-screen bg-[#0f0f0f] text-gray-200">
      {/* Header */}
      <header className="border-b border-white/10 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-xs text-gray-500 hover:text-gray-300 transition-colors">← 返回</Link>
          <h1 className="text-base font-semibold text-white">管理后台</h1>
          <span className="text-xs text-gray-600">— 数据库可视化</span>
        </div>
      </header>

      {/* Schema section */}
      {schema && (
        <div className="px-6 py-5 border-b border-white/5">
          <h2 className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">表结构设计</h2>
          <SchemaPanel tables={schema} />
        </div>
      )}

      {/* Tab bar */}
      <div className="border-b border-white/10 px-6 flex gap-4">
        <button
          onClick={() => setTab('conversations')}
          className={`py-3 text-sm font-medium border-b-2 transition-colors ${
            tab === 'conversations' ? 'border-blue-500 text-white' : 'border-transparent text-gray-500 hover:text-gray-300'
          }`}
        >
          conversation 表
        </button>
        <button
          onClick={() => setTab('messages')}
          className={`py-3 text-sm font-medium border-b-2 transition-colors ${
            tab === 'messages' ? 'border-blue-500 text-white' : 'border-transparent text-gray-500 hover:text-gray-300'
          }`}
        >
          message 表
        </button>
      </div>

      {/* Data content */}
      <main className="px-6 py-6">
        {tab === 'conversations' ? <ConversationsTable /> : <MessagesTable onSelectMessage={setSelectedMessage} />}
      </main>

      <MarkdownModal message={selectedMessage} onClose={() => setSelectedMessage(null)} />
    </div>
  );
}
