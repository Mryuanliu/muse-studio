'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import React from 'react';
import dynamic from 'next/dynamic';

const ProLayout = dynamic(
  () => import('@ant-design/pro-components').then((mod) => mod.ProLayout),
  { ssr: false },
);

const route = {
  path: '/',
  routes: [
    { path: '/conversations', name: '会话' },
    { path: '/tasks', name: '任务' },
    { path: '/agents', name: '智能体' },
    { path: '/skills', name: 'Skill 管理' },
    { path: '/skill-groups', name: 'Skill 分组' },
    { path: '/mcps', name: 'MCP 管理' },
  ],
};

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <ProLayout
      title="Muse Studio"
      logo={<span className="text-lg font-bold text-blue-600">M</span>}
      route={route}
      location={{ pathname }}
      layout="mix"
      fixSiderbar
      menuItemRender={(item, dom) => <Link href={item.path || '/'}>{dom}</Link>}
      token={{
        header: { colorBgHeader: '#ffffff' },
        sider: { colorMenuBackground: '#ffffff' },
      }}
    >
      <div className="min-h-screen bg-gray-50 p-4 md:p-6">{children}</div>
    </ProLayout>
  );
}
