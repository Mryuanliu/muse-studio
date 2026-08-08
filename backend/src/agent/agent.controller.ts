import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { AgentService } from './agent.service';

@Controller('agents')
export class AgentController {
  constructor(private readonly agents: AgentService) {}

  @Get() list() { return this.agents.list(); }
  @Get('runtime') runtime(@Query('id') id?: string) { return this.agents.runtime(id); }
  @Get(':id') get(@Param('id') id: string) { return this.agents.findOne(id); }
  @Post() create(@Body() body: any) { return this.agents.create(body); }
  @Put(':id') update(@Param('id') id: string, @Body() body: any) { return this.agents.update(id, body); }
  @Delete(':id') remove(@Param('id') id: string) { return this.agents.delete(id); }
}
