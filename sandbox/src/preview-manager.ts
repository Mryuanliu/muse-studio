import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';

export interface PreviewRecord {
  taskId?: string;
  projectPath: string;
  command: string;
  args: string[];
  port?: number;
  pid?: number;
  status: 'stopped' | 'running' | 'restarting' | 'failed';
  url?: string;
  updatedAt: number;
}

interface PreviewRegistry {
  lastPort: number;
  records: Record<string, PreviewRecord>;
}

interface PreviewEntry {
  pid: number;
  port: number;
  project: string;
  child: ChildProcessWithoutNullStreams;
  output: string;
}

function defaultRegistryFile(): string {
  return process.env.PREVIEW_REGISTRY_FILE || path.resolve(process.cwd(), 'preview-registry.json');
}

function readRegistry(file: string): PreviewRegistry {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {
      lastPort: Number(parsed?.lastPort || 0),
      records: parsed?.records || {},
    };
  } catch {
    return { lastPort: 0, records: {} };
  }
}

function writeRegistry(file: string, registry: PreviewRegistry): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(registry, null, 2));
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => {
      srv.close(() => resolve(true));
    });
  });
}

async function waitHealthy(url: string, timeoutMs = 15000): Promise<{ ok: boolean; status: number }> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (res.ok) return { ok: true, status: res.status };
    } catch {
      // server still starting
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return { ok: false, status: 0 };
}

export class PreviewManager {
  private readonly running = new Map<string, PreviewEntry>();
  private readonly registryFile: string;
  private readonly portStart: number;
  private readonly portEnd: number;

  constructor(registryFile = defaultRegistryFile()) {
    this.registryFile = registryFile;
    this.portStart = Number(process.env.PREVIEW_PORT_START || 4100);
    this.portEnd = Number(process.env.PREVIEW_PORT_END || 4200);
  }

  async start(
    projectPath: string,
    command = 'npm',
    args: string[] = ['run', 'dev'],
    requestedPort?: number,
    taskId?: string,
  ): Promise<any> {
    const project = path.resolve(projectPath);
    if (!fs.existsSync(path.join(project, 'package.json'))) {
      throw new Error(`No package.json found in ${projectPath}`);
    }

    const key = taskId || process.env.PREVIEW_TASK_ID || project;
    const existing = this.running.get(key);
    if (existing) {
      const health = await waitHealthy(`http://localhost:${existing.port}`, 2000);
      if (health.ok) {
        return this.toResult(existing);
      }
      this.stop(key);
    }

    const registry = readRegistry(this.registryFile);
    const record = registry.records[key];
    const finalPort = await this.nextPort(requestedPort || record?.port, registry);
    let resolvedCommand = command;
    let resolvedArgs = args;
    if (command === 'npm' && args[0] === 'run' && args[1] === 'dev') {
      resolvedCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
      resolvedArgs = ['next', 'dev', ...args.slice(2)];
    }
    const finalArgs = resolvedArgs.includes('--port')
      ? resolvedArgs
      : resolvedCommand === 'npm'
        ? [...resolvedArgs, '--', '--port', String(finalPort)]
        : [...resolvedArgs, '--port', String(finalPort)];
    const child = spawn(resolvedCommand, finalArgs, {
      cwd: project,
      env: {
        ...process.env,
        PORT: String(finalPort),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }) as unknown as ChildProcessWithoutNullStreams;

    let output = '';
    child.stdout.on('data', (buf) => {
      output = `${output}${buf.toString()}`.slice(-20000);
    });
    child.stderr.on('data', (buf) => {
      output = `${output}${buf.toString()}`.slice(-20000);
    });
    child.on('exit', () => {
      this.running.delete(key);
      this.updateRecord(key, { status: 'stopped', port: undefined, pid: undefined, url: undefined });
    });

    this.running.set(key, { pid: child.pid ?? 0, port: finalPort, project, child, output });
    this.updateRecord(key, {
      taskId,
      projectPath: project,
      command: resolvedCommand,
      args: finalArgs,
      port: finalPort,
      pid: child.pid ?? 0,
      status: 'running',
      url: `http://localhost:${finalPort}`,
    });

    const url = `http://localhost:${finalPort}`;
    const health = await waitHealthy(url);
    if (!health.ok && child.exitCode !== null) {
      this.running.delete(key);
      this.updateRecord(key, { status: 'failed', port: undefined, pid: undefined, url: undefined });
      throw new Error(`Dev server exited early:\n${output}`);
    }

    return {
      taskId,
      running: true,
      pid: child.pid ?? 0,
      port: finalPort,
      url,
      healthy: health.ok,
      output: output.slice(-1000),
    };
  }

  async restart(taskIdOrProject: string): Promise<any> {
    await this.stop(taskIdOrProject);
    const registry = readRegistry(this.registryFile);
    const key = taskIdOrProject;
    const record = registry.records[key];
    if (!record) {
      throw new Error(`Preview record not found: ${key}`);
    }
    return this.start(record.projectPath, record.command, record.args, undefined, record.taskId || key);
  }

  async stop(taskIdOrProject: string): Promise<{ stopped: boolean; pid?: number; port?: number }> {
    const key = taskIdOrProject;
    const entry = this.running.get(key);
    if (!entry) return { stopped: false };
    entry.child.kill('SIGTERM');
    this.running.delete(key);
    this.updateRecord(key, { status: 'stopped', port: undefined, pid: undefined, url: undefined });
    return { stopped: true, pid: entry.pid, port: entry.port };
  }

  async check(taskIdOrProject: string): Promise<any> {
    const key = taskIdOrProject;
    const entry = this.running.get(key);
    if (entry) {
      const result = await waitHealthy(`http://localhost:${entry.port}`, 3000);
      if (result.ok) return this.toResult(entry);
      this.stop(key);
    }

    const registry = readRegistry(this.registryFile);
    const record = registry.records[key];
    if (record) {
      this.updateRecord(key, { status: 'restarting' });
      return this.start(record.projectPath, record.command, record.args, record.port, record.taskId || key);
    }

    return { running: false };
  }

  async getUrl(taskIdOrProject: string): Promise<any> {
    return this.check(taskIdOrProject);
  }

  getStatus(taskId: string): PreviewRecord | undefined {
    return readRegistry(this.registryFile).records[taskId];
  }

  private async nextPort(requestedPort: number | undefined, registry: PreviewRegistry): Promise<number> {
    const rangeSize = this.portEnd - this.portStart + 1;
    let candidate = requestedPort || (registry.lastPort ? registry.lastPort + 1 : this.portStart);

    for (let i = 0; i < rangeSize; i++) {
      if (candidate >= this.portStart && candidate <= this.portEnd && await isPortFree(candidate)) {
        registry.lastPort = candidate;
        writeRegistry(this.registryFile, registry);
        return candidate;
      }
      candidate = candidate >= this.portEnd ? this.portStart : candidate + 1;
    }

    throw new Error(`No free preview port in range ${this.portStart}-${this.portEnd}`);
  }

  private updateRecord(key: string, patch: Partial<PreviewRecord>): void {
    const registry = readRegistry(this.registryFile);
    registry.records[key] = {
      ...(registry.records[key] || {
        projectPath: '',
        command: 'npm',
        args: ['run', 'dev'],
        status: 'stopped',
        updatedAt: Date.now(),
      }),
      ...patch,
      updatedAt: Date.now(),
    };
    writeRegistry(this.registryFile, registry);
  }

  private toResult(entry: PreviewEntry): any {
    return {
      running: true,
      pid: entry.pid,
      port: entry.port,
      url: `http://localhost:${entry.port}`,
      healthy: true,
    };
  }
}
