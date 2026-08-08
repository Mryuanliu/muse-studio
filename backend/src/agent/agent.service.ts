import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Agent, AgentType } from './entities/agent.entity';
import { PlatformService } from '../platform/platform.service';
import type { AgentRuntimeConfig } from '../sandbox/sandbox-service-client';

function parseList(value: string | undefined): string[] {
  try { const parsed = value ? JSON.parse(value) : []; return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

export interface AgentView {
  id: string;
  name: string;
  description: string;
  prompt: string;
  type: AgentType;
  skillGroupId?: string;
  skillGroup?: any;
  mcpNames: string[];
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class AgentService {
  constructor(
    @InjectRepository(Agent) private readonly repo: Repository<Agent>,
    private readonly platform: PlatformService,
  ) {}

  async list(): Promise<AgentView[]> {
    const rows = await this.repo.find({ order: { updatedAt: 'DESC' } });
    return Promise.all(rows.map((row) => this.toView(row)));
  }

  async findOne(id: string): Promise<AgentView> { return this.toView(await this.findEntity(id)); }

  async create(input: { name?: string; description?: string; prompt?: string; type?: AgentType; skillGroupId?: string; mcpNames?: string[] }): Promise<AgentView> {
    const name = input.name?.trim();
    if (!name) throw new BadRequestException('智能体名称不能为空');
    if (await this.repo.findOne({ where: { name } })) throw new BadRequestException('智能体名称已存在');
    const type = input.type === 'other' ? 'other' : 'codegen';
    await this.validateBindings(input.skillGroupId, input.mcpNames || []);
    const saved = await this.repo.save(this.repo.create({ name, description: input.description || '', prompt: input.prompt || '', type, skillGroupId: input.skillGroupId || null as any, mcpNames: JSON.stringify(input.mcpNames || []) }));
    return this.toView(saved);
  }

  async update(id: string, input: Partial<{ name: string; description: string; prompt: string; type: AgentType; skillGroupId: string | null; mcpNames: string[] }>): Promise<AgentView> {
    const agent = await this.findEntity(id);
    if (input.name !== undefined && input.name.trim() !== agent.name && await this.repo.findOne({ where: { name: input.name.trim() } })) throw new BadRequestException('智能体名称已存在');
    await this.validateBindings(input.skillGroupId === undefined ? agent.skillGroupId : input.skillGroupId || undefined, input.mcpNames || parseList(agent.mcpNames));
    if (input.name !== undefined) agent.name = input.name.trim();
    if (input.description !== undefined) agent.description = input.description;
    if (input.prompt !== undefined) agent.prompt = input.prompt;
    if (input.type !== undefined) agent.type = input.type === 'other' ? 'other' : 'codegen';
    if (input.skillGroupId !== undefined) agent.skillGroupId = input.skillGroupId || null as any;
    if (input.mcpNames !== undefined) agent.mcpNames = JSON.stringify(input.mcpNames);
    return this.toView(await this.repo.save(agent));
  }

  async delete(id: string): Promise<{ deleted: boolean }> { await this.findEntity(id); await this.repo.delete(id); return { deleted: true }; }

  async runtime(id?: string): Promise<AgentRuntimeConfig> {
    if (!id) {
      const [skills, mcps] = await Promise.all([this.platform.listSkills(), this.platform.listMcps()]);
      const enabledMcps = mcps.filter((item) => item.enabled).map((item) => item.name);
      return { agentId: undefined, agentType: 'codegen' as AgentType, systemPrompt: '', enabledSkills: skills.filter((item) => item.enabled).map((item) => item.name), enabledMcps, mcpServers: await this.platform.runtimeMcpServers(enabledMcps), agentName: '默认智能体' };
    }
    const agent = await this.findEntity(id);
    const group = agent.skillGroupId ? await this.platform.getGroup(agent.skillGroupId).catch(() => undefined) : undefined;
    const skillNames = group?.skillNames || [];
    const mcpNames = [...new Set([...(group?.mcpNames || []), ...parseList(agent.mcpNames)])];
    const resources = await this.platform.getRuntimeResources(skillNames, mcpNames);
    return { agentId: agent.id, agentName: agent.name, agentType: agent.type, systemPrompt: agent.prompt, enabledSkills: resources.skills, enabledMcps: resources.mcps, mcpServers: await this.platform.runtimeMcpServers(resources.mcps) };
  }

  private async toView(agent: Agent): Promise<AgentView> {
    const skillGroup = agent.skillGroupId ? await this.platform.getGroup(agent.skillGroupId).catch(() => undefined) : undefined;
    return { ...agent, skillGroupId: agent.skillGroupId || undefined, skillGroup, mcpNames: parseList(agent.mcpNames) };
  }

  private async findEntity(id: string): Promise<Agent> { const agent = await this.repo.findOne({ where: { id } }); if (!agent) throw new NotFoundException(`Agent ${id} not found`); return agent; }
  private async validateBindings(groupId: string | undefined, mcpNames: string[]): Promise<void> {
    if (groupId) await this.platform.getGroup(groupId);
    const mcps = await this.platform.listMcps();
    if (mcpNames.some((name) => !mcps.some((item) => item.name === name))) throw new BadRequestException('包含不存在的 MCP');
  }
}
