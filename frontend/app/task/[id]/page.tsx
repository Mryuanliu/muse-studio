'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { io } from 'socket.io-client';
import { Avatar, Button, Segmented, Tabs, Tooltip, Upload, message } from 'antd';
import type { UploadProps } from 'antd';
import {
  CodeOutlined,
  DesktopOutlined,
  MobileOutlined,
  PaperClipOutlined,
  SendOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Bubble } from '@ant-design/x';
import { useChatSSE, ChatAttachment, ChatMessage } from '../../hooks/useChatSSE';
import ChatMessageComponent from '../../components/ChatMessage';
import PreviewPanel from '../../components/PreviewPanel';
import WorkspaceEditor from '../../components/WorkspaceEditor';

function TaskChat({ convId, initialMsgs, sdkSessionId, initialOutputFiles, initialRunStatus, agentId, agentType }: {
  convId?: string;
  initialMsgs?: ChatMessage[];
  sdkSessionId?: string;
  initialOutputFiles?: string[];
  initialRunStatus?: string;
  agentId?: string;
  agentType?: 'codegen' | 'other';
}) {
  const { messages, isStreaming, sendMessage, attach, stop, conversationId, sdkSessionId: activeSdkSessionId, setConversationId, setMessages } = useChatSSE({
    initialMessages: initialMsgs,
    initialConversationId: convId,
    initialSdkSessionId: sdkSessionId,
  });
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [previewHtml, setPreviewHtml] = useState<string | undefined>();
  const [previewStatus, setPreviewStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<'preview' | 'code'>(agentType === 'other' ? 'code' : 'preview');
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [workspaceRefreshKey, setWorkspaceRefreshKey] = useState(0);
  const [uploading, setUploading] = useState(false);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);
  const attachRef = React.useRef<string | null>(null);
  const previewSocketRef = React.useRef<ReturnType<typeof io> | null>(null);
  const joinedRoomRef = React.useRef<string | null>(null);
  const lastWorkspaceEventRef = React.useRef<string>('');

  useEffect(() => {
    if (agentType === 'other') setActiveWorkspaceTab('code');
  }, [agentType]);

  // Preview-ready notifications are pushed through Socket.IO only.
  useEffect(() => {
    const activeConvId = conversationId || convId;
    const socket = previewSocketRef.current || io('http://localhost:3001', {
      transports: ['websocket'],
    });
    previewSocketRef.current = socket;

    const onPreview = (data: any) => {
      if (data?.status === 'ready' && data?.url) {
        setPreviewHtml(data.url);
        setPreviewStatus('ready');
      } else if (data?.status === 'error') {
        setPreviewStatus('error');
      } else if (data?.status === 'updated') {
        setPreviewRefreshKey((n) => n + 1);
        setWorkspaceRefreshKey((n) => n + 1);
      } else {
        setPreviewStatus('loading');
      }
    };
    const onAskUser = (data: any) => {
      if (!data?.requestId) return;
      setMessages((prev) => {
        const existingIndex = prev.findIndex((item) =>
          item.role === 'assistant' && item.events?.some(
            (event) => event.type === 'ask_user' && event.requestId === data.requestId,
          ),
        );
        const index = existingIndex >= 0
          ? existingIndex
          : [...prev].map((item, i) => ({ item, i }))
            .reverse()
            .find(({ item }) => item.role === 'assistant')?.i;
        if (index === undefined) return prev;
        const message = prev[index];
        const events = [...(message.events || [])];
        const event = {
          type: 'ask_user' as const,
          requestId: data.requestId,
          conversationId: data.conversationId,
          toolUseID: data.toolUseID,
          questions: data.questions,
          answers: data.answers,
          status: data.status || 'pending',
        };
        const existing = events.findIndex((item) => item.type === 'ask_user' && item.requestId === data.requestId);
        if (existing >= 0) events[existing] = { ...events[existing], ...event };
        else events.push(event);
        const next = [...prev];
        next[index] = { ...message, events };
        return next;
      });
    };
    socket.on('preview', onPreview);
    socket.on('ask_user', onAskUser);

    const joinRoom = () => {
      if (!activeConvId) return;
      socket.emit('preview:join', { conversationIds: [activeConvId] });
      joinedRoomRef.current = activeConvId;
    };
    socket.on('connect', joinRoom);

    if (joinedRoomRef.current && joinedRoomRef.current !== activeConvId) {
      socket.emit('preview:leave', { conversationIds: [joinedRoomRef.current] });
      joinedRoomRef.current = null;
    }
    if (activeConvId && joinedRoomRef.current !== activeConvId) {
      joinRoom();
    }

    return () => {
      socket.off('preview', onPreview);
      socket.off('ask_user', onAskUser);
      socket.off('connect', joinRoom);
    };
  }, [conversationId, convId]);

  useEffect(() => {
    return () => {
      if (joinedRoomRef.current) {
        previewSocketRef.current?.emit('preview:leave', { conversationIds: [joinedRoomRef.current] });
      }
      previewSocketRef.current?.disconnect();
      previewSocketRef.current = null;
      joinedRoomRef.current = null;
    };
  }, []);

  // Keep the URL stable after a new conversation is created so refresh
  // loads the real task instead of /task/new.
  useEffect(() => {
    if (conversationId && (!convId || convId === 'new')) {
      const params = new URLSearchParams({ sessionId: conversationId });
      if (agentId) params.set('agentId', agentId);
      window.history.replaceState(null, '', `/task/${conversationId}?${params.toString()}`);
    }
  }, [conversationId, convId, agentId]);

  useEffect(() => {
    if (!activeSdkSessionId || !convId || convId === 'new') return;
    const params = new URLSearchParams(window.location.search);
    params.set('sessionId', activeSdkSessionId);
    if (agentId && !params.get('agentId') && !params.get('agentCode')) params.set('agentId', agentId);
    window.history.replaceState(null, '', `/task/${convId}?${params.toString()}`);
  }, [activeSdkSessionId, convId, agentId]);

  useEffect(() => {
    if (previewStatus !== 'loading' || previewHtml) return;
    const timer = setTimeout(() => setPreviewStatus('error'), 15000);
    return () => clearTimeout(timer);
  }, [previewStatus, previewHtml]);

  // If the page was refreshed while a run was active, attach to the backend
  // run instead of waiting for the user to submit again.
  useEffect(() => {
    if (initialRunStatus === 'running' && convId && attachRef.current !== convId) {
      attachRef.current = convId;
      attach(convId, sdkSessionId);
    }
  }, [initialRunStatus, convId, sdkSessionId, attach]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Extract HTML for preview — use output files / tool update events / regex
  useEffect(() => {
    // 1. Check initialOutputFiles (from persisted conversation)
    if (initialOutputFiles?.length) {
      setPreviewHtml(`http://localhost:3001/preview/${conversationId || convId}`);
      setPreviewStatus('ready');
      return;
    }
    // 2. Check all assistant messages' events for Write tool file paths
    for (const m of [...messages].reverse()) {
      if (m.role !== 'assistant' || !m.events) continue;
      for (const ev of [...m.events].reverse()) {
        // Check both tool_start (streaming) and tool_update (persisted) for file_path
        const input = ev.type === 'tool_update' ? ev.toolInput : ev.toolInput;
        const fp = input?.file_path || input?.path;
        if (fp && typeof fp === 'string' && /\.html?$/i.test(fp)) {
          setPreviewHtml(`http://localhost:3001/preview/${conversationId || convId}`);
          setPreviewStatus('ready');
          return;
        }
      }
    }
    // 3. Fallback: regex extraction from text content
    const textMsg = [...messages].reverse().find((m) => m.role === 'assistant' && m.content);
    if (textMsg) {
      const m = textMsg.content.match(/(?:<html[\s\S]*?<\/html>|<!(?:DOCTYPE|doctype)\s+html[\s\S]*?<\/html>)/i);
      if (m) {
        setPreviewHtml(m[0]);
        setPreviewStatus('ready');
      }
    }
  }, [messages, initialOutputFiles, conversationId, convId]);

  // Agent file writes imply that the workspace tree and preview may have changed.
  useEffect(() => {
    if (!messages.length) return;
    const latestMessage = messages[messages.length - 1];
    const events = latestMessage?.events || [];
    const event = events[events.length - 1];
    if (!event || !['tool_end', 'tool_update', 'mcp_call'].includes(event.type)) return;
    const signature = `${messages.length}:${events.length}:${event.type}:${event.toolId || ''}`;
    if (lastWorkspaceEventRef.current === signature) return;
    lastWorkspaceEventRef.current = signature;
    setWorkspaceRefreshKey((value) => value + 1);
    setPreviewRefreshKey((value) => value + 1);
  }, [messages]);

  const handleSubmit = () => {
    const text = input.trim();
    if ((!text && !attachments.length) || isStreaming) return;
    setInput('');
    const currentAttachments = attachments;
    setAttachments([]);
    sendMessage(text, conversationId || convId, currentAttachments, agentId);
  };

  const ensureConversation = async () => {
    const active = conversationId || convId;
    if (active && active !== 'new') return active;
    const response = await fetch('http://localhost:3001/chat/conversations/draft', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentId }) });
    if (!response.ok) throw new Error('无法创建会话');
    const draft = await response.json();
    setConversationId(draft.id);
    const params = new URLSearchParams({ sessionId: draft.id });
    if (agentId) params.set('agentId', agentId);
    window.history.replaceState(null, '', `/task/${draft.id}?${params.toString()}`);
    return draft.id as string;
  };

  const uploadImage = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      message.error('目前只支持图片文件');
      return false;
    }
    if (file.size > 10 * 1024 * 1024) {
      message.error('图片不能超过 10 MB');
      return false;
    }
    setUploading(true);
    try {
      const id = await ensureConversation();
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('图片读取失败'));
        reader.readAsDataURL(file);
      });
      const response = await fetch(`http://localhost:3001/workspace/${id}/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, mimeType: file.type, data }),
      });
      if (!response.ok) throw new Error('图片上传失败');
      const result = await response.json();
      if (!result.url || !result.path) throw new Error('上传接口未返回图片地址');
      setAttachments((current) => [...current, {
        name: file.name,
        mimeType: file.type,
        path: result.path,
        url: result.url,
      }]);
      message.success('图片已添加到当前工作区');
    } catch (error: any) {
      message.error(error.message || '图片上传失败');
    } finally {
      setUploading(false);
    }
    return false;
  };

  const uploadProps: UploadProps = {
    accept: 'image/*',
    showUploadList: false,
    beforeUpload: uploadImage,
  };

  const removeAttachment = (path: string) => {
    setAttachments((current) => current.filter((attachment) => attachment.path !== path));
  };

  const handleAskUserSubmit = async (payload: {
    requestId: string;
    answers: Record<string, string>;
  }) => {
    const res = await fetch('http://localhost:3001/agent/ask-user/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const error = await res.json().catch(() => ({}));
      throw new Error(error?.error || '回答提交失败');
    }
    setMessages((prev) => prev.map((item) => {
      if (item.role !== 'assistant') return item;
      const events = (item.events || []).map((event) => event.type === 'ask_user' && event.requestId === payload.requestId
        ? { ...event, status: 'submitted', answers: payload.answers }
        : event);
      return { ...item, events };
    }));
  };

  const bubbleItems = [
    ...messages.map((msg, i) => ({
      key: `${msg.role}-${i}`,
      role: msg.role === 'user' ? 'user' : 'ai',
      content: (
        <ChatMessageComponent
          message={msg}
          isStreaming={isStreaming && i === messages.length - 1}
          onAskUserSubmit={handleAskUserSubmit}
        />
      ),
    })),
  ];

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Left: Chat (narrower) */}
      <div className="w-[30%] max-w-[420px] min-w-[300px] border-r border-gray-200 bg-white flex flex-col">
        {/* Header */}
        <div className="flex-shrink-0 px-4 py-3 border-b border-gray-200 flex items-center justify-between">
          <Link href="/tasks" className="text-xs text-gray-500 hover:text-gray-700 transition-colors">
            ← 返回列表
          </Link>
          <div className="flex items-center gap-2">
            {isStreaming && (
              <Button
                size="small"
                danger
                onClick={() => void stop()}
              >
                停止
              </Button>
            )}
            <span className="text-xs text-gray-500">
              {isStreaming ? '生成中...' : '就绪'}
            </span>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-3 py-5">
          <Bubble.List
            rootClassName="chat-bubble-list"
            items={bubbleItems}
            autoScroll
            role={{
              ai: {
                placement: 'start',
                styles: {
                  body: { width: '100%', maxWidth: 'none', minWidth: 0 },
                  content: { background: 'transparent', padding: 0 },
                },
              },
              user: {
                placement: 'end',
                avatar: <Avatar size={28} icon={<UserOutlined />} className="chat-avatar chat-avatar-user" />,
                styles: { body: { maxWidth: '88%' } },
              },
            }}
          />
        </div>

        {/* Input */}
        <div className="flex-shrink-0 border-t border-gray-200 bg-white p-3">
          <div className="workspace-composer">
            {!!attachments.length && (
              <div className="workspace-composer-attachments">
                {attachments.map((attachment) => (
                  <div className="workspace-composer-attachment" key={attachment.path}>
                    <img src={attachment.url} alt={attachment.name} />
                    <button type="button" aria-label={`移除 ${attachment.name}`} onClick={() => removeAttachment(attachment.path)}>×</button>
                  </div>
                ))}
              </div>
            )}
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  handleSubmit();
                }
              }}
              disabled={isStreaming}
              placeholder="描述你想创建或修改的内容..."
              rows={4}
            />
            <div className="workspace-composer-footer">
              <Upload {...uploadProps} disabled={isStreaming || uploading}>
                <Tooltip title="添加图片"><Button type="text" icon={<PaperClipOutlined />} loading={uploading} /></Tooltip>
              </Upload>
              <span className="workspace-composer-hint">Enter 发送 · Shift + Enter 换行</span>
              <Button type="primary" shape="circle" icon={<SendOutlined />} disabled={(!input.trim() && !attachments.length) || isStreaming} onClick={handleSubmit} />
            </div>
          </div>
        </div>
      </div>

      {/* Right: Preview (wider) */}
      <div className="workspace-main flex-1 min-w-0">
        <div className="workspace-main-header">
          <Tabs
            activeKey={activeWorkspaceTab}
            onChange={(key) => {
              setActiveWorkspaceTab(key as 'preview' | 'code');
              if (key === 'preview') setPreviewRefreshKey((value) => value + 1);
            }}
            items={[...(agentType !== 'other' ? [{ key: 'preview', label: '页面预览' }] : []), { key: 'code', label: <span><CodeOutlined /> 代码</span> }]}
          />
          {activeWorkspaceTab === 'preview' && agentType !== 'other' && (
            <Segmented
              value={device}
              onChange={(value) => setDevice(value as 'desktop' | 'mobile')}
              options={[{ value: 'desktop', label: '桌面端', icon: <DesktopOutlined /> }, { value: 'mobile', label: '移动端', icon: <MobileOutlined /> }]}
            />
          )}
        </div>
        <div className="workspace-main-content">
          {activeWorkspaceTab === 'preview' && agentType !== 'other' ? (
            <PreviewPanel html={previewHtml} loading={previewStatus === 'loading'} error={previewStatus === 'error'} refreshKey={previewRefreshKey} device={device} />
          ) : (
            <WorkspaceEditor conversationId={(conversationId || convId) !== 'new' ? (conversationId || convId) : undefined} refreshKey={workspaceRefreshKey} onSaved={() => setPreviewRefreshKey((value) => value + 1)} />
          )}
        </div>
      </div>
    </div>
  );
}

export default function TaskPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const convId = params?.id as string;
  const queryAgentId = searchParams.get('agentId') || undefined;
  const queryAgentCode = searchParams.get('agentCode') || undefined;
  const querySessionId = searchParams.get('sessionId') || undefined;
  const isNew = convId === 'new';
  const [loading, setLoading] = useState(true);
  const [initialData, setInitialData] = useState<{
    msgs: ChatMessage[];
    convId: string;
    sdkSessionId?: string;
    outputFiles?: string[];
    runStatus?: string;
    agentId?: string;
    agentType?: 'codegen' | 'other';
  } | undefined>();

  useEffect(() => {
    if (isNew) {
      const conversationParams = new URLSearchParams();
      if (queryAgentCode) conversationParams.set('agentCode', queryAgentCode);
      else if (queryAgentId) conversationParams.set('agentId', queryAgentId);
      window.history.replaceState(null, '', `/conversations${conversationParams.toString() ? `?${conversationParams.toString()}` : ''}`);
      if (!queryAgentId && !queryAgentCode) {
        setLoading(false);
        return;
      }
      const agentEndpoint = queryAgentCode
        ? `http://localhost:3001/agents/code/${encodeURIComponent(queryAgentCode)}`
        : `http://localhost:3001/agents/${encodeURIComponent(queryAgentId as string)}`;
      fetch(agentEndpoint)
        .then((response) => response.ok ? response.json() : undefined)
        .then((agent) => {
          setInitialData({ msgs: [], convId: 'new', agentId: agent?.id || queryAgentId, agentType: agent?.type });
        })
        .finally(() => setLoading(false));
      return;
    }
    fetch(`http://localhost:3001/chat/conversations/${convId}`)
      .then((r) => r.json())
      .then((data) => {
        const msgs: ChatMessage[] = (data.messages || []).map((m: any) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          thinkingChain: m.thinkingChain || undefined,
          events: m.events ? (typeof m.events === 'string' ? JSON.parse(m.events) : m.events) : undefined,
          attachments: m.attachments ? (typeof m.attachments === 'string' ? JSON.parse(m.attachments) : m.attachments) : undefined,
        }));
        // Parse output files from conversation
        let outputFiles: string[] | undefined;
        if (data.outputFiles) {
          try { outputFiles = JSON.parse(data.outputFiles); } catch { outputFiles = [data.outputFiles]; }
        }
        setInitialData({
          msgs,
          convId: data.id,
          sdkSessionId: data.sdkSessionId || querySessionId || undefined,
          outputFiles,
          runStatus: data.runStatus || undefined,
          agentId: data.agentId || queryAgentId,
          agentType: data.agentType || undefined,
        });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [convId, isNew, queryAgentId, queryAgentCode, querySessionId]);

  if (loading) {
    return (
      <div className="h-screen bg-[#0f0f0f] flex items-center justify-center">
        <div className="inline-block w-8 h-8 border-2 border-gray-600 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <TaskChat
      convId={isNew ? undefined : (initialData?.convId || convId)}
      initialMsgs={isNew ? undefined : initialData?.msgs}
      sdkSessionId={isNew ? undefined : initialData?.sdkSessionId}
      initialOutputFiles={isNew ? undefined : initialData?.outputFiles}
      initialRunStatus={isNew ? undefined : initialData?.runStatus}
      agentId={isNew ? queryAgentId : (initialData?.agentId || queryAgentId)}
      agentType={initialData?.agentType}
    />
  );
}
