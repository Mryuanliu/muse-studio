'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button, Form, Input, Modal, Popconfirm, Space, Table, Tag, message } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import AdminShell from '../components/AdminShell';

const API = 'http://localhost:3001';
type Skill = { id?: string; name: string; description: string; path: string; enabled: boolean; builtin?: boolean };

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]); const [loading, setLoading] = useState(true); const [open, setOpen] = useState(false); const [editing, setEditing] = useState<Skill>(); const [form] = Form.useForm();
  const load = async () => { setLoading(true); try { const response = await fetch(`${API}/skills`); setSkills(await response.json()); } finally { setLoading(false); } };
  useEffect(() => { void load(); }, []);
  const show = async (skill?: Skill) => { setEditing(skill); if (skill) { const response = await fetch(`${API}/skills/${encodeURIComponent(skill.name)}`); const data = await response.json(); form.setFieldsValue(data); } else form.resetFields(); setOpen(true); };
  const submit = async (values: any) => { const endpoint = editing ? `${API}/skills/${encodeURIComponent(editing.name)}` : `${API}/skills`; const response = await fetch(endpoint, { method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) }); if (!response.ok) { const data = await response.json().catch(() => ({})); message.error(data.message || '保存失败'); return; } message.success('Skill 已保存'); setOpen(false); await load(); };
  const toggle = async (skill: Skill) => { const response = await fetch(`${API}/skills/${encodeURIComponent(skill.name)}/toggle`, { method: 'POST' }); if (response.ok) await load(); };
  const remove = async (skill: Skill) => { const response = await fetch(`${API}/skills/${encodeURIComponent(skill.name)}`, { method: 'DELETE' }); if (!response.ok) { const data = await response.json().catch(() => ({})); message.error(data.message || '删除失败'); return; } message.success('Skill 已删除'); await load(); };
  return <AdminShell><div className="mb-4 flex items-center justify-between"><div><h1 className="text-xl font-semibold">Skill 管理</h1><p className="text-sm text-gray-500">管理可被智能体和任务使用的技能规范</p></div><Space><Link href="/skill-groups"><Button>Skill 分组</Button></Link><Button type="primary" icon={<PlusOutlined />} onClick={() => void show()}>新增 Skill</Button></Space></div><Table rowKey="name" loading={loading} dataSource={skills} columns={[{ title: '名称', dataIndex: 'name' }, { title: '描述', dataIndex: 'description', render: (v: string) => v || '暂无描述' }, { title: '状态', dataIndex: 'enabled', render: (v: boolean) => <Tag color={v ? 'green' : 'default'}>{v ? '已启用' : '已停用'}</Tag> }, { title: '来源', dataIndex: 'builtin', render: (v: boolean) => v ? '内置' : '自定义' }, { title: '操作', render: (_: unknown, row: Skill) => <Space><Button type="link" icon={<EditOutlined />} onClick={() => void show(row)}>编辑</Button><Button type="link" onClick={() => void toggle(row)}>{row.enabled ? '停用' : '启用'}</Button><Popconfirm title="确定删除这个 Skill？" onConfirm={() => void remove(row)} disabled={row.builtin}><Button type="link" danger icon={<DeleteOutlined />} disabled={row.builtin}>删除</Button></Popconfirm></Space> }]} /><Modal open={open} title={editing ? '编辑 Skill' : '新增 Skill'} destroyOnClose footer={null} onCancel={() => setOpen(false)}><Form form={form} layout="vertical" onFinish={submit} className="pt-4"><Form.Item name="name" label="名称" rules={[{ required: true }]}><Input disabled={Boolean(editing)} placeholder="例如 accessibility-review" /></Form.Item><Form.Item name="description" label="描述"><Input /></Form.Item><Form.Item name="content" label="SKILL.md 内容" rules={[{ required: true, message: '请输入 Skill 内容' }]}><Input.TextArea rows={14} placeholder="使用 frontmatter 描述 Skill 的名称和用途" /></Form.Item><div className="flex justify-end gap-2"><Button onClick={() => setOpen(false)}>取消</Button><Button type="primary" htmlType="submit">保存</Button></div></Form></Modal></AdminShell>;
}
