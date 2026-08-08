'use client';

import React, { useEffect, useState } from 'react';
import { Button, Form, Input, Modal, Popconfirm, Select, Space, Table, message } from 'antd';
import { EditOutlined, PlusOutlined } from '@ant-design/icons';
import AdminShell from '../components/AdminShell';

const API = 'http://localhost:3001';
type Group = { id: string; name: string; description: string; skillNames: string[]; mcpNames: string[] };
type Option = { name: string; description?: string };

export default function SkillGroupsPage() {
  const [groups, setGroups] = useState<Group[]>([]); const [skills, setSkills] = useState<Option[]>([]); const [mcps, setMcps] = useState<Option[]>([]); const [open, setOpen] = useState(false); const [editing, setEditing] = useState<Group>(); const [form] = Form.useForm();
  const load = async () => { const [g, s, m] = await Promise.all([fetch(`${API}/skill-groups`), fetch(`${API}/skills`), fetch(`${API}/mcps`)]); setGroups(await g.json()); setSkills(await s.json()); setMcps(await m.json()); };
  useEffect(() => { void load(); }, []);
  const show = (row?: Group) => { setEditing(row); form.setFieldsValue(row || { skillNames: [], mcpNames: [] }); setOpen(true); };
  const submit = async (values: any) => { const response = await fetch(editing ? `${API}/skill-groups/${editing.id}` : `${API}/skill-groups`, { method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) }); if (!response.ok) { const data = await response.json().catch(() => ({})); message.error(data.message || '保存失败'); return; } setOpen(false); message.success('分组已保存'); await load(); };
  const remove = async (id: string) => { const response = await fetch(`${API}/skill-groups/${id}`, { method: 'DELETE' }); if (response.ok) { message.success('分组已删除'); await load(); } };
  return <AdminShell><div className="mb-4 flex items-center justify-between"><div><h1 className="text-xl font-semibold">Skill 分组</h1><p className="text-sm text-gray-500">把已有 Skill 和 MCP 组合成可复用的工作配置</p></div><Button type="primary" icon={<PlusOutlined />} onClick={() => show()}>新增分组</Button></div><Table rowKey="id" dataSource={groups} columns={[{ title: '名称', dataIndex: 'name' }, { title: '描述', dataIndex: 'description' }, { title: 'Skill', dataIndex: 'skillNames', render: (v: string[]) => v.join('、') || '未绑定' }, { title: 'MCP', dataIndex: 'mcpNames', render: (v: string[]) => v.join('、') || '未绑定' }, { title: '操作', render: (_: unknown, row: Group) => <Space><Button type="link" icon={<EditOutlined />} onClick={() => show(row)}>编辑</Button><Popconfirm title="确定删除这个分组？" onConfirm={() => void remove(row.id)}><Button type="link" danger>删除</Button></Popconfirm></Space> }]} /><Modal open={open} title={editing ? '编辑 Skill 分组' : '新增 Skill 分组'} destroyOnClose footer={null} onCancel={() => setOpen(false)}><Form form={form} layout="vertical" onFinish={submit} className="pt-4"><Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="description" label="描述"><Input /></Form.Item><Form.Item name="skillNames" label="Skill"><Select mode="multiple" options={skills.map((v) => ({ value: v.name, label: v.name }))} /></Form.Item><Form.Item name="mcpNames" label="MCP"><Select mode="multiple" options={mcps.map((v) => ({ value: v.name, label: v.name }))} /></Form.Item><div className="flex justify-end gap-2"><Button onClick={() => setOpen(false)}>取消</Button><Button type="primary" htmlType="submit">保存</Button></div></Form></Modal></AdminShell>;
}
