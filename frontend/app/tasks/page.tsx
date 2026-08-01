'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import AdminShell from '../components/AdminShell';

interface Conversation {
  id: string;
  title: string;
  sdkSessionId: string | null;
  status: string;
  messageCount?: number;
  createdAt: string;
  updatedAt: string;
}

export default function TasksPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('http://localhost:3001/chat/conversations')
      .then((r) => r.json())
      .then((data) => {
        setConversations(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <AdminShell>
      <div className="px-6 py-6 max-w-5xl">
        <header className="mb-6">
          <h1 className="text-xl font-semibold text-white">任务</h1>
          <p className="text-xs text-gray-500 mt-1">创建和管理 AI 生成的工程化页面</p>
        </header>

        <Link
          href="/task/new"
          className="block w-full p-4 mb-6 rounded-xl border border-dashed border-blue-500/40 bg-blue-500/5 hover:bg-blue-500/10 hover:border-blue-500/60 transition-all text-center"
        >
          <span className="text-base font-medium">＋ 新建任务</span>
          <p className="text-xs text-gray-500 mt-1">输入页面需求，AI 会生成可启动预览的项目</p>
        </Link>

        <h2 className="text-sm font-medium text-gray-400 mb-3">历史任务</h2>

        {loading ? (
          <div className="text-center py-12 text-gray-600">
            <div className="inline-block w-6 h-6 border-2 border-gray-600 border-t-white rounded-full animate-spin" />
          </div>
        ) : conversations.length === 0 ? (
          <div className="text-center py-16 text-gray-600 border border-dashed border-white/10 rounded-xl">
            <p className="text-sm">暂无历史任务</p>
            <p className="text-xs mt-1">点击上方按钮创建第一个页面生成任务</p>
          </div>
        ) : (
          <div className="space-y-2">
            {conversations.map((conv) => (
              <Link
                key={conv.id}
                href={`/task/${conv.id}`}
                className="block p-4 rounded-xl bg-white/[0.03] border border-white/10 hover:bg-white/[0.06] hover:border-white/20 transition-all"
              >
                <div className="flex items-center justify-between">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium text-white truncate">
                      {conv.title}
                    </h3>
                    <p className="text-xs text-gray-500 mt-1">
                      {new Date(conv.updatedAt).toLocaleString('zh-CN')}
                      {conv.sdkSessionId && (
                        <span className="ml-2 text-green-500">● 可续跑</span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 ml-4">
                    {conv.messageCount != null && (
                      <span className="text-xs text-gray-500">
                        {conv.messageCount} 条消息
                      </span>
                    )}
                    <span className="text-gray-600">→</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </AdminShell>
  );
}
