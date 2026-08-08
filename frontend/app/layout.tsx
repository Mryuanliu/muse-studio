import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI 工作区',
  description: '使用 AI 创建和编辑项目',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
