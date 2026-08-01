import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface SkillInfo {
  name: string;
  description: string;
  path: string;
  enabled: boolean;
}

export interface McpServerInfo {
  name: string;
  description: string;
  status: string;
  enabled: boolean;
  tools: string[];
}

interface PlatformState {
  skills: Record<string, boolean>;
  mcps: Record<string, boolean>;
}

@Injectable()
export class PlatformService {
  private readonly logger = new Logger(PlatformService.name);
  private readonly skillsRoot = path.resolve(__dirname, '../../../skills');
  private readonly dataDir = path.resolve(__dirname, '../../data');
  private readonly stateFile = path.join(this.dataDir, 'platform-state.json');

  private readonly mcpDefinitions: McpServerInfo[] = [
    {
      name: 'workspace',
      description: '沙箱工作区文件读写、搜索和路径校验',
      status: 'configured',
      enabled: true,
      tools: ['read_file', 'write_file', 'edit_file', 'list_files', 'search_files', 'validate_path'],
    },
    {
      name: 'preview',
      description: '启动、停止和检查前端 dev server 预览',
      status: 'configured',
      enabled: true,
      tools: ['start_dev_server', 'stop_dev_server', 'get_preview_url', 'check_health'],
    },
  ];

  constructor() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    if (!fs.existsSync(this.stateFile)) {
      this.writeState(this.defaultState());
    }
  }

  listSkills(): SkillInfo[] {
    if (!fs.existsSync(this.skillsRoot)) return [];
    const state = this.readState();
    return fs.readdirSync(this.skillsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const skillPath = path.join(this.skillsRoot, entry.name);
        const meta = this.readSkillMeta(skillPath);
        return {
          name: meta.name || entry.name,
          description: meta.description || '',
          path: skillPath,
          enabled: state.skills[meta.name || entry.name] ?? true,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  toggleSkill(name: string): { name: string; enabled: boolean } {
    const skill = this.listSkills().find((item) => item.name === name);
    if (!skill) throw new NotFoundException(`Skill ${name} not found`);
    const state = this.readState();
    const enabled = !(state.skills[name] ?? true);
    state.skills[name] = enabled;
    this.writeState(state);
    return { name, enabled };
  }

  listMcps(): McpServerInfo[] {
    const state = this.readState();
    return this.mcpDefinitions.map((server) => ({
      ...server,
      enabled: state.mcps[server.name] ?? true,
    }));
  }

  toggleMcp(name: string): { name: string; enabled: boolean } {
    const server = this.mcpDefinitions.find((item) => item.name === name);
    if (!server) throw new NotFoundException(`MCP server ${name} not found`);
    const state = this.readState();
    const enabled = !(state.mcps[name] ?? true);
    state.mcps[name] = enabled;
    this.writeState(state);
    return { name, enabled };
  }

  enabledSkills(): string[] {
    return this.listSkills()
      .filter((skill) => skill.enabled)
      .map((skill) => skill.name);
  }

  enabledMcps(): McpServerInfo[] {
    return this.listMcps().filter((server) => server.enabled);
  }

  private readSkillMeta(skillPath: string): { name?: string; description?: string } {
    const file = path.join(skillPath, 'SKILL.md');
    if (!fs.existsSync(file)) return {};
    const content = fs.readFileSync(file, 'utf8');
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};
    const meta: Record<string, string> = {};
    for (const line of match[1].split('\n')) {
      const sep = line.indexOf(':');
      if (sep <= 0) continue;
      const key = line.slice(0, sep).trim();
      const value = line.slice(sep + 1).trim();
      meta[key] = value;
    }
    return meta;
  }

  private defaultState(): PlatformState {
    return {
      skills: {},
      mcps: {},
    };
  }

  private readState(): PlatformState {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
      return {
        skills: parsed.skills || {},
        mcps: parsed.mcps || {},
      };
    } catch {
      return this.defaultState();
    }
  }

  private writeState(state: PlatformState): void {
    fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2));
  }
}
