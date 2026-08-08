import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as fs from 'fs';
import * as path from 'path';
import { Repository } from 'typeorm';
import { Skill } from './entities/skill.entity';
import { McpServer } from './entities/mcp-server.entity';
import { SkillGroup } from './entities/skill-group.entity';

export interface SkillInfo { id?: string; name: string; description: string; path: string; enabled: boolean; builtin?: boolean; }
export interface McpServerInfo { id?: string; name: string; description: string; status: string; enabled: boolean; tools: string[]; builtin?: boolean; command?: string; args?: string[]; env?: Record<string, string>; serverScript?: string; }
export interface SkillGroupInfo { id: string; name: string; description: string; skillNames: string[]; mcpNames: string[]; createdAt: Date; updatedAt: Date; }

function parseJson<T>(value: string | undefined, fallback: T): T {
  try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}

@Injectable()
export class PlatformService {
  private readonly logger = new Logger(PlatformService.name);
  private readonly skillsRoot = path.resolve(__dirname, '../../../skills');
  private readonly mcpRoot = path.resolve(__dirname, '../../../sandbox/mcp');
  private readonly stateFile = path.resolve(__dirname, '../../data/platform-state.json');

  constructor(
    @InjectRepository(Skill) private readonly skillRepo: Repository<Skill>,
    @InjectRepository(McpServer) private readonly mcpRepo: Repository<McpServer>,
    @InjectRepository(SkillGroup) private readonly groupRepo: Repository<SkillGroup>,
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
    const state = this.readLegacyState();
    for (const entry of fs.readdirSync(this.skillsRoot, { withFileTypes: true }).filter((item) => item.isDirectory())) {
      const skillPath = path.join(this.skillsRoot, entry.name);
      const meta = this.readSkillMeta(skillPath);
      const name = meta.name || entry.name;
      if (!existing.has(name)) {
        await this.skillRepo.save(this.skillRepo.create({ name, description: meta.description || '', path: skillPath, builtin: true, enabled: state.skills[name] ?? true }));
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
    return (await this.mcpRepo.find({ order: { name: 'ASC' } })).map((item) => ({
      ...item, tools: parseJson(item.tools, []), args: parseJson(item.args, []), env: parseJson(item.env, {}),
    }));
  }

  async getMcp(name: string): Promise<McpServerInfo> { return this.findMcp(name); }

  async createMcp(input: { name?: string; description?: string; tools?: string[]; command?: string; args?: string[]; env?: Record<string, string>; serverScript?: string }): Promise<McpServerInfo> {
    const name = this.safeName(input.name);
    if (await this.mcpRepo.findOne({ where: { name } })) throw new BadRequestException('MCP 名称已存在');
    if (!input.serverScript?.trim()) throw new BadRequestException('自定义 MCP 需要提供 serverScript');
    const serverPath = path.join(this.mcpRoot, `${name}-server.mjs`);
    this.assertInside(this.mcpRoot, serverPath);
    fs.writeFileSync(serverPath, input.serverScript);
    const saved = await this.mcpRepo.save(this.mcpRepo.create({ name, description: input.description || '', tools: JSON.stringify(input.tools || []), command: input.command || 'node', args: JSON.stringify(input.args || [`${name}-server.mjs`]), env: JSON.stringify(input.env || {}), serverScript: input.serverScript, enabled: true, builtin: false }));
    return this.serializeMcp(saved);
  }

  async updateMcp(name: string, input: Partial<{ description: string; tools: string[]; command: string; args: string[]; env: Record<string, string>; serverScript: string }>): Promise<McpServerInfo> {
    const mcp = await this.findMcpEntity(name);
    if (input.serverScript !== undefined) { mcp.serverScript = input.serverScript; fs.writeFileSync(path.join(this.mcpRoot, `${name}-server.mjs`), input.serverScript); }
    if (input.description !== undefined) mcp.description = input.description;
    if (input.tools !== undefined) mcp.tools = JSON.stringify(input.tools);
    if (input.command !== undefined) mcp.command = input.command;
    if (input.args !== undefined) mcp.args = JSON.stringify(input.args);
    if (input.env !== undefined) mcp.env = JSON.stringify(input.env);
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

  async listGroups(): Promise<SkillGroupInfo[]> {
    await this.syncDiskSkills(); await this.syncBuiltinMcps();
    return (await this.groupRepo.find({ order: { name: 'ASC' } })).map((group) => this.serializeGroup(group));
  }

  async getGroup(id: string): Promise<SkillGroupInfo> { return this.serializeGroup(await this.findGroupEntity(id)); }

  async createGroup(input: { name?: string; description?: string; skillNames?: string[]; mcpNames?: string[] }): Promise<SkillGroupInfo> {
    const name = input.name?.trim(); if (!name) throw new BadRequestException('分组名称不能为空');
    if (await this.groupRepo.findOne({ where: { name } })) throw new BadRequestException('Skill 分组名称已存在');
    await this.validateNames(input.skillNames || [], input.mcpNames || []);
    return this.serializeGroup(await this.groupRepo.save(this.groupRepo.create({ name, description: input.description || '', skillNames: JSON.stringify(input.skillNames || []), mcpNames: JSON.stringify(input.mcpNames || []) })));
  }

  async updateGroup(id: string, input: Partial<{ name: string; description: string; skillNames: string[]; mcpNames: string[] }>): Promise<SkillGroupInfo> {
    const group = await this.findGroupEntity(id);
    if (input.skillNames || input.mcpNames) await this.validateNames(input.skillNames || parseJson(group.skillNames, []), input.mcpNames || parseJson(group.mcpNames, []));
    if (input.name !== undefined) group.name = input.name.trim();
    if (input.description !== undefined) group.description = input.description;
    if (input.skillNames !== undefined) group.skillNames = JSON.stringify(input.skillNames);
    if (input.mcpNames !== undefined) group.mcpNames = JSON.stringify(input.mcpNames);
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

  async runtimeMcpServers(names: string[]): Promise<Record<string, { command: string; args: string[]; env?: Record<string, string> }>> {
    const servers: Record<string, { command: string; args: string[]; env?: Record<string, string> }> = {};
    for (const server of await this.listMcps()) {
      if (!names.includes(server.name) || !server.enabled) continue;
      servers[server.name] = { command: server.command || 'node', args: server.args || [`${server.name}-server.mjs`], env: server.env || {} };
    }
    return servers;
  }

  private async findSkill(name: string): Promise<SkillInfo> { await this.syncDiskSkills(); const item = await this.skillRepo.findOne({ where: { name } }); if (!item) throw new NotFoundException(`Skill ${name} not found`); return { ...item, path: item.path || path.join(this.skillsRoot, item.name) }; }
  private async findMcpEntity(name: string): Promise<McpServer> { await this.syncBuiltinMcps(); const item = await this.mcpRepo.findOne({ where: { name } }); if (!item) throw new NotFoundException(`MCP server ${name} not found`); return item; }
  private async findMcp(name: string): Promise<McpServerInfo> { return this.serializeMcp(await this.findMcpEntity(name)); }
  private async findGroupEntity(id: string): Promise<SkillGroup> { const item = await this.groupRepo.findOne({ where: { id } }); if (!item) throw new NotFoundException(`Skill group ${id} not found`); return item; }
  private serializeGroup(group: SkillGroup): SkillGroupInfo { return { ...group, skillNames: parseJson(group.skillNames, []), mcpNames: parseJson(group.mcpNames, []) }; }
  private serializeMcp(item: McpServer): McpServerInfo { return { ...item, tools: parseJson(item.tools, []), args: parseJson(item.args, []), env: parseJson(item.env, {}) }; }
  private async validateNames(skillNames: string[], mcpNames: string[]): Promise<void> { const skills = await this.listSkills(); const mcps = await this.listMcps(); if (skillNames.some((name) => !skills.some((item) => item.name === name))) throw new BadRequestException('包含不存在的 Skill'); if (mcpNames.some((name) => !mcps.some((item) => item.name === name))) throw new BadRequestException('包含不存在的 MCP'); }
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
        const state = this.readLegacyState();
        await this.mcpRepo.save(this.mcpRepo.create({ ...def, tools: JSON.stringify(def.tools), args: JSON.stringify([`${def.name}-server.mjs`]), env: '{}', command: 'node', serverScript: script, builtin: true, enabled: state.mcps[def.name] ?? true }));
      }
    }
  }

  private readLegacyState(): { skills: Record<string, boolean>; mcps: Record<string, boolean> } {
    try {
      const value = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'));
      return { skills: value.skills || {}, mcps: value.mcps || {} };
    } catch {
      return { skills: {}, mcps: {} };
    }
  }
}
