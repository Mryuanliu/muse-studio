import { Injectable } from '@nestjs/common';

interface PreviewTarget {
  url: string;
  port: number;
  projectPath?: string;
  updatedAt: number;
}

@Injectable()
export class PreviewService {
  private readonly targets = new Map<string, PreviewTarget>();

  setUrl(conversationId: string, url: string, port?: number, projectPath?: string): void {
    this.targets.set(conversationId, {
      url,
      port: port || 0,
      projectPath,
      updatedAt: Date.now(),
    });
  }

  getUrl(conversationId: string): string | undefined {
    return this.targets.get(conversationId)?.url;
  }

  getProjectPath(conversationId: string): string | undefined {
    return this.targets.get(conversationId)?.projectPath;
  }

  remove(conversationId: string): void {
    this.targets.delete(conversationId);
  }
}
