'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Button, Tag, Typography } from 'antd';
import { ProCard } from '@ant-design/pro-components';
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
      <ProCard title="MCP 管理" bordered loading={loading}>
        <div className="grid gap-4 md:grid-cols-2">
          {servers.map((server) => (
            <ProCard key={server.name} bordered hoverable>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Typography.Text strong>{server.name}</Typography.Text>
                    <Tag color="blue">{server.status}</Tag>
                    <Tag color={server.enabled ? 'green' : 'default'}>
                      {server.enabled ? '已启用' : '已停用'}
                    </Tag>
                  </div>
                  <Typography.Paragraph type="secondary" className="mt-2 mb-0">
                    {server.description}
                  </Typography.Paragraph>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {server.tools.map((tool) => (
                      <Tag key={tool}>{tool}</Tag>
                    ))}
                  </div>
                </div>
                <Button
                  size="small"
                  onClick={() => toggle(server)}
                  loading={busy === server.name}
                >
                  {server.enabled ? '停用' : '启用'}
                </Button>
              </div>
            </ProCard>
          ))}
        </div>
      </ProCard>
    </AdminShell>
  );
}
