'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, message } from 'antd';
import { EditOutlined, PlusOutlined, RobotOutlined } from '@ant-design/icons';
import AdminShell from '../components/AdminShell';

const API = 'http://localhost:3001';
type Agent = { id: string; name: string; description: string; prompt: string; type: 'codegen' | 'other'; skillGroupId?: string; skillGroup?: { name: string }; mcpNames: string[] };
type Group = { id: string; name: string; description: string; skillNames: string[]; mcpNames: string[] };
type Mcp = { name: string; description: string };

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [mcps, setMcps] = useState<Mcp[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Agent>();
  const [form] = Form.useForm();

  const load = async () => {
    const [a, g, m] = await Promise.all([fetch(`${API}/agents`), fetch(`${API}/skill-groups`), fetch(`${API}/mcps`)]);
    setAgents(await a.json()); setGroups(await g.json()); setMcps(await m.json());
  };
  useEffect(() => { void load(); }, []);
  const show = (agent?: Agent) => { setEditing(agent); form.setFieldsValue(agent || { type: 'codegen', mcpNames: [] }); setOpen(true); };
  const submit = async (values: any) => {
    const response = await fetch(editing ? `${API}/agents/${editing.id}` : `${API}/agents`, { method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
    if (!response.ok) { const data = await response.json().catch(() => ({})); message.error(data.message || '保存失败'); return; }
    message.success(editing ? '智能体已更新' : '智能体已创建'); setOpen(false); await load();
  };
  const remove = async (id: string) => { const response = await fetch(`${API}/agents/${id}`, { method: 'DELETE' }); if (response.ok) { message.success('智能体已删除'); await load(); } };

  return <AdminShell>
    <div className="mb-4 flex items-center justify-between"><div><h1 className="text-xl font-semibold">智能体</h1><p className="text-sm text-gray-500">配置不同工作目标、提示词和工具范围</p></div><Button type="primary" icon={<PlusOutlined />} onClick={() => show()}>新增智能体</Button></div>
    <Table rowKey="id" dataSource={agents} columns={[
      { title: '名称', dataIndex: 'name', render: (name: string, row: Agent) => <Link href={`/tasks?agentId=${row.id}`}><Space><RobotOutlined />{name}</Space></Link> },
      { title: '类型', dataIndex: 'type', render: (type: Agent['type']) => <Tag color={type === 'codegen' ? 'blue' : 'default'}>{type === 'codegen' ? '生码' : '其他'}</Tag> },
      { title: 'Skill 分组', render: (_: unknown, row: Agent) => row.skillGroup?.name || '未绑定' },
      { title: 'MCP', render: (_: unknown, row: Agent) => row.mcpNames.length ? row.mcpNames.join('、') : '未绑定' },
      { title: '操作', render: (_: unknown, row: Agent) => <Space><Button type="link" icon={<EditOutlined />} onClick={() => show(row)}>编辑</Button><Popconfirm title="确定删除这个智能体？" onConfirm={() => void remove(row.id)}><Button type="link" danger>删除</Button></Popconfirm></Space> },
    ]} />
    <Modal open={open} title={editing ? '编辑智能体' : '新增智能体'} destroyOnClose footer={null} onCancel={() => setOpen(false)}>
      <Form form={form} layout="vertical" onFinish={submit} className="pt-4">
        <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}><Input placeholder="例如 前端实现助手" /></Form.Item>
        <Form.Item name="description" label="描述"><Input placeholder="说明智能体适合处理什么问题" /></Form.Item>
        <Form.Item name="type" label="类型" rules={[{ required: true }]}><Select options={[{ value: 'codegen', label: '生码' }, { value: 'other', label: '其他' }]} /></Form.Item>
        <Form.Item name="prompt" label="提示词"><Input.TextArea rows={5} placeholder="输入智能体的角色、边界和工作要求" /></Form.Item>
        <Form.Item name="skillGroupId" label="Skill 分组"><Select allowClear placeholder="选择 Skill 分组" options={groups.map((item) => ({ value: item.id, label: item.name }))} /></Form.Item>
        <Form.Item name="mcpNames" label="绑定 MCP"><Select mode="multiple" placeholder="选择 MCP" options={mcps.map((item) => ({ value: item.name, label: item.name }))} /></Form.Item>
        <div className="flex justify-end gap-2"><Button onClick={() => setOpen(false)}>取消</Button><Button type="primary" htmlType="submit">保存</Button></div>
      </Form>
    </Modal>
  </AdminShell>;
}
