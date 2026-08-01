import { Injectable } from '@nestjs/common';
import * as path from 'path';
import type { AgentChunk, SandboxConfig } from './sandbox-types';
import { PlatformService } from '../platform/platform.service';

@Injectable()
export class SandboxServiceClient {
  private readonly backendRoot = path.resolve(__dirname, '../..');
  private readonly sandboxRoot = path.resolve(this.backendRoot, '../sandbox');
  private readonly baseUrl = process.env.SANDBOX_SERVICE_URL || 'http://localhost:3002';

  constructor(private readonly platform: PlatformService) {}

  getOutputDir(conversationId?: string): string {
    return path.resolve(this.sandboxRoot, 'workspaces', conversationId || 'default');
  }

  getLegacyOutputDir(): string {
    return path.resolve(this.sandboxRoot, 'workspaces');
  }

  async *run(
    prompt: string,
    resumeSessionId?: string,
    conversationId?: string,
    outputDir?: string,
  ): AsyncGenerator<AgentChunk, void, undefined> {
    const config: SandboxConfig = {
      outputDir: outputDir || this.getOutputDir(conversationId),
      skillsRoot: path.resolve(this.sandboxRoot, '../skills'),
      mcpDir: path.resolve(this.sandboxRoot, 'mcp'),
      enabledSkills: this.platform.enabledSkills(),
      enabledMcps: this.platform.enabledMcps().map((server) => server.name),
      proxyUrl: process.env.AGENT_PROXY_URL || 'http://localhost:3001',
      previewTaskId: conversationId,
    };

    const createRes = await fetch(`${this.baseUrl}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, resumeSessionId, config }),
    });
    if (!createRes.ok) {
      const error = await createRes.json().catch(() => ({}));
      throw new Error(error?.error || `Sandbox create task failed: HTTP ${createRes.status}`);
    }

    const created = await createRes.json() as { taskId: string };
    const eventsRes = await fetch(`${this.baseUrl}/tasks/${created.taskId}/events`);
    if (!eventsRes.ok || !eventsRes.body) {
      throw new Error(`Sandbox event stream failed: HTTP ${eventsRes.status}`);
    }

    const reader = eventsRes.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let lastEvent = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed.startsWith('event: ')) {
            lastEvent = trimmed.slice(7);
            continue;
          }
          if (!trimmed.startsWith('data: ')) continue;

          const payload = trimmed.slice(6);
          let data: any;
          try {
            data = JSON.parse(payload);
          } catch {
            continue;
          }

          if (lastEvent === 'chunk') {
            yield data as AgentChunk;
          } else if (lastEvent === 'error') {
            throw new Error(data?.message || 'Sandbox task error');
          } else if (lastEvent === 'end') {
            return;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
