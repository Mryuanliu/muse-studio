'use client';

import React, { useEffect, useState, useCallback } from 'react';
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
      <div className="px-6 py-6 max-w-5xl">
        <header className="mb-6">
          <h1 className="text-xl font-semibold text-white">Skill 管理</h1>
          <p className="text-xs text-gray-500 mt-1">平台沉淀的页面生成技能</p>
        </header>

        {loading ? (
          <div className="text-center py-12 text-gray-600">
            <div className="inline-block w-6 h-6 border-2 border-gray-600 border-t-white rounded-full animate-spin" />
          </div>
        ) : skills.length === 0 ? (
          <div className="text-center py-16 text-gray-600 border border-dashed border-white/10 rounded-xl">
            暂无技能
          </div>
        ) : (
          <div className="space-y-3">
            {skills.map((skill) => (
              <div
                key={skill.name}
                className="p-4 rounded-xl bg-white/[0.03] border border-white/10"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-medium text-white">{skill.name}</h3>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full ${
                          skill.enabled
                            ? 'bg-green-500/15 text-green-400'
                            : 'bg-gray-500/15 text-gray-400'
                        }`}
                      >
                        {skill.enabled ? '已启用' : '已停用'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-2 leading-relaxed">
                      {skill.description || '暂无描述'}
                    </p>
                    <p className="text-[10px] text-gray-600 mt-2 truncate">{skill.path}</p>
                  </div>
                  <button
                    onClick={() => toggle(skill)}
                    disabled={busy === skill.name}
                    className="shrink-0 px-3 py-1.5 text-xs rounded-lg border border-white/10 bg-white/5 text-gray-300 hover:bg-white/10 transition-colors disabled:opacity-50"
                  >
                    {busy === skill.name ? '处理中' : skill.enabled ? '停用' : '启用'}
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
