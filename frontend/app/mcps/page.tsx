'use client';

import React, { useEffect, useState, useCallback } from 'react';
import AdminShell from '../components/AdminShell';

interface McpServerInfo {
  name: string;
  description: string;
  status: string;
  enabled: boolean;
  tools: string[];
}

export default function McpsPage() {
  const [servers, setServers] = useState<McpServerInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch('http://localhost:3001/mcps')
      .then((r) => r.json())
      .then((data) => setServers(data))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const toggle = async (server: McpServerInfo) => {
    setBusy(server.name);
    try {
      const res = await fetch(`http://localhost:3001/mcps/${encodeURIComponent(server.name)}/toggle`, {
        method: 'POST',
      });
      const next = await res.json();
      setServers((prev) => prev.map((s) => s.name === server.name ? { ...s, enabled: next.enabled } : s));
    } finally {
      setBusy(null);
    }
  };

  return (
    <AdminShell>
      <div className="px-6 py-6 max-w-5xl">
        <header className="mb-6">
          <h1 className="text-xl font-semibold text-white">MCP 管理</h1>
          <p className="text-xs text-gray-500 mt-1">Agent 沙箱中可注入的 MCP 服务</p>
        </header>

        {loading ? (
          <div className="text-center py-12 text-gray-600">
            <div className="inline-block w-6 h-6 border-2 border-gray-600 border-t-white rounded-full animate-spin" />
          </div>
        ) : servers.length === 0 ? (
          <div className="text-center py-16 text-gray-600 border border-dashed border-white/10 rounded-xl">
            暂无 MCP 服务
          </div>
        ) : (
          <div className="space-y-3">
            {servers.map((server) => (
              <div
                key={server.name}
                className="p-4 rounded-xl bg-white/[0.03] border border-white/10"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-medium text-white">{server.name}</h3>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-300">
                        {server.status}
                      </span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full ${
                          server.enabled
                            ? 'bg-green-500/15 text-green-400'
                            : 'bg-gray-500/15 text-gray-400'
                        }`}
                      >
                        {server.enabled ? '已启用' : '已停用'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-2 leading-relaxed">
                      {server.description}
                    </p>
                    {server.tools.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {server.tools.map((tool) => (
                          <span
                            key={tool}
                            className="text-[10px] px-2 py-0.5 rounded bg-white/5 text-gray-400"
                          >
                            {tool}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    onClick={() => toggle(server)}
                    disabled={busy === server.name}
                    className="shrink-0 px-3 py-1.5 text-xs rounded-lg border border-white/10 bg-white/5 text-gray-300 hover:bg-white/10 transition-colors disabled:opacity-50"
                  >
                    {busy === server.name ? '处理中' : server.enabled ? '停用' : '启用'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AdminShell>
  );
}
