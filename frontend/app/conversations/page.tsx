'use client';

import React, { Suspense, useEffect, useState } from 'react';
import { Avatar, Button, Select, Tooltip, Upload, message } from 'antd';
import type { UploadProps } from 'antd';
import { PaperClipOutlined, RobotOutlined, SendOutlined } from '@ant-design/icons';
import { useRouter, useSearchParams } from 'next/navigation';
import AdminShell from '../components/AdminShell';
import { ChatAttachment } from '../hooks/useChatSSE';

const API = 'http://localhost:3001';
type AgentOption = { id: string; code: string; name: string; type: 'codegen' | 'other'; description?: string };

function ConversationsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const queryAgentId = searchParams.get('agentId') || undefined;
  const queryAgentCode = searchParams.get('agentCode') || undefined;
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [agentId, setAgentId] = useState<string>();
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [conversationId, setConversationId] = useState<string>();

  useEffect(() => {
    fetch(`${API}/agents`).then((response) => response.json()).then((data: AgentOption[]) => {
      setAgents(data);
      setAgentId(queryAgentId || data.find((item) => item.code === queryAgentCode)?.id);
    });
  }, [queryAgentId, queryAgentCode]);

  const ensureConversation = async () => {
    if (!agentId) throw new Error('请先选择智能体');
    if (conversationId) return conversationId;
    const response = await fetch(`${API}/chat/conversations/draft`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentId }) });
    if (!response.ok) throw new Error('无法创建会话');
    const data = await response.json();
    setConversationId(data.id);
    window.history.replaceState(null, '', `/conversations?agentCode=${encodeURIComponent(agents.find((item) => item.id === agentId)?.code || '')}`);
    return data.id as string;
  };

  const uploadImage = async (file: File) => {
    if (!agentId) { message.warning('请先选择智能体'); return false; }
    if (!file.type.startsWith('image/')) { message.error('目前只支持图片文件'); return false; }
    if (file.size > 10 * 1024 * 1024) { message.error('图片不能超过 10 MB'); return false; }
    setUploading(true);
    try {
      const id = await ensureConversation();
      const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('图片读取失败')); reader.readAsDataURL(file); });
      const response = await fetch(`${API}/workspace/${id}/upload`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: file.name, mimeType: file.type, data }) });
      if (!response.ok) throw new Error('图片上传失败');
      const result = await response.json();
      setAttachments((current) => [...current, { name: file.name, mimeType: file.type, path: result.path, url: result.url }]);
    } catch (error: any) { message.error(error.message || '图片上传失败'); } finally { setUploading(false); }
    return false;
  };

  const submit = async () => {
    const text = input.trim();
    if (!agentId) { message.warning('请先选择智能体'); return; }
    if ((!text && !attachments.length) || submitting || uploading) return;
    setSubmitting(true);
    try {
      const id = await ensureConversation();
      const currentAttachments = attachments;
      const agentCode = agents.find((item) => item.id === agentId)?.code;
      const response = await fetch(`${API}/agent/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: text,
          conversationId: id,
          attachments: currentAttachments,
          agentId,
        }),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || `启动任务失败（HTTP ${response.status}）`);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('任务启动响应为空');

      const decoder = new TextDecoder();
      let buffer = '';
      let eventName = '';
      let sdkSessionId = '';
      while (!sdkSessionId) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          const valueLine = line.trim();
          if (valueLine.startsWith('event: ')) {
            eventName = valueLine.slice(7);
            continue;
          }
          if (!valueLine.startsWith('data: ')) continue;
          let data: any;
          try { data = JSON.parse(valueLine.slice(6)); } catch { continue; }
          if (eventName === 'error') throw new Error(data.message || '任务启动失败');
          if (eventName === 'meta' && data.sdkSessionId) {
            sdkSessionId = data.sdkSessionId;
            break;
          }
        }
      }
      if (!sdkSessionId) throw new Error('未获取到 SDK sessionId');
      await reader.cancel();
      reader.releaseLock();
      const params = new URLSearchParams({ sessionId: sdkSessionId });
      if (agentCode) params.set('agentCode', agentCode);
      router.push(`/task/${id}?${params.toString()}`);
    } catch (error: any) { message.error(error.message || '发送失败'); }
    finally { setSubmitting(false); }
  };

  const uploadProps: UploadProps = { accept: 'image/*', showUploadList: false, beforeUpload: uploadImage };
  const selectedAgent = agents.find((item) => item.id === agentId);

  const canCompose = Boolean(agentId) && !submitting && !uploading;

  return <AdminShell>
    <div className="conversation-shell">
      <header className="conversation-header">
        <div className="conversation-brand"><Avatar size={40} icon={<RobotOutlined />} className="chat-avatar chat-avatar-ai" /><div><div className="conversation-title">Muse Studio</div><div className="conversation-subtitle">AI 前端与多智能体工作区</div></div></div>
        <div className="conversation-agent-picker"><span>当前智能体</span><Select className="conversation-agent-select" value={agentId} disabled={Boolean(conversationId) || submitting} onChange={setAgentId} options={agents.map((item) => ({ value: item.id, label: `${item.name} · ${item.type === 'codegen' ? '生码' : '其他'}` }))} placeholder="请选择智能体" />{selectedAgent?.description && <span className="conversation-agent-description">{selectedAgent.description}</span>}</div>
      </header>
      <footer className="conversation-composer-wrap">
        <div className={`conversation-composer ${!agentId ? 'is-disabled' : ''}`}>
          {!!attachments.length && <div className="conversation-attachments">{attachments.map((item) => <div key={item.path} className="conversation-attachment"><img src={item.url} alt={item.name} /><button type="button" aria-label={`移除 ${item.name}`} onClick={() => setAttachments((current) => current.filter((value) => value.path !== item.path))}>×</button></div>)}</div>}
          <textarea className="conversation-textarea" value={input} disabled={!canCompose} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit(); } }} placeholder={agentId ? '输入你想处理的内容...' : '请先选择智能体'} />
          <div className="conversation-composer-footer"><Upload {...uploadProps} disabled={!canCompose}><Tooltip title={agentId ? '上传图片' : '请先选择智能体'}><Button type="text" disabled={!agentId || submitting} icon={<PaperClipOutlined />} loading={uploading} /></Tooltip></Upload><span className="conversation-composer-hint">Enter 发送 · Shift + Enter 换行</span><Button type="primary" shape="circle" icon={<SendOutlined />} loading={submitting} disabled={!agentId || (!input.trim() && !attachments.length) || submitting || uploading} onClick={() => void submit()} /></div>
        </div>
      </footer>
    </div>
  </AdminShell>;
}

export default function ConversationsPage() {
  return (
    <Suspense fallback={<AdminShell><div className="conversation-shell" /></AdminShell>}>
      <ConversationsContent />
    </Suspense>
  );
}
