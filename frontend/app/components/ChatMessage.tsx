'use client';

import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Avatar, Collapse, Image } from 'antd';
import {
  CheckCircleOutlined,
  CheckSquareOutlined,
  CodeOutlined,
  ClockCircleOutlined,
  DownOutlined,
  FileOutlined,
  FolderOpenOutlined,
  InfoCircleOutlined,
  LoadingOutlined,
  QuestionCircleOutlined,
  ReadOutlined,
  RobotOutlined,
  SearchOutlined,
  SettingOutlined,
  ThunderboltOutlined,
  ToolOutlined,
  WifiOutlined,
} from '@ant-design/icons';
import type { ChatAttachment, ChatMessage as ChatMessageType, EventLog } from '../hooks/useChatSSE';
import { Think } from '@ant-design/x';
import AskUserCard from './AskUserCard';

interface Props {
  message: ChatMessageType;
  isStreaming: boolean;
  onAskUserSubmit?: (payload: { requestId: string; answers: Record<string, string> }) => Promise<void>;
}

/* ── Small, consistent tool vocabulary ── */
function toolIcon(name: string, className = '') {
  if (name === 'Skill') return <ThunderboltOutlined className={className} />;
  if (name?.startsWith('mcp__')) return <WifiOutlined className={className} />;
  if (/bash|sh|shell|command|exec/i.test(name)) return <CodeOutlined className={className} />;
  if (/write|edit/i.test(name)) return <FileOutlined className={className} />;
  if (/read|grep|glob/i.test(name)) return <ReadOutlined className={className} />;
  if (/task/i.test(name)) return <FolderOpenOutlined className={className} />;
  if (/search|web/i.test(name)) return <SearchOutlined className={className} />;
  if (/ask|question/i.test(name)) return <QuestionCircleOutlined className={className} />;
  return <ToolOutlined className={className} />;
}

function toolName(name: string): string {
  // Add spaces before uppercase letters for CamelCase names
  return name.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2');
}

/* ── Format tool input for display ── */
function formatToolInput(toolName: string, input: any): string {
  if (!input) return '';
  switch (toolName) {
    case 'Bash':
    case 'bash':
      return input.command || input.script || '';
    case 'Write':
    case 'write':
      return input.file_path || input.path || '';
    case 'Read':
    case 'read':
      return input.file_path || input.path || '';
    case 'Edit':
    case 'edit':
      return input.file_path || input.pattern || '';
    case 'TaskCreate':
      return input.title || input.description || '';
    case 'WebSearch':
      return input.query || '';
    case 'WebFetch':
      return input.url || '';
    default:
      const simple = JSON.stringify(input);
      return simple.length > 200 ? simple.slice(0, 200) + '…' : simple;
  }
}

function stringify(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Merge consecutive streaming deltas into one displayable thinking/text block. */
function coalesceEvents(events: EventLog[]): EventLog[] {
  const out: EventLog[] = [];
  for (const ev of events) {
    if (ev.type === 'thinking' || ev.type === 'text_chunk') {
      const content = ev.content || '';
      if (!content) continue;
      const last = out[out.length - 1];
      if (last?.type === ev.type) {
        last.content += content;
      } else {
        out.push({ ...ev, content });
      }
    } else {
      out.push(ev);
    }
  }
  return out;
}

/** Build the display order from the canonical, sequence-ordered view events. */
function buildChronologicalEvents(message: ChatMessageType): EventLog[] {
  return coalesceEvents(message.events || []);
}

interface ToolGroup {
  kind: 'tool' | 'skill' | 'mcp';
  id: string;
  name: string;
  serverName?: string;
  skillName?: string;
  input?: unknown;
  output?: unknown;
  status?: string;
  failed?: boolean;
  completed: boolean;
  lastIndex: number;
}

interface RuntimeGroup {
  kind: 'runtime';
  events: EventLog[];
}

interface SubagentGroup {
  kind: 'subagent';
  id: string;
  taskId?: string;
  toolId?: string;
  subagentType?: string;
  description?: string;
  status: string;
  summary?: string;
  updates: EventLog[];
  lastIndex: number;
}

interface TaskActivity {
  kind: 'task';
  id: string;
  subject: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'deleted';
}

type DisplayEvent = EventLog | ToolGroup | RuntimeGroup | SubagentGroup | TaskActivity;

function isToolEvent(ev: EventLog) {
  return ev.type === 'tool_start' || ev.type === 'tool_update' || ev.type === 'tool_end'
    || ev.type === 'tool_progress' || ev.type === 'skill_invoke' || ev.type === 'mcp_call';
}

function isRuntimeEvent(ev: EventLog) {
  return ev.type === 'skill_load' || ev.type === 'mcp_status';
}

function isSubagentEvent(ev: EventLog) {
  return ev.type === 'subagent_start' || ev.type === 'subagent_progress' || ev.type === 'subagent_end';
}

function isTaskEvent(ev: EventLog) {
  return (ev.type === 'tool_start' || ev.type === 'tool_update')
    && (ev.toolName === 'TaskCreate' || ev.toolName === 'TaskUpdate');
}

/** Keep the chronological order while joining each tool's lifecycle. */
function groupToolEvents(events: EventLog[], isStreaming: boolean): DisplayEvent[] {
  const display: DisplayEvent[] = [];
  const groups = new Map<string, ToolGroup>();
  const subagents = new Map<string, SubagentGroup>();
  const tasks = new Map<string, TaskActivity>();
  const createIds = new Map<string, string>();
  let taskCounter = 0;
  let lastSubagentKey: string | undefined;
  let runtime: RuntimeGroup | undefined;

  const flushRuntime = () => {
    if (runtime) display.push(runtime);
    runtime = undefined;
  };

  events.forEach((ev, index) => {
    if (isRuntimeEvent(ev)) {
      if (!runtime) runtime = { kind: 'runtime', events: [] };
      runtime.events.push(ev);
      return;
    }
    flushRuntime();
    if (isSubagentEvent(ev)) {
      // SDK emits both lifecycle events and forwarded progress text. Merge
      // them by tool/task identity so one sub-agent occupies one timeline row.
      const key = ev.taskId || ev.toolId || ev.parentToolUseId || lastSubagentKey || `anonymous:${index}`;
      let group = subagents.get(key);
      if (!group) {
        group = {
          kind: 'subagent',
          id: `subagent:${key}`,
          taskId: ev.taskId,
          toolId: ev.toolId,
          subagentType: ev.subagentType,
          description: ev.description,
          status: ev.status || 'running',
          summary: ev.summary,
          updates: [],
          lastIndex: index,
        };
        subagents.set(key, group);
        display.push(group);
      }
      group.taskId = ev.taskId || group.taskId;
      group.toolId = ev.toolId || group.toolId;
      group.subagentType = ev.subagentType || group.subagentType;
      group.description = ev.description || group.description;
      group.summary = ev.summary || group.summary;
      group.status = ev.status || group.status;
      group.lastIndex = index;
      if (ev.summary || ev.description) group.updates.push(ev);
      lastSubagentKey = key;
      return;
    }
    if (isTaskEvent(ev)) {
      const input = ev.toolInput || {};
      if (ev.toolName === 'TaskCreate') {
        // The first streaming event has an empty input; render the task once
        // its parsed TaskCreate payload arrives.
        if (!input.subject) return;
        const id = ev.toolId && createIds.get(ev.toolId)
          ? createIds.get(ev.toolId)!
          : String(++taskCounter);
        if (ev.toolId) createIds.set(ev.toolId, id);
        const task: TaskActivity = {
          kind: 'task',
          id: `task:${id}`,
          subject: input.subject,
          description: input.description || input.activeForm,
          status: 'pending',
        };
        const existing = tasks.get(`task:${id}`);
        if (existing) {
          Object.assign(existing, task);
        } else {
          tasks.set(`task:${id}`, task);
          display.push(task);
        }
      } else {
        const id = String(input.taskId || '');
        if (!id) return;
        const previous = tasks.get(`task:${id}`);
        const task: TaskActivity = {
          kind: 'task',
          id: `task:${id}`,
          subject: input.subject || previous?.subject || `任务 ${id}`,
          description: input.description || input.activeForm || previous?.description,
          status: input.status || previous?.status || 'pending',
        };
        if (previous) {
          Object.assign(previous, task);
        } else {
          tasks.set(`task:${id}`, task);
          display.push(task);
        }
      }
      return;
    }
    if (!isToolEvent(ev)) {
      display.push(ev);
      return;
    }

    const kind = ev.type === 'skill_invoke' ? 'skill' : ev.type === 'mcp_call' ? 'mcp' : 'tool';
    const id = `${kind}:${ev.toolId || `${ev.toolName || 'tool'}:${index}`}`;
    let group = groups.get(id);
    if (!group) {
      group = {
        kind,
        id,
        name: ev.toolName || (kind === 'skill' ? 'Skill' : 'tool'),
        serverName: ev.serverName,
        skillName: ev.skillName,
        completed: false,
        lastIndex: index,
      };
      groups.set(id, group);
      display.push(group);
    }

    group.serverName = ev.serverName || group.serverName;
    group.skillName = ev.skillName || group.skillName;
    group.name = ev.toolName || group.name;
    group.lastIndex = index;
    if (ev.toolInput !== undefined) group.input = ev.toolInput;
    if (ev.input !== undefined && Object.keys(ev.input || {}).length > 0) group.input = ev.input;
    if (ev.toolResult !== undefined) group.output = ev.toolResult;
    if (ev.output !== undefined) group.output = ev.output;
    if (ev.status || ev.subtype) group.status = ev.status || ev.subtype;
    if (isFailedToolOutput(ev.output)) {
      group.failed = true;
      group.status = 'error';
    }
    if (ev.type === 'tool_end' || ev.status === 'result' || /^(done|completed|success)$/i.test(ev.status || '')) {
      group.completed = true;
    }
  });

  flushRuntime();
  // Some sub-agent tool results do not emit tool_end. A later model message
  // proves that the earlier call returned, so do not leave it as "running".
  for (const item of display) {
    if ('kind' in item && (item.kind === 'tool' || item.kind === 'skill' || item.kind === 'mcp') && !item.completed) {
      const laterEvents = events.slice(item.lastIndex + 1);
      const laterToolStarted = laterEvents.some((ev) =>
        isToolEvent(ev) && ev.toolId !== item.id.replace(/^(tool|skill|mcp):/, '')
          && ev.type !== 'tool_progress',
      );
      item.completed = !isStreaming || laterEvents.some((ev) =>
        ev.type === 'thinking' || ev.type === 'text_chunk' || ev.type === 'status' || ev.type === 'command_output',
      ) || laterToolStarted;
    }
  }
  return display;
}

function toolTitle(group: ToolGroup) {
  if (group.kind === 'skill') return `Skill / ${group.skillName || '执行技能'}`;
  if (group.kind === 'mcp') {
    const shortName = group.name.replace(/^mcp__[^_]+__/, '');
    return `${group.serverName || 'MCP'} / ${toolName(shortName)}`;
  }
  return toolName(group.name);
}

function isFailedToolOutput(output: unknown): boolean {
  if (!output || typeof output !== 'object') return false;
  const value = output as Record<string, unknown>;
  return value.isError === true || value.is_error === true;
}

function toolSummary(group: ToolGroup) {
  const summary = group.kind === 'tool'
    ? formatToolInput(group.name, group.input)
    : stringify(group.input).replace(/\s+/g, ' ').trim();
  const compact = summary.length > 72 ? `${summary.slice(0, 69)}...` : summary;
  return compact || (group.completed ? '已完成' : '执行中');
}

function ToolCallPanel({ group, isStreaming }: { group: ToolGroup; isStreaming: boolean }) {
  const [activeKey, setActiveKey] = useState<string[]>([]);
  const running = !group.completed;
  const status = group.failed ? '调用失败' : running ? '执行中' : '已完成';
  const statusClass = group.failed ? 'tool-status-error' : running ? 'tool-status-running' : 'tool-status-done';
  const inputText = stringify(group.input);
  const outputText = stringify(group.output);

  return (
    <Collapse
      className={`tool-call-collapse ${running ? 'is-running' : ''}`}
      activeKey={activeKey}
      onChange={(key) => setActiveKey(Array.isArray(key) ? key : [key])}
      expandIcon={({ isActive }) => (
        <DownOutlined className={`tool-chevron ${isActive ? 'is-open' : ''}`} />
      )}
      items={[{
        key: 'details',
        label: (
          <div className="tool-call-heading">
            <span className={`tool-call-icon ${group.kind}`}>
              {toolIcon(group.name, 'text-[13px]')}
            </span>
            <span className="tool-call-title">{toolTitle(group)}</span>
            <span className="tool-call-summary" title={toolSummary(group)}>{toolSummary(group)}</span>
            <span className={`tool-call-status ${statusClass}`}>
              {group.failed ? <QuestionCircleOutlined /> : running ? <LoadingOutlined spin /> : <CheckCircleOutlined />}
              {status}
            </span>
          </div>
        ),
        children: (
          <div className="tool-call-details">
            {inputText && (
              <div className="tool-call-section">
                <div className="tool-call-section-label"><SettingOutlined /> 参数</div>
                <pre>{inputText}</pre>
              </div>
            )}
            {outputText && (
              <div className="tool-call-section">
                <div className="tool-call-section-label"><CheckCircleOutlined /> 工具结果</div>
                <pre>{outputText}</pre>
              </div>
            )}
            {!inputText && !outputText && (
              <div className="tool-call-empty">{isStreaming && running ? '正在等待工具返回…' : '暂无详细信息'}</div>
            )}
          </div>
        ),
      }]}
    />
  );
}

function RuntimePanel({ group }: { group: RuntimeGroup }) {
  const [activeKey, setActiveKey] = useState<string[]>([]);
  const skillCount = group.events.filter((ev) => ev.type === 'skill_load').length;
  const mcpCount = group.events.filter((ev) => ev.type === 'mcp_status').length;
  const hasError = group.events.some((ev) => ev.status && ev.status !== 'ready');
  return (
    <Collapse
      className="runtime-collapse"
      activeKey={activeKey}
      onChange={(key) => setActiveKey(Array.isArray(key) ? key : [key])}
      expandIcon={({ isActive }) => <DownOutlined className={`tool-chevron ${isActive ? 'is-open' : ''}`} />}
      items={[{
        key: 'runtime',
        label: (
          <div className="tool-call-heading">
            <span className="tool-call-icon runtime"><ThunderboltOutlined /></span>
            <span className="tool-call-title">运行环境</span>
            <span className="tool-call-summary">{skillCount ? `${skillCount} 个 Skill` : ''}{mcpCount ? ` · ${mcpCount} 个 MCP` : ''}</span>
            <span className={`tool-call-status ${hasError ? 'tool-status-error' : 'tool-status-done'}`}>
              {hasError ? <ToolOutlined /> : <CheckCircleOutlined />} {hasError ? '有异常' : '已就绪'}
            </span>
          </div>
        ),
        children: (
          <div className="runtime-list">
            {group.events.map((ev, index) => (
              <div className="runtime-item" key={`${ev.type}-${index}`}>
                <span className={`runtime-dot ${ev.status === 'ready' ? 'ready' : 'error'}`} />
                <span>{ev.type === 'skill_load' ? `Skill ${ev.skillName || ''}` : `MCP ${ev.serverName || ''}`}</span>
                <span className="runtime-item-status">{ev.status || 'unknown'}</span>
              </div>
            ))}
          </div>
        ),
      }]}
    />
  );
}

function ThinkingPanel({ content }: { content?: string }) {
  return (
    <Think
      title="思考"
      defaultExpanded
      classNames={{ status: 'thinking-status', content: 'thinking-content' }}
      styles={{ content: { fontSize: 12, lineHeight: 1.65 } }}
    >
      {content}
    </Think>
  );
}

function TaskActivityRow({ task }: { task: TaskActivity }) {
  const isCompleted = task.status === 'completed';
  const isRunning = task.status === 'in_progress';
  return (
    <div className={`task-activity-row task-${task.status}`}>
      <span className="task-activity-icon">
        {isCompleted ? <CheckSquareOutlined /> : isRunning ? <LoadingOutlined spin /> : <ClockCircleOutlined />}
      </span>
      <div className="task-activity-copy">
        <div className={isCompleted ? 'task-activity-subject is-completed' : 'task-activity-subject'}>
          {task.subject}
        </div>
        {task.description && <div className="task-activity-description">{task.description}</div>}
      </div>
      <span className="task-activity-status">
        {isCompleted ? '已完成' : isRunning ? '进行中' : '待处理'}
      </span>
    </div>
  );
}

/* ── Single event item ── */
function EventItem({
  ev,
  isStreaming,
  onAskUserSubmit,
}: {
  ev: DisplayEvent;
  isStreaming: boolean;
  onAskUserSubmit?: Props['onAskUserSubmit'];
}) {
  const [expanded, setExpanded] = useState(false);

  if ('kind' in ev) {
    if (ev.kind === 'task') return <TaskActivityRow task={ev} />;
    if (ev.kind === 'subagent') return <SubagentPanel group={ev} />;
    return ev.kind === 'runtime'
      ? <RuntimePanel group={ev} />
      : <ToolCallPanel group={ev} isStreaming={isStreaming} />;
  }

  switch (ev.type) {
    case 'ask_user':
      return onAskUserSubmit ? (
        <AskUserCard
          card={{
            requestId: ev.requestId || '',
            conversationId: ev.conversationId,
            toolUseID: ev.toolUseID,
            questions: ev.questions || [],
            status: ev.status === 'submitted' ? 'submitted' : 'pending',
            submittedAnswers: ev.answers,
          }}
          onSubmit={onAskUserSubmit}
        />
      ) : null;

    case 'thinking':
      return <ThinkingPanel content={ev.content} />;

    case 'tool_progress':
      return (
        <div className="activity-note">
          {toolIcon(ev.toolName || '')}
          <span>{toolName(ev.toolName || '')} · {ev.subtype === 'running' ? '执行中' : ev.subtype}</span>
        </div>
      );

    case 'subagent_start':
    case 'subagent_progress':
    case 'subagent_end': {
      const isDone = ev.type === 'subagent_end';
      const isFailed = isDone && ['failed', 'stopped', 'killed'].includes(ev.status || '');
      const label = isFailed ? '子代理失败' : isDone ? '子代理已完成' : '子代理执行中';
      const detail = ev.summary || ev.description || ev.subagentType || '正在处理任务';
      return (
        <div className={`activity-note ${isFailed ? 'activity-error' : isDone ? 'activity-success' : 'activity-progress'}`}>
          {isDone ? (isFailed ? <QuestionCircleOutlined /> : <CheckCircleOutlined />) : <LoadingOutlined spin />}
          <span>{label} · {detail}</span>
        </div>
      );
    }

    case 'skill_load':
    case 'mcp_status':
      return null;

    case 'skill_invoke':
    case 'mcp_call':
    case 'tool_start':
    case 'tool_update':
    case 'tool_end':
      return null;

    case 'status':
      return (
        <div className={`activity-note ${ev.subtype === 'thinking_unavailable' ? 'activity-muted' : ev.subtype === 'error' ? 'activity-error' : 'activity-success'}`}>
          {ev.subtype === 'thinking_unavailable' ? <InfoCircleOutlined /> : ev.subtype === 'error' ? <QuestionCircleOutlined /> : <CheckCircleOutlined />}
          <span>{ev.content}</span>
        </div>
      );

    case 'command_output': {
      const isLongOutput = (ev.content?.length || 0) > 200;
      const display = expanded ? ev.content : ev.content?.slice(0, 200);
      return (
        <Collapse
          className="output-collapse"
          items={[{
            key: 'output',
            label: <span className="output-label"><CodeOutlined /> 命令输出 {isLongOutput ? `· ${ev.content?.length} 字符` : ''}</span>,
            children: <pre className="tool-output-pre">{display}{isLongOutput && !expanded && '…'}</pre>,
          }]}
          onChange={() => setExpanded((value) => !value)}
        />
      );
    }

    case 'text_chunk':
      return (
        <div className="markdown-content text-sm leading-relaxed">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{ev.content || ''}</ReactMarkdown>
          {isStreaming && (
            <span className="inline-block w-2 h-4 bg-cyan-300/60 animate-pulse" />
          )}
        </div>
      );

    default:
      return null;
  }
}

function SubagentPanel({ group }: { group: SubagentGroup }) {
  const [activeKey, setActiveKey] = useState<string[]>([]);
  const failed = ['failed', 'stopped', 'killed', 'error'].includes(group.status);
  const completed = ['completed', 'success', 'done'].includes(group.status);
  const status = failed ? '失败' : completed ? '已完成' : '进行中';
  const statusClass = failed ? 'tool-status-error' : completed ? 'tool-status-done' : 'tool-status-running';
  const title = group.subagentType || '子代理';
  const summary = (group.summary || group.description || '正在处理任务').replace(/\s+/g, ' ').trim();
  const compactSummary = summary.length > 96 ? `${summary.slice(0, 93)}...` : summary;

  return (
    <Collapse
      className={`subagent-collapse ${failed ? 'is-failed' : ''}`}
      activeKey={activeKey}
      onChange={(key) => setActiveKey(Array.isArray(key) ? key : [key])}
      expandIcon={({ isActive }) => (
        <DownOutlined className={`tool-chevron ${isActive ? 'is-open' : ''}`} />
      )}
      items={[{
        key: 'details',
        label: (
          <div className="subagent-heading">
            <span className="subagent-icon"><FolderOpenOutlined /></span>
            <span className="subagent-title">{title}</span>
            <span className="subagent-summary" title={summary}>{compactSummary}</span>
            <span className={`tool-call-status ${statusClass}`}>
              {failed ? <QuestionCircleOutlined /> : completed ? <CheckCircleOutlined /> : <LoadingOutlined spin />}
              {status}
            </span>
          </div>
        ),
        children: (
          <div className="subagent-details">
            <div className="subagent-meta">
              <span>{group.description || '子代理执行过程'}</span>
              <span>{group.updates.length} 条进度</span>
            </div>
            {group.updates.length > 0 && (
              <div className="subagent-updates">
                {group.updates.slice(-8).map((update, index) => (
                  <div className="subagent-update" key={`${update.type}-${index}`}>
                    <span className="subagent-update-dot" />
                    <span>{update.summary || update.description || '已更新执行状态'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ),
      }]}
    />
  );
}

export default function ChatMessage({ message, isStreaming, onAskUserSubmit }: Props) {
  const isUser = message.role === 'user';
  const activity = isUser ? [] : buildChronologicalEvents(message);
  const displayActivity = isUser ? [] : groupToolEvents(activity, isStreaming);
  const hasActivity = activity.length > 0;
  const hasInlineText = activity.some((ev) => ev.type === 'text_chunk');

  if (!isUser) {
    return (
      <div className="chat-ai-message">
        <div className="chat-ai-identity">
          <Avatar size={28} icon={<RobotOutlined />} className="chat-avatar chat-avatar-ai" />
          <div className="chat-agent-meta">
            <span className="chat-agent-name">Muse Agent</span>
            <span className="chat-model-name">GPT5.6-luna</span>
          </div>
        </div>
        <div className="chat-ai-reply">
          {hasActivity && (
            <div className="chat-activity mb-3">
              {displayActivity.map((ev, i) => (
                <EventItem
                  key={'kind' in ev
                    ? `${ev.kind}-${'id' in ev ? ev.id : i}`
                    : `${ev.type}-${i}-${ev.toolId || ''}`}
                  ev={ev}
                  isStreaming={isStreaming && i === displayActivity.length - 1}
                  onAskUserSubmit={onAskUserSubmit}
                />
              ))}
            </div>
          )}
          <div className="markdown-content text-sm leading-relaxed">
            {!hasInlineText ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {message.content || (isStreaming && !hasActivity ? '处理中…' : '')}
              </ReactMarkdown>
            ) : null}
          </div>
          {isStreaming && !message.content && !hasInlineText && (
            <div className="flex items-center gap-1.5 mt-2 text-xs text-gray-500">
              <span className="animate-pulse">●</span>
              处理中…
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full justify-end">
      <div className="max-w-[92%] rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-3 text-blue-800">
        {!!message.attachments?.length && (
          <div className="chat-attachment-list chat-attachment-list-user">
            {message.attachments.map((attachment: ChatAttachment) => (
              <Image
                key={`${attachment.path}-${attachment.name}`}
                src={attachment.url}
                alt={attachment.name}
                width={180}
                height={120}
                className="chat-attachment-thumb"
                preview
              />
            ))}
          </div>
        )}
        <div className="markdown-content text-sm leading-relaxed">
          {message.content ? <p>{message.content}</p> : null}
        </div>
      </div>
    </div>
  );
}
