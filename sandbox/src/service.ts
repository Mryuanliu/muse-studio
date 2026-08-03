import * as http from 'http';
import { randomUUID } from 'crypto';
import * as path from 'path';
import { AgentSdkService } from './agent-sdk.service';
import { PreviewManager } from './preview-manager';
import { AgentChunk, SandboxConfig } from './types';

interface SandboxTask {
  id: string;
  status: 'running' | 'completed' | 'error';
  buffer: AgentChunk[];
  subscribers: Set<http.ServerResponse>;
  done: boolean;
  error?: string;
}

interface StartTaskPayload {
  prompt?: string;
  resumeSessionId?: string;
  config?: SandboxConfig;
  dryRun?: boolean;
}

const port = Number(process.env.SANDBOX_PORT || 3002);
const tasks = new Map<string, SandboxTask>();
const previewManager = new PreviewManager();

function sendJson(res: http.ServerResponse, statusCode: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function sendSse(res: http.ServerResponse, event: string, data: unknown): void {
  if (res.writableEnded || res.destroyed) return;
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function emit(task: SandboxTask, event: string, data: unknown): void {
  for (const subscriber of [...task.subscribers]) {
    try {
      sendSse(subscriber, event, data);
    } catch {
      task.subscribers.delete(subscriber);
    }
  }
}

function readJson(req: http.IncomingMessage): Promise<StartTaskPayload> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
      if (body.length > 50 * 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error: any) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

async function runTask(task: SandboxTask, payload: StartTaskPayload): Promise<void> {
  const config = payload.config || {
    outputDir: path.resolve(process.cwd(), 'workspaces'),
    skillsRoot: path.resolve(process.cwd(), '../skills'),
    mcpDir: path.resolve(process.cwd(), 'mcp'),
    enabledSkills: [],
    enabledMcps: [],
    proxyUrl: 'http://localhost:3001',
  };

  try {
    if (payload.dryRun) {
      const fakeChunks: AgentChunk[] = [
        { type: 'session', sessionId: 'dry-run' },
        { type: 'status', content: 'sandbox dry run', subtype: 'test' },
        { type: 'text', content: 'dry run complete' },
        { type: 'done', usage: { input_tokens: 0, output_tokens: 0 } },
      ];
      for (const chunk of fakeChunks) {
        task.buffer.push(chunk);
        emit(task, 'chunk', chunk);
      }
      task.status = 'completed';
      return;
    }

    const service = new AgentSdkService(config);
    for await (const chunk of service.run(payload.prompt || '', payload.resumeSessionId)) {
      task.buffer.push(chunk);
      emit(task, 'chunk', chunk);
    }
    task.status = 'completed';
  } catch (error: any) {
    task.status = 'error';
    task.error = error?.message || 'Sandbox task error';
    emit(task, 'error', { message: task.error });
  } finally {
    task.done = true;
    emit(task, 'end', {});
    for (const subscriber of [...task.subscribers]) {
      try {
        sendSse(subscriber, 'end', {});
        subscriber.end();
      } catch {
        task.subscribers.delete(subscriber);
      }
    }
  }
}

function handleEvents(req: http.IncomingMessage, res: http.ServerResponse, taskId: string): void {
  const task = tasks.get(taskId);
  if (!task) {
    sendJson(res, 404, { error: 'Task not found' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  for (const chunk of task.buffer) {
    sendSse(res, 'chunk', chunk);
  }
  if (task.done) {
    sendSse(res, 'end', {});
    res.end();
    return;
  }

  task.subscribers.add(res);
  req.on('close', () => {
    task.subscribers.delete(res);
  });
}

function proxyPreview(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  taskId: string,
  targetUrl: string,
): void {
  const target = new URL(targetUrl);
  const prefix = `/preview/${encodeURIComponent(taskId)}`;
  const pathname = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`).pathname;
  const rawPath = pathname.startsWith(prefix) ? pathname.slice(prefix.length) : pathname;
  const proxyPath = `${rawPath || '/'}${new URL(req.url || '/', `http://localhost`).search}`;
  const headers = { ...req.headers };
  headers.host = target.host;
  headers['accept-encoding'] = 'identity';

  const proxyReq = http.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      path: proxyPath,
      method: req.method,
      headers,
    },
    (proxyRes) => {
      const contentType = String(proxyRes.headers['content-type'] || '');
      const shouldRewrite = /text\/html|text\/css|application\/javascript|text\/javascript/.test(contentType);
      const headers: Record<string, any> = {
        ...proxyRes.headers,
        'Access-Control-Allow-Origin': '*',
      };
      if (shouldRewrite) {
        delete headers['content-length'];
        delete headers['content-encoding'];
      }
      res.writeHead(proxyRes.statusCode || 502, headers);

      if (shouldRewrite) {
        let body = '';
        proxyRes.on('data', (chunk) => {
          body += chunk.toString();
        });
        proxyRes.on('end', () => {
          const isHtml = /text\/html/.test(contentType);
          const rewritten = isHtml
            ? body.replace(
                /(href|src)=(["'])\/_next\//g,
                `$1=$2/preview/${encodeURIComponent(taskId)}/_next/`,
              )
            : body.replace(
                /(["'(=])\/_next\//g,
                `$1/preview/${encodeURIComponent(taskId)}/_next/`,
              );
          res.end(rewritten);
        });
      } else {
        proxyRes.pipe(res);
      }
    },
  );

  proxyReq.on('error', () => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Preview unavailable' }));
    } else {
      res.end();
    }
  });
  req.pipe(proxyReq);
}

async function handlePreviewProxy(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  taskId: string,
): Promise<void> {
  let record = previewManager.getStatus(taskId);
  if (!record) {
    const projectPath = path.resolve(process.cwd(), 'workspaces', taskId);
    try {
      await previewManager.start(projectPath, 'npm', ['run', 'dev'], undefined, taskId);
      record = previewManager.getStatus(taskId);
    } catch {
      // project may not exist yet
    }
  }
  if (!record) {
    sendJson(res, 404, { error: 'Preview record not found' });
    return;
  }

  try {
    const result = await previewManager.check(taskId);
    if (!result?.running || !result?.url) {
      sendJson(res, 502, { error: 'Preview unavailable' });
      return;
    }
    proxyPreview(req, res, taskId, result.url);
  } catch (error: any) {
    sendJson(res, 502, { error: error?.message || 'Preview unavailable' });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, { ok: true, service: 'sandbox' });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/tasks') {
    try {
      const payload = await readJson(req);
      const task: SandboxTask = {
        id: randomUUID(),
        status: 'running',
        buffer: [],
        subscribers: new Set(),
        done: false,
      };
      tasks.set(task.id, task);
      sendJson(res, 200, { taskId: task.id });
      void runTask(task, payload);
      return;
    } catch (error: any) {
      sendJson(res, 400, { error: error?.message || 'Invalid request' });
      return;
    }
  }

  if (req.method === 'POST' && url.pathname === '/preview/restart') {
    try {
      const payload = (await readJson(req)) as any;
      const projectPath = payload?.projectPath || path.resolve(process.cwd(), 'workspaces');
      const result = await previewManager.start(projectPath);
      sendJson(res, 200, result);
      return;
    } catch (error: any) {
      sendJson(res, 500, { error: error?.message || 'Preview restart failed' });
      return;
    }
  }

  if (req.method === 'POST' && url.pathname === '/preview/start') {
    try {
      const payload = (await readJson(req)) as any;
      const taskId = payload?.taskId;
      const projectPath = payload?.projectPath || (
        taskId
          ? path.resolve(process.cwd(), 'workspaces', taskId)
          : path.resolve(process.cwd(), 'workspaces')
      );
      const result = await previewManager.start(
        projectPath,
        payload?.command || 'npm',
        payload?.args || ['run', 'dev'],
        payload?.port,
        taskId,
      );
      sendJson(res, 200, result);
      return;
    } catch (error: any) {
      sendJson(res, 500, { error: error?.message || 'Preview start failed' });
      return;
    }
  }

  const previewRestartMatch = url.pathname.match(/^\/preview\/([^/]+)\/restart$/);
  if (req.method === 'POST' && previewRestartMatch) {
    try {
      const result = await previewManager.restart(decodeURIComponent(previewRestartMatch[1]));
      sendJson(res, 200, result);
      return;
    } catch (error: any) {
      sendJson(res, 500, { error: error?.message || 'Preview restart failed' });
      return;
    }
  }

  const previewStatusMatch = url.pathname.match(/^\/preview\/([^/]+)\/status$/);
  if (req.method === 'GET' && previewStatusMatch) {
    const record = previewManager.getStatus(decodeURIComponent(previewStatusMatch[1]));
    if (!record) {
      sendJson(res, 404, { error: 'Preview record not found' });
      return;
    }
    sendJson(res, 200, record);
    return;
  }

  const previewProxyMatch = url.pathname.match(/^\/preview\/([^/]+)(?:\/.*)?$/);
  if (req.method === 'GET' && previewProxyMatch) {
    await handlePreviewProxy(req, res, decodeURIComponent(previewProxyMatch[1]));
    return;
  }

  const eventsMatch = url.pathname.match(/^\/tasks\/([^/]+)\/events$/);
  if (req.method === 'GET' && eventsMatch) {
    handleEvents(req, res, decodeURIComponent(eventsMatch[1]));
    return;
  }

  const statusMatch = url.pathname.match(/^\/tasks\/([^/]+)\/status$/);
  if (req.method === 'GET' && statusMatch) {
    const task = tasks.get(decodeURIComponent(statusMatch[1]));
    if (!task) {
      sendJson(res, 404, { error: 'Task not found' });
      return;
    }
    sendJson(res, 200, {
      taskId: task.id,
      status: task.status,
      error: task.error,
      done: task.done,
    });
    return;
  }

  sendJson(res, 404, { error: 'Not found' });
});

server.listen(port, '0.0.0.0', () => {
  process.stderr.write(`[sandbox] service listening on http://localhost:${port}\n`);
});
