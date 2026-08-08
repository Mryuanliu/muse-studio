'use client';

import React from 'react';
import Link from 'next/link';
import { Button, Popconfirm, Tag, message } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { ProTable } from '@ant-design/pro-components';
import type { ActionType } from '@ant-design/pro-components';
import AdminShell from '../components/AdminShell';

interface Conversation {
  id: string;
  title: string;
  sdkSessionId: string | null;
  status: string;
  runStatus?: string;
  messageCount?: number;
  createdAt: string;
  updatedAt: string;
  agentId?: string;
}

export default function TasksPage() {
  const actionRef = React.useRef<ActionType>(null);
  const stopTask = async (id: string) => {
    const res = await fetch('http://localhost:3001/agent/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: id }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      message.error(data.error || '停止失败');
      return;
    }
    message.success(data.message || '已停止');
    actionRef.current?.reload();
  };

  return (
    <AdminShell>
      <ProTable<Conversation>
        actionRef={actionRef}
        rowKey="id"
        search={false}
        pagination={{ pageSize: 10 }}
        toolBarRender={() => []}
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
            render: (_, record) => {
              const runStatus = record.runStatus || record.status;
              const color = runStatus === 'running'
                ? 'processing'
                : runStatus === 'completed'
                  ? 'success'
                  : runStatus === 'error'
                    ? 'error'
                    : 'default';
              const label = runStatus === 'running'
                ? '生成中'
                : runStatus === 'completed'
                  ? '已完成'
                  : runStatus === 'error'
                    ? '失败'
                    : record.sdkSessionId
                      ? '可续跑'
                      : runStatus;
              return <Tag color={color}>{label}</Tag>;
            },
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
              <Link key="open" href={`/task/${record.id}${record.agentId ? `?agentId=${record.agentId}` : ''}`}>进入</Link>,
              <Popconfirm
                key="stop"
                title="确定结束当前本轮生成？"
                disabled={record.runStatus !== 'running'}
                onConfirm={() => stopTask(record.id)}
              >
                <Button
                  type="link"
                  danger
                  size="small"
                  disabled={record.runStatus !== 'running'}
                >
                  停止
                </Button>
              </Popconfirm>,
            ],
          },
        ]}
      />
    </AdminShell>
  );
}
