'use client';

import React from 'react';

interface Props {
  /** Inline HTML string, or a URL to load in the iframe */
  html?: string;
  loading?: boolean;
  error?: boolean;
  refreshKey?: number;
}

export default function PreviewPanel({ html, loading = false, error = false, refreshKey = 0 }: Props) {
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const [src, setSrc] = React.useState<string | undefined>();
  const [refreshNonce, setRefreshNonce] = React.useState(0);

  // Determine if html is a URL or inline content
  const isUrl = html?.startsWith('http');

  React.useEffect(() => {
    if (!html) {
      setSrc(undefined);
      return;
    }

    if (isUrl) {
      // Load from URL
      const url = new URL(html);
      url.searchParams.set('_r', String(refreshNonce));
      setSrc(url.toString());
    } else {
      // Write inline HTML to iframe via blob URL
      const blob = new Blob([html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      setSrc(url);
      return () => URL.revokeObjectURL(url);
    }
  }, [html, isUrl, refreshNonce, refreshKey]);

  if (!html) {
    if (loading) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-center text-gray-500 bg-black/20">
          <div className="inline-block w-8 h-8 border-2 border-gray-600 border-t-blue-500 rounded-full animate-spin" />
          <p className="text-sm mt-4">预览启动中...</p>
          <p className="text-xs mt-1 text-gray-600">等待沙箱返回预览地址</p>
        </div>
      );
    }
    if (error) {
      return (
        <div className="flex flex-col items-center justify-center h-full text-center text-gray-500 bg-black/20">
          <p className="text-sm text-red-400">预览启动失败</p>
          <p className="text-xs mt-1 text-gray-600">请检查沙箱项目和 dev server 日志</p>
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center justify-center h-full text-center text-gray-500 bg-black/20">
        <svg className="w-20 h-20 mb-4 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
        <p className="text-sm">等待生成 H5 页面...</p>
        <p className="text-xs mt-1 text-gray-600">
          在左侧输入描述后，生成的页面将在此预览
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex-shrink-0 px-4 py-2 border-b border-white/10 flex items-center justify-between">
        <span className="text-xs text-gray-500">H5 预览</span>
        <div className="flex gap-2">
          <button
            onClick={() => setRefreshNonce((n) => n + 1)}
            className="text-xs px-2 py-1 rounded bg-white/5 hover:bg-white/10 text-gray-400 transition-colors"
          >
            刷新
          </button>
        </div>
      </div>

      {/* Preview iframe */}
      <div className="flex-1 bg-white">
        <iframe
          ref={iframeRef}
          src={src}
          className="w-full h-full border-none"
          title="H5 Preview"
          sandbox="allow-scripts"
        />
      </div>
    </div>
  );
}
