import { Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { ConversationService } from '../conversation/conversation.service';

export interface WorkspaceNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  children?: WorkspaceNode[];
}

@Injectable()
export class WorkspaceService {
  private readonly ignored = new Set(['node_modules', '.next', 'dist', 'build', '.git']);

  constructor(private readonly conversation: ConversationService) {}

  async rootFor(conversationId: string): Promise<string> {
    const conv = await this.conversation.findOne(conversationId).catch(() => null);
    if (!conv) throw new NotFoundException(`Conversation ${conversationId} not found`);
    const root = path.resolve(conv.outputDir || path.resolve(process.cwd(), '../sandbox/workspaces', conversationId));
    fs.mkdirSync(root, { recursive: true });
    return root;
  }

  resolve(root: string, relativePath = '.'): string {
    const clean = relativePath.replace(/^[/\\]+/, '') || '.';
    const absolute = path.resolve(root, clean);
    const relative = path.relative(root, absolute);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error('Path escapes workspace');
    }
    return absolute;
  }

  relative(root: string, absolute: string): string {
    return path.relative(root, absolute).split(path.sep).join('/') || '.';
  }

  tree(root: string, relativePath = '.'): WorkspaceNode[] {
    const directory = this.resolve(root, relativePath);
    if (!fs.existsSync(directory)) return [];
    const entries = fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => !this.ignored.has(entry.name))
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    return entries.map((entry) => {
      const absolute = path.join(directory, entry.name);
      const item: WorkspaceNode = {
        name: entry.name,
        path: this.relative(root, absolute),
        type: entry.isDirectory() ? 'directory' : 'file',
      };
      if (entry.isDirectory()) item.children = this.tree(root, item.path);
      else item.size = fs.statSync(absolute).size;
      return item;
    });
  }

  read(root: string, relativePath: string): { content: string; path: string; language: string } {
    const file = this.resolve(root, relativePath);
    const stat = fs.statSync(file);
    if (!stat.isFile()) throw new Error('Not a file');
    if (stat.size > 2 * 1024 * 1024) throw new Error('File is larger than 2 MB');
    return {
      content: fs.readFileSync(file, 'utf8'),
      path: this.relative(root, file),
      language: this.language(file),
    };
  }

  write(root: string, relativePath: string, content: string): { path: string } {
    const file = this.resolve(root, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, 'utf8');
    return { path: this.relative(root, file) };
  }

  mkdir(root: string, relativePath: string): { path: string } {
    const directory = this.resolve(root, relativePath);
    fs.mkdirSync(directory, { recursive: true });
    return { path: this.relative(root, directory) };
  }

  remove(root: string, relativePath: string): { path: string } {
    const target = this.resolve(root, relativePath);
    if (target === path.resolve(root)) throw new Error('Cannot remove workspace root');
    fs.rmSync(target, { recursive: true, force: true });
    return { path: this.relative(root, target) };
  }

  saveUpload(root: string, filename: string, mimeType: string, base64: string): { path: string; urlPath: string } {
    const extension = path.extname(filename).toLowerCase().replace(/[^a-z0-9.]/g, '') || this.extensionFor(mimeType);
    const safeName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extension}`;
    const relativePath = path.posix.join('assets', 'uploads', safeName);
    const file = this.resolve(root, relativePath);
    const buffer = Buffer.from(base64.replace(/^data:[^;]+;base64,/, ''), 'base64');
    if (buffer.length > 10 * 1024 * 1024) throw new Error('Image is larger than 10 MB');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, buffer);
    return { path: relativePath, urlPath: relativePath };
  }

  raw(root: string, relativePath: string): { file: string; mimeType: string } {
    const file = this.resolve(root, relativePath);
    if (!fs.statSync(file).isFile()) throw new Error('Not a file');
    return { file, mimeType: this.mimeType(file) };
  }

  private language(file: string): string {
    const ext = path.extname(file).slice(1).toLowerCase();
    return ({ ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', json: 'json', css: 'css', html: 'html', md: 'markdown', yaml: 'yaml', yml: 'yaml' } as Record<string, string>)[ext] || 'plaintext';
  }

  private mimeType(file: string): string {
    const ext = path.extname(file).toLowerCase();
    return ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' } as Record<string, string>)[ext] || 'application/octet-stream';
  }

  private extensionFor(mimeType: string): string {
    return ({ 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/svg+xml': '.svg' } as Record<string, string>)[mimeType] || '.bin';
  }
}
