import type { EventLog } from '../../hooks/useChatSSE';

export interface TodoItem {
  id: string;
  subject: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'deleted';
}

export function buildTodoItems(events: EventLog[] | undefined): TodoItem[] {
  const items = new Map<string, TodoItem>();
  let createCounter = 0;

  for (const ev of events || []) {
    if (
      (ev.type === 'tool_start' || ev.type === 'tool_update') &&
      ev.toolName === 'TaskCreate' &&
      ev.toolInput?.subject
    ) {
      const key = `tool:${ev.toolId || ''}`;
      createCounter += 1;
      const existing = items.get(key);
      if (!existing) {
        items.set(key, {
          id: String(createCounter),
          subject: ev.toolInput.subject,
          description: ev.toolInput.description || ev.toolInput.activeForm,
          status: 'pending',
        });
      } else {
        existing.subject = ev.toolInput.subject || existing.subject;
        existing.description = ev.toolInput.description || existing.description || ev.toolInput.activeForm;
      }
    }

    if (
      (ev.type === 'tool_start' || ev.type === 'tool_update') &&
      ev.toolName === 'TaskUpdate' &&
      ev.toolInput?.taskId
    ) {
      const id = String(ev.toolInput.taskId);
      const existing = items.get(id);
      if (!existing) {
        items.set(id, {
          id,
          subject: ev.toolInput.subject || `任务 ${id}`,
          description: ev.toolInput.description || ev.toolInput.activeForm,
          status: ev.toolInput.status || 'pending',
        });
      } else {
        if (ev.toolInput.subject) existing.subject = ev.toolInput.subject;
        if (ev.toolInput.description) existing.description = ev.toolInput.description;
        if (ev.toolInput.activeForm) existing.description = existing.description || ev.toolInput.activeForm;
        if (ev.toolInput.status) existing.status = ev.toolInput.status;
      }
    }
  }

  return [...items.values()]
    .filter((item) => item.status !== 'deleted')
    .sort((a, b) => Number(a.id) - Number(b.id));
}

export default function TodoList({ items }: { items: TodoItem[] }) {
  return (
    <div className="mb-3 rounded-lg border border-cyan-500/10 bg-cyan-500/[0.04] p-2.5">
      <div className="flex items-center gap-1.5 text-[11px] text-cyan-300/80 mb-2">
        <span>📋</span>
        <span className="font-medium">任务计划</span>
        <span className="ml-auto text-gray-500">
          {items.filter((item) => item.status === 'completed').length} / {items.length}
        </span>
      </div>
      <div className="space-y-1.5">
        {items.map((item) => (
          <div key={item.id} className="flex items-start gap-2 text-xs">
            <span className="flex-shrink-0 w-4 h-4 mt-0.5 flex items-center justify-center">
              {item.status === 'completed' ? (
                <span className="text-green-400">✅</span>
              ) : item.status === 'in_progress' ? (
                <span className="inline-block w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
              ) : (
                <span className="w-3.5 h-3.5 rounded border border-gray-600" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className={item.status === 'completed' ? 'text-gray-400 line-through' : 'text-gray-200'}>
                {item.subject}
              </div>
              {item.description && (
                <div className="text-[10px] text-gray-500 mt-0.5 line-clamp-2">{item.description}</div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
