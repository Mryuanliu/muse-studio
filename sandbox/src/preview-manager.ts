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
    // Bind the unspecified address so IPv4 and IPv6 listeners are both
    // detected before the child process tries to bind its actual port.
    srv.listen(port, () => {
      srv.close(() => resolve(true));
    });
  });
}

function replacePortArgs(args: string[], port: number): string[] {
  const next = [...args];
  for (let index = 0; index < next.length; index += 1) {
    if (next[index] === '--port' || next[index] === '-p') {
      if (index + 1 < next.length) next[index + 1] = String(port);
      return next;
    }
    if (next[index].startsWith('--port=')) {
      next[index] = `--port=${port}`;
      return next;
    }
  }
  return next;
}

function isAddressInUse(output: string): boolean {
  return /EADDRINUSE|address already in use/i.test(output);
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
    const preferredPort = requestedPort || record?.port;
    let resolvedCommand = command;
    let resolvedArgs = args;
    if (command === 'npm' && args[0] === 'run' && args[1] === 'dev') {
      resolvedCommand = process.platform === 'win32' ? 'npx.cmd' : 'npx';
      resolvedArgs = ['next', 'dev', ...args.slice(2)];
    }
    let nextRequestedPort = preferredPort;
    let lastOutput = '';
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const finalPort = await this.nextPort(nextRequestedPort, registry);
      nextRequestedPort = undefined;
      const finalArgs = resolvedArgs.some((arg) => arg === '--port' || arg === '-p' || arg.startsWith('--port='))
        ? replacePortArgs(resolvedArgs, finalPort)
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
        const current = this.running.get(key);
        if (current?.child !== child) return;
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
      lastOutput = output;
      if (child.exitCode === null && health.ok) {
        return {
          taskId,
          running: true,
          pid: child.pid ?? 0,
          port: finalPort,
          url,
          healthy: true,
          output: output.slice(-1000),
        };
      }

      this.running.delete(key);
      if (child.exitCode === null) child.kill('SIGTERM');
      if (!isAddressInUse(output)) {
        this.updateRecord(key, { status: 'failed', port: undefined, pid: undefined, url: undefined });
        throw new Error(`Dev server failed to become healthy:\n${output}`);
      }
      // A process can claim the port between the probe and spawn. Retry with
      // the next free port instead of exposing the transient EADDRINUSE.
    }

    this.updateRecord(key, { status: 'failed', port: undefined, pid: undefined, url: undefined });
    throw new Error(`Dev server could not acquire a free port:\n${lastOutput}`);
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
