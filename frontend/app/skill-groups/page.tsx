'use client';

import React, { useEffect, useState } from 'react';
import { Button, Drawer, Form, Input, Popconfirm, Select, Space, Table, message } from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import AdminShell from '../components/AdminShell';

const API = 'http://localhost:3001';
type Group = { id: string; name: string; description: string; skillNames: string[] };
type Skill = { name: string };

export default function SkillGroupsPage() {
  const [groups, setGroups] = useState<Group[]>([]); const [skills, setSkills] = useState<Skill[]>([]); const [open, setOpen] = useState(false); const [editing, setEditing] = useState<Group>(); const [form] = Form.useForm();
  const load = async () => { const [g, s] = await Promise.all([fetch(`${API}/skill-groups`), fetch(`${API}/skills`)]); setGroups(await g.json()); setSkills(await s.json()); };
  useEffect(() => { void load(); }, []);
  const show = (row?: Group) => { setEditing(row); form.setFieldsValue(row || { skillNames: [] }); setOpen(true); };
  const submit = async (values: any) => { const response = await fetch(editing ? `${API}/skill-groups/${editing.id}` : `${API}/skill-groups`, { method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) }); if (!response.ok) { const data = await response.json().catch(() => ({})); message.error(data.message || '保存失败'); return; } setOpen(false); message.success('分组已保存'); await load(); };
  const remove = async (id: string) => { const response = await fetch(`${API}/skill-groups/${id}`, { method: 'DELETE' }); if (response.ok) { message.success('分组已删除'); await load(); } };
  return <AdminShell><div className="mb-4 flex items-center justify-between"><div><h1 className="text-xl font-semibold">Skill 分组</h1><p className="text-sm text-gray-500">把已有 Skill 组合成可复用配置</p></div><Button type="primary" icon={<PlusOutlined />} onClick={() => show()}>新增分组</Button></div><Table rowKey="id" dataSource={groups} columns={[{ title: '名称', dataIndex: 'name' }, { title: '描述', dataIndex: 'description' }, { title: 'Skill', dataIndex: 'skillNames', render: (v: string[]) => v.join('、') || '未绑定' }, { title: '操作', render: (_: unknown, row: Group) => <Space><Button type="link" icon={<EditOutlined />} onClick={() => show(row)}>编辑</Button><Popconfirm title="确定删除这个分组？" onConfirm={() => void remove(row.id)}><Button type="link" danger icon={<DeleteOutlined />}>删除</Button></Popconfirm></Space> }]} /><Drawer open={open} width={560} title={editing ? '编辑 Skill 分组' : '新增 Skill 分组'} destroyOnClose onClose={() => setOpen(false)} extra={<Button type="primary" onClick={() => form.submit()}>保存</Button>}><Form form={form} layout="vertical" onFinish={submit} className="pt-4"><Form.Item name="name" label="名称" rules={[{ required: true }]}><Input /></Form.Item><Form.Item name="description" label="描述"><Input /></Form.Item><Form.Item name="skillNames" label="绑定 Skill"><Select mode="multiple" options={skills.map((v) => ({ value: v.name, label: v.name }))} /></Form.Item></Form></Drawer></AdminShell>;
}
