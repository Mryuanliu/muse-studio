'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import React from 'react';

const NAV_ITEMS = [
  { href: '/tasks', label: '任务' },
  { href: '/skills', label: 'Skill 管理' },
  { href: '/mcps', label: 'MCP 管理' },
];

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-[#0f0f0f] text-gray-200 flex flex-col lg:flex-row">
      <aside className="shrink-0 border-b border-white/10 bg-[#111827] lg:w-60 lg:border-b-0 lg:border-r lg:min-h-screen">
        <div className="px-5 py-4 border-b border-white/10">
          <Link href="/tasks" className="block">
            <div className="text-base font-semibold text-white">AI 工程大师</div>
            <div className="text-xs text-gray-500 mt-0.5">快速生成页面原型 + 汇报页面</div>
          </Link>
        </div>

        <nav className="flex lg:flex-col overflow-x-auto">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`shrink-0 px-5 py-3 text-sm border-b border-white/5 transition-colors lg:border-b-0 ${
                  active
                    ? 'bg-blue-600/20 text-white border-r-2 border-r-blue-500'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <main className="flex-1 min-w-0">{children}</main>
    </div>
  );
}
