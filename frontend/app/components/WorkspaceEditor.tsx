'use client';

import dynamic from 'next/dynamic';
import React, { useCallback, useEffect, useState } from 'react';
import { Button, Empty, Input, Modal, Spin, Tooltip, message } from 'antd';
import {
  DeleteOutlined,
  FileAddOutlined,
  FolderAddOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
  SaveOutlined,
} from '@ant-design/icons';

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

const API = 'http://localhost:3001';

interface WorkspaceNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: WorkspaceNode[];
}

interface Props {
  conversationId?: string;
  refreshKey?: number;
  onSaved?: () => void;
}

function TreeNode({
  node,
  selected,
  onSelect,
}: {
  node: WorkspaceNode;
  selected?: string;
  onSelect: (node: WorkspaceNode) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        type="button"
        className={`workspace-tree-row ${selected === node.path ? 'is-selected' : ''}`}
        onClick={() => node.type === 'directory' ? setOpen((value) => !value) : onSelect(node)}
      >
        <span className="workspace-tree-chevron">{node.type === 'directory' ? (open ? '⌄' : '›') : ''}</span>
        {node.type === 'directory' ? <FolderOpenOutlined /> : <FileAddOutlined />}
        <span className="workspace-tree-name" title={node.path}>{node.name}</span>
      </button>
      {node.type === 'directory' && open && node.children?.map((child) => (
        <div className="workspace-tree-child" key={child.path}>
          <TreeNode node={child} selected={selected} onSelect={onSelect} />
        </div>
      ))}
    </div>
  );
}

export default function WorkspaceEditor({ conversationId, refreshKey = 0, onSaved }: Props) {
  const [nodes, setNodes] = useState<WorkspaceNode[]>([]);
  const [selectedPath, setSelectedPath] = useState<string>();
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [language, setLanguage] = useState('plaintext');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState<'file' | 'folder' | null>(null);
  const [newName, setNewName] = useState('');

  const loadTree = useCallback(async () => {
    if (!conversationId) return;
    setLoading(true);
    try {
      const response = await fetch(`${API}/workspace/${conversationId}/tree`);
      const data = await response.json();
      setNodes(data.nodes || []);
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => { void loadTree(); }, [loadTree, refreshKey]);

  const openFile = async (node: WorkspaceNode) => {
    setSelectedPath(node.path);
    const response = await fetch(`${API}/workspace/${conversationId}/file?path=${encodeURIComponent(node.path)}`);
    if (!response.ok) {
      message.error('文件读取失败');
      return;
    }
    const data = await response.json();
    setContent(data.content || '');
    setSavedContent(data.content || '');
    setLanguage(data.language || 'plaintext');
  };

  const saveFile = async () => {
    if (!conversationId || !selectedPath || content === savedContent) return;
    setSaving(true);
    try {
      const response = await fetch(`${API}/workspace/${conversationId}/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: selectedPath, content }),
      });
      if (!response.ok) throw new Error('保存失败');
      setSavedContent(content);
      message.success('文件已保存');
      onSaved?.();
      await loadTree();
    } catch (error: any) {
      message.error(error.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const createNode = async () => {
    const value = newName.trim();
    if (!conversationId || !value) return;
    const base = selectedPath?.includes('/') ? selectedPath.slice(0, selectedPath.lastIndexOf('/')) : '.';
    const target = base === '.' ? value : `${base}/${value}`;
    const endpoint = modal === 'folder' ? 'folder' : 'file';
    const response = await fetch(`${API}/workspace/${conversationId}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(modal === 'folder' ? { path: target } : { path: target, content: '' }),
    });
    if (!response.ok) {
      message.error('创建失败');
      return;
    }
    setModal(null);
    setNewName('');
    await loadTree();
  };

  const deleteNode = async () => {
    if (!conversationId || !selectedPath) return;
    Modal.confirm({
      title: `删除 ${selectedPath}`,
      content: '删除目录会同时删除其中的文件，是否继续？',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await fetch(`${API}/workspace/${conversationId}/node?path=${encodeURIComponent(selectedPath)}`, { method: 'DELETE' });
        setSelectedPath(undefined);
        setContent('');
        await loadTree();
      },
    });
  };

  const dirty = content !== savedContent;
  const hasWorkspace = Boolean(conversationId);

  return (
    <div className="workspace-editor">
      <div className="workspace-toolbar">
        <div className="workspace-toolbar-title"><FolderOpenOutlined /> 文件</div>
        <div className="workspace-toolbar-actions">
          <Tooltip title="新建文件"><Button type="text" size="small" icon={<FileAddOutlined />} onClick={() => setModal('file')} disabled={!hasWorkspace} /></Tooltip>
          <Tooltip title="新建文件夹"><Button type="text" size="small" icon={<FolderAddOutlined />} onClick={() => setModal('folder')} disabled={!hasWorkspace} /></Tooltip>
          <Tooltip title="刷新文件树"><Button type="text" size="small" icon={<ReloadOutlined />} onClick={() => void loadTree()} disabled={!hasWorkspace} /></Tooltip>
          <Tooltip title="删除选中项"><Button type="text" size="small" danger icon={<DeleteOutlined />} onClick={() => void deleteNode()} disabled={!selectedPath} /></Tooltip>
        </div>
      </div>
      <div className="workspace-editor-body">
        <aside className="workspace-tree">
          {loading ? <div className="workspace-loading"><Spin size="small" /></div> : nodes.length ? nodes.map((node) => <TreeNode key={node.path} node={node} selected={selectedPath} onSelect={openFile} />) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无文件" />}
        </aside>
        <section className="workspace-code-panel">
          <div className="workspace-code-header">
            <span className="workspace-file-path">{selectedPath || '选择文件开始编辑'}</span>
            <Button size="small" type="primary" icon={<SaveOutlined />} disabled={!selectedPath || !dirty} loading={saving} onClick={() => void saveFile()}>保存</Button>
          </div>
          {selectedPath ? (
            <MonacoEditor
              height="100%"
              language={language}
              theme="vs-light"
              value={content}
              onChange={(value) => setContent(value || '')}
              options={{ minimap: { enabled: false }, fontSize: 13, wordWrap: 'on', automaticLayout: true, padding: { top: 12 } }}
            />
          ) : <Empty className="workspace-empty-editor" image={Empty.PRESENTED_IMAGE_SIMPLE} description="从左侧选择文件" />}
        </section>
      </div>
      <Modal open={Boolean(modal)} title={modal === 'folder' ? '新建文件夹' : '新建文件'} okText="创建" cancelText="取消" onOk={() => void createNode()} onCancel={() => { setModal(null); setNewName(''); }}>
        <Input autoFocus value={newName} onChange={(event) => setNewName(event.target.value)} placeholder={modal === 'folder' ? '例如 components' : '例如 page.tsx'} onPressEnter={() => void createNode()} />
      </Modal>
    </div>
  );
}
