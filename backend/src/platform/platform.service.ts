import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { Repository } from 'typeorm';
import { Skill } from './entities/skill.entity';
import { McpServer } from './entities/mcp-server.entity';
import { SkillGroup } from './entities/skill-group.entity';
import { McpInstallerService } from './mcp-installer.service';

export interface SkillInfo { id?: string; name: string; description: string; path: string; enabled: boolean; builtin?: boolean; }
export type McpSourceType = 'builtin' | 'script' | 'npm' | 'remote';
export interface McpRuntimeServer { type?: 'stdio' | 'http'; command?: string; args?: string[]; env?: Record<string, string>; url?: string; headers?: Record<string, string>; timeout?: number; }
export interface McpServerInfo { id?: string; name: string; description: string; status: string; enabled: boolean; tools: string[]; builtin?: boolean; sourceType: McpSourceType; transport: 'stdio' | 'http'; command?: string; args?: string[]; env?: Record<string, string>; headers?: Record<string, string>; url?: string; packageName?: string; packageVersion?: string; installDir?: string; entrypoint?: string; installStatus: string; installLog?: string; timeout: number; serverScript?: string; }
export interface SkillGroupInfo { id: string; name: string; description: string; skillNames: string[]; createdAt: Date; updatedAt: Date; }

function parseJson<T>(value: string | undefined, fallback: T): T {
  try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}

@Injectable()
export class PlatformService {
  private readonly logger = new Logger(PlatformService.name);
  private readonly skillsRoot = path.resolve(__dirname, '../../../skills');
  private readonly mcpRoot = path.resolve(__dirname, '../../../sandbox/mcp');

  constructor(
    @InjectRepository(Skill) private readonly skillRepo: Repository<Skill>,
    @InjectRepository(McpServer) private readonly mcpRepo: Repository<McpServer>,
    @InjectRepository(SkillGroup) private readonly groupRepo: Repository<SkillGroup>,
    private readonly installer: McpInstallerService,
  ) {}

  private readSkillMeta(skillPath: string): { name?: string; description?: string } {
    const file = path.join(skillPath, 'SKILL.md');
    if (!fs.existsSync(file)) return {};
    const content = fs.readFileSync(file, 'utf8');
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};
    const meta: Record<string, string> = {};
    for (const line of match[1].split('\n')) {
      const sep = line.indexOf(':');
      if (sep > 0) meta[line.slice(0, sep).trim()] = line.slice(sep + 1).trim();
    }
    return meta;
  }

  private async syncDiskSkills(): Promise<void> {
    if (!fs.existsSync(this.skillsRoot)) return;
    const existing = new Map((await this.skillRepo.find()).map((item) => [item.name, item]));
    for (const entry of fs.readdirSync(this.skillsRoot, { withFileTypes: true }).filter((item) => item.isDirectory())) {
      const skillPath = path.join(this.skillsRoot, entry.name);
      const meta = this.readSkillMeta(skillPath);
      const name = meta.name || entry.name;
      if (!existing.has(name)) {
        await this.skillRepo.save(this.skillRepo.create({ name, description: meta.description || '', path: skillPath, builtin: true, enabled: true }));
      } else {
        const item = existing.get(name)!;
        if (!item.path) await this.skillRepo.update(item.id, { path: skillPath });
      }
    }
  }

  async listSkills(): Promise<SkillInfo[]> {
    await this.syncDiskSkills();
    return (await this.skillRepo.find({ order: { name: 'ASC' } })).map((item) => ({ ...item, path: item.path || path.join(this.skillsRoot, item.name) }));
  }

  async getSkill(name: string): Promise<SkillInfo & { content: string }> {
    const skill = await this.findSkill(name);
    const file = path.join(skill.path, 'SKILL.md');
    return { ...skill, content: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '' };
  }

  async createSkill(input: { name?: string; description?: string; content?: string }): Promise<SkillInfo> {
    const name = this.safeName(input.name);
    if (await this.skillRepo.findOne({ where: { name } })) throw new BadRequestException('Skill 名称已存在');
    const skillPath = path.join(this.skillsRoot, name);
    fs.mkdirSync(skillPath, { recursive: true });
    fs.writeFileSync(path.join(skillPath, 'SKILL.md'), input.content?.trim() || `---\nname: ${name}\ndescription: ${input.description || ''}\n---\n\n`);
    return (await this.skillRepo.save(this.skillRepo.create({ name, description: input.description || '', path: skillPath, enabled: true, builtin: false }))) as SkillInfo;
  }

  async updateSkill(name: string, input: { description?: string; content?: string }): Promise<SkillInfo> {
    const skill = await this.findSkill(name);
    if (input.content !== undefined) fs.writeFileSync(path.join(skill.path, 'SKILL.md'), input.content);
    if (input.description !== undefined) await this.skillRepo.update(skill.id!, { description: input.description });
    return this.findSkill(name);
  }

  async deleteSkill(name: string): Promise<{ deleted: boolean }> {
    const skill = await this.findSkill(name);
    if (skill.builtin) throw new BadRequestException('内置 Skill 不允许删除');
    this.assertInside(this.skillsRoot, skill.path);
    fs.rmSync(skill.path, { recursive: true, force: true });
    await this.skillRepo.delete(skill.id!);
    return { deleted: true };
  }

  async toggleSkill(name: string): Promise<{ name: string; enabled: boolean }> {
    const skill = await this.findSkill(name);
    const enabled = !skill.enabled;
    await this.skillRepo.update(skill.id!, { enabled });
    return { name, enabled };
  }

  async listMcps(): Promise<McpServerInfo[]> {
    await this.syncBuiltinMcps();
    return (await this.mcpRepo.find({ order: { name: 'ASC' } })).map((item) => this.serializeMcp(item));
  }

  async getMcp(name: string): Promise<McpServerInfo> { return this.findMcp(name); }

  async createMcp(input: { name?: string; description?: string; sourceType?: McpSourceType; transport?: 'stdio' | 'http'; tools?: string[]; command?: string; args?: string[]; env?: Record<string, string>; headers?: Record<string, string>; url?: string; packageName?: string; packageVersion?: string; serverScript?: string; timeout?: number }): Promise<McpServerInfo> {
    const name = this.safeName(input.name);
    if (await this.mcpRepo.findOne({ where: { name } })) throw new BadRequestException('MCP 名称已存在');
    const sourceType = input.sourceType || (input.transport === 'http' ? 'remote' : 'script');
    this.validateMcpInput(sourceType, input);
    const serverPath = sourceType === 'script' ? path.join(this.mcpRoot, `${name}-server.mjs`) : undefined;
    if (serverPath) { this.assertInside(this.mcpRoot, serverPath); fs.writeFileSync(serverPath, input.serverScript!); }
    let saved = await this.mcpRepo.save(this.mcpRepo.create({ name, description: input.description || '', sourceType, transport: sourceType === 'remote' ? 'http' : 'stdio', tools: JSON.stringify(input.tools || []), command: input.command || 'node', args: JSON.stringify(input.args || (serverPath ? [`${name}-server.mjs`] : [])), env: JSON.stringify(input.env || {}), headers: JSON.stringify(input.headers || {}), url: input.url, packageName: input.packageName, packageVersion: input.packageVersion, timeout: input.timeout || 30000, serverScript: input.serverScript, installStatus: sourceType === 'npm' ? 'installing' : 'none', enabled: true, builtin: false }));
    if (sourceType === 'npm') saved = await this.installNpmEntity(saved);
    return this.serializeMcp(saved);
  }

  async updateMcp(name: string, input: Partial<{ description: string; sourceType: McpSourceType; transport: 'stdio' | 'http'; tools: string[]; command: string; args: string[]; env: Record<string, string>; headers: Record<string, string>; url: string; packageName: string; packageVersion: string; serverScript: string; timeout: number }>): Promise<McpServerInfo> {
    let mcp = await this.findMcpEntity(name);
    const nextSource = input.sourceType || mcp.sourceType;
    this.validateMcpInput(nextSource, { ...mcp, ...input, headers: input.headers || parseJson(mcp.headers, {}), url: input.url || mcp.url, packageName: input.packageName || mcp.packageName, packageVersion: input.packageVersion || mcp.packageVersion, serverScript: input.serverScript || mcp.serverScript });
    if (input.serverScript !== undefined && nextSource === 'script') { mcp.serverScript = input.serverScript; fs.writeFileSync(path.join(this.mcpRoot, `${name}-server.mjs`), input.serverScript); }
    if (input.description !== undefined) mcp.description = input.description;
    if (input.sourceType !== undefined) { mcp.sourceType = input.sourceType; mcp.transport = input.sourceType === 'remote' ? 'http' : 'stdio'; }
    if (input.tools !== undefined) mcp.tools = JSON.stringify(input.tools);
    if (input.command !== undefined) mcp.command = input.command;
    if (input.args !== undefined) mcp.args = JSON.stringify(input.args);
    if (input.env !== undefined) mcp.env = JSON.stringify(input.env);
    if (input.headers !== undefined) mcp.headers = JSON.stringify(input.headers);
    if (input.url !== undefined) mcp.url = input.url;
    if (input.packageName !== undefined) mcp.packageName = input.packageName;
    if (input.packageVersion !== undefined) mcp.packageVersion = input.packageVersion;
    if (input.timeout !== undefined) mcp.timeout = input.timeout;
    if (nextSource === 'npm' && (input.packageName !== undefined || input.packageVersion !== undefined)) mcp = await this.installNpmEntity(mcp);
    return this.serializeMcp(await this.mcpRepo.save(mcp));
  }

  async deleteMcp(name: string): Promise<{ deleted: boolean }> {
    const mcp = await this.findMcpEntity(name);
    if (mcp.builtin) throw new BadRequestException('内置 MCP 不允许删除');
    fs.rmSync(path.join(this.mcpRoot, `${name}-server.mjs`), { force: true });
    await this.mcpRepo.delete(mcp.id);
    return { deleted: true };
  }

  async toggleMcp(name: string): Promise<{ name: string; enabled: boolean }> {
    const mcp = await this.findMcpEntity(name);
    mcp.enabled = !mcp.enabled;
    await this.mcpRepo.save(mcp);
    return { name, enabled: mcp.enabled };
  }

  async installMcp(name: string): Promise<McpServerInfo> {
    const mcp = await this.findMcpEntity(name);
    if (mcp.sourceType !== 'npm') throw new BadRequestException('只有 npm MCP 需要安装');
    return this.serializeMcp(await this.installNpmEntity(mcp));
  }

  async listGroups(): Promise<SkillGroupInfo[]> {
    await this.syncDiskSkills(); await this.syncBuiltinMcps();
    return (await this.groupRepo.find({ order: { name: 'ASC' } })).map((group) => this.serializeGroup(group));
  }

  async getGroup(id: string): Promise<SkillGroupInfo> { return this.serializeGroup(await this.findGroupEntity(id)); }

  async createGroup(input: { name?: string; description?: string; skillNames?: string[] }): Promise<SkillGroupInfo> {
    const name = input.name?.trim(); if (!name) throw new BadRequestException('分组名称不能为空');
    if (await this.groupRepo.findOne({ where: { name } })) throw new BadRequestException('Skill 分组名称已存在');
    await this.validateSkillNames(input.skillNames || []);
    return this.serializeGroup(await this.groupRepo.save(this.groupRepo.create({ name, description: input.description || '', skillNames: JSON.stringify(input.skillNames || []) })));
  }

  async updateGroup(id: string, input: Partial<{ name: string; description: string; skillNames: string[] }>): Promise<SkillGroupInfo> {
    const group = await this.findGroupEntity(id);
    if (input.skillNames) await this.validateSkillNames(input.skillNames);
    if (input.name !== undefined) group.name = input.name.trim();
    if (input.description !== undefined) group.description = input.description;
    if (input.skillNames !== undefined) group.skillNames = JSON.stringify(input.skillNames);
    return this.serializeGroup(await this.groupRepo.save(group));
  }

  async deleteGroup(id: string): Promise<{ deleted: boolean }> { await this.findGroupEntity(id); await this.groupRepo.delete(id); return { deleted: true }; }

  async getRuntimeResources(skillNames: string[], mcpNames: string[]) {
    await this.syncDiskSkills(); await this.syncBuiltinMcps();
    const skills = (await this.listSkills()).filter((item) => skillNames.includes(item.name) && item.enabled).map((item) => item.name);
    const mcps = (await this.listMcps()).filter((item) => mcpNames.includes(item.name) && item.enabled).map((item) => item.name);
    return { skills, mcps };
  }

  async enabledSkills(): Promise<string[]> { return (await this.listSkills()).filter((item) => item.enabled).map((item) => item.name); }
  async enabledMcps(): Promise<McpServerInfo[]> { return (await this.listMcps()).filter((item) => item.enabled); }

  async runtimeMcpServers(names: string[]): Promise<Record<string, McpRuntimeServer>> {
    const servers: Record<string, McpRuntimeServer> = {};
    for (const server of await this.listMcps()) {
      if (!names.includes(server.name) || !server.enabled) continue;
      if (server.sourceType === 'npm' && server.installStatus !== 'ready') continue;
      if (server.transport === 'http') {
        servers[server.name] = { type: 'http', url: server.url!, headers: server.headers || {}, timeout: server.timeout || 30000 };
      } else {
        servers[server.name] = { type: 'stdio', command: server.command || 'node', args: server.args || [`${server.name}-server.mjs`], env: server.env || {} };
      }
    }
    return servers;
  }

  private async findSkill(name: string): Promise<SkillInfo> { await this.syncDiskSkills(); const item = await this.skillRepo.findOne({ where: { name } }); if (!item) throw new NotFoundException(`Skill ${name} not found`); return { ...item, path: item.path || path.join(this.skillsRoot, item.name) }; }
  private async findMcpEntity(name: string): Promise<McpServer> { await this.syncBuiltinMcps(); const item = await this.mcpRepo.findOne({ where: { name } }); if (!item) throw new NotFoundException(`MCP server ${name} not found`); return item; }
  private async findMcp(name: string): Promise<McpServerInfo> { return this.serializeMcp(await this.findMcpEntity(name)); }
  private async findGroupEntity(id: string): Promise<SkillGroup> { const item = await this.groupRepo.findOne({ where: { id } }); if (!item) throw new NotFoundException(`Skill group ${id} not found`); return item; }
  private serializeGroup(group: SkillGroup): SkillGroupInfo { return { ...group, skillNames: parseJson(group.skillNames, []) }; }
  private serializeMcp(item: McpServer): McpServerInfo { return { ...item, tools: parseJson(item.tools, []), args: parseJson(item.args, []), env: parseJson(item.env, {}), headers: parseJson(item.headers, {}) }; }
  private validateMcpInput(sourceType: McpSourceType, input: any): void {
    if (sourceType === 'remote') {
      if (input.transport && input.transport !== 'http') throw new BadRequestException('远程 MCP 只支持 Streamable HTTP');
      if (!input.url || !this.isSafeRemoteUrl(input.url)) throw new BadRequestException('远程 MCP URL 必须是安全的 HTTPS 地址');
      const headers = input.headers || {};
      if (typeof headers !== 'object' || Array.isArray(headers)) throw new BadRequestException('Headers 格式不正确');
    }
    if (sourceType === 'npm') {
      if (!input.packageName || !input.packageVersion || !this.installer.packageSpecValid(input.packageName, input.packageVersion)) throw new BadRequestException('npm 包名或版本不合法');
    }
    if (sourceType === 'script' && !input.serverScript?.trim()) throw new BadRequestException('本地脚本 MCP 需要提供 serverScript');
  }

  private isSafeRemoteUrl(raw: string): boolean {
    try {
      const url = new URL(raw);
      if (url.protocol !== 'https:') return false;
      const host = url.hostname.toLowerCase();
      if (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return false;
      return true;
    } catch { return false; }
  }

  private async installNpmEntity(mcp: McpServer): Promise<McpServer> {
    mcp.installStatus = 'installing';
    mcp.installLog = undefined as any;
    await this.mcpRepo.save(mcp);
    try {
      const result = await this.installer.installNpm(mcp.name, mcp.packageName!, mcp.packageVersion!);
      mcp.installDir = result.installDir;
      mcp.entrypoint = result.entrypoint;
      mcp.command = 'node';
      mcp.args = JSON.stringify([result.entrypoint]);
      mcp.installLog = result.log;
      mcp.installStatus = 'ready';
      return this.mcpRepo.save(mcp);
    } catch (error: any) {
      mcp.installStatus = 'failed';
      mcp.installLog = error?.message || 'npm MCP 安装失败';
      await this.mcpRepo.save(mcp);
      throw error;
    }
  }
  private async validateSkillNames(skillNames: string[]): Promise<void> { const skills = await this.listSkills(); if (skillNames.some((name) => !skills.some((item) => item.name === name))) throw new BadRequestException('包含不存在的 Skill'); }
  private safeName(raw?: string): string { const name = raw?.trim(); if (!name || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) throw new BadRequestException('名称只能包含字母、数字、点、下划线和短横线'); return name; }
  private assertInside(root: string, target: string): void { const relative = path.relative(path.resolve(root), path.resolve(target)); if (relative.startsWith('..') || path.isAbsolute(relative)) throw new BadRequestException('非法路径'); }
  private async syncBuiltinMcps(): Promise<void> {
    const defs = [
      { name: 'workspace', description: '沙箱工作区文件读写、搜索和路径校验', tools: ['read_file','write_file','edit_file','list_files','search_files','validate_path'] },
      { name: 'preview', description: '启动、停止和检查前端开发服务预览', tools: ['start_dev_server','stop_dev_server','get_preview_url','check_health'] },
    ];
    for (const def of defs) {
      if (!(await this.mcpRepo.findOne({ where: { name: def.name } }))) {
        const script = fs.existsSync(path.join(this.mcpRoot, `${def.name}-server.mjs`)) ? fs.readFileSync(path.join(this.mcpRoot, `${def.name}-server.mjs`), 'utf8') : '';
        await this.mcpRepo.save(this.mcpRepo.create({ ...def, tools: JSON.stringify(def.tools), args: JSON.stringify([`${def.name}-server.mjs`]), env: '{}', command: 'node', serverScript: script, builtin: true, enabled: true }));
      }
    }
  }

}
