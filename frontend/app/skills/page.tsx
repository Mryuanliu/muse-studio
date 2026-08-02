'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Button, Tag, Typography } from 'antd';
import { ProCard } from '@ant-design/pro-components';
import AdminShell from '../components/AdminShell';

interface SkillInfo {
  name: string;
  description: string;
  path: string;
  enabled: boolean;
}

export default function SkillsPage() {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    fetch('http://localhost:3001/skills')
      .then((r) => r.json())
      .then((data) => setSkills(data))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const toggle = async (skill: SkillInfo) => {
    setBusy(skill.name);
    try {
      const res = await fetch(`http://localhost:3001/skills/${encodeURIComponent(skill.name)}/toggle`, {
        method: 'POST',
      });
      const next = await res.json();
      setSkills((prev) => prev.map((s) => s.name === skill.name ? { ...s, enabled: next.enabled } : s));
    } finally {
      setBusy(null);
    }
  };

  return (
    <AdminShell>
      <ProCard title="Skill 管理" bordered loading={loading}>
        <div className="grid gap-4 md:grid-cols-2">
          {skills.map((skill) => (
            <ProCard key={skill.name} bordered hoverable>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Typography.Text strong>{skill.name}</Typography.Text>
                    <Tag color={skill.enabled ? 'green' : 'default'}>
                      {skill.enabled ? '已启用' : '已停用'}
                    </Tag>
                  </div>
                  <Typography.Paragraph type="secondary" className="mt-2 mb-0">
                    {skill.description || '暂无描述'}
                  </Typography.Paragraph>
                  <Typography.Text type="secondary" className="text-xs break-all">
                    {skill.path}
                  </Typography.Text>
                </div>
                <Button
                  size="small"
                  onClick={() => toggle(skill)}
                  loading={busy === skill.name}
                >
                  {skill.enabled ? '停用' : '启用'}
                </Button>
              </div>
            </ProCard>
          ))}
        </div>
      </ProCard>
    </AdminShell>
  );
}
