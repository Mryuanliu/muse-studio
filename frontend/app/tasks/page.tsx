'use client';

import React from 'react';
import Link from 'next/link';
import { Button, Space, Tag } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { ProTable } from '@ant-design/pro-components';
import AdminShell from '../components/AdminShell';

interface Conversation {
  id: string;
  title: string;
  sdkSessionId: string | null;
  status: string;
  messageCount?: number;
  createdAt: string;
  updatedAt: string;
}

export default function TasksPage() {
  return (
    <AdminShell>
      <ProTable<Conversation>
        rowKey="id"
        search={false}
        pagination={{ pageSize: 10 }}
        toolBarRender={() => [
          <Link key="new" href="/task/new">
            <Button type="primary" icon={<PlusOutlined />}>新建任务</Button>
          </Link>,
        ]}
        request={async () => {
          const res = await fetch('http://localhost:3001/chat/conversations');
          const data = await res.json();
          return { data, success: true, total: data.length };
        }}
        columns={[
          {
            title: '任务标题',
            dataIndex: 'title',
            render: (_, record) => (
              <Link href={`/task/${record.id}`} className="text-blue-600">
                {record.title}
              </Link>
            ),
          },
          {
            title: '状态',
            dataIndex: 'status',
            render: (_, record) => (
              <Tag color={record.sdkSessionId ? 'green' : 'default'}>
                {record.sdkSessionId ? '可续跑' : record.status}
              </Tag>
            ),
          },
          {
            title: '消息数',
            dataIndex: 'messageCount',
            width: 100,
          },
          {
            title: '更新时间',
            dataIndex: 'updatedAt',
            width: 200,
            render: (_, record) => new Date(record.updatedAt).toLocaleString('zh-CN'),
          },
          {
            title: '操作',
            valueType: 'option',
            render: (_, record) => [
              <Link key="open" href={`/task/${record.id}`}>进入</Link>,
            ],
          },
        ]}
      />
    </AdminShell>
  );
}
