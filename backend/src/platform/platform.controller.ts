import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { PlatformService } from './platform.service';

@Controller()
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get('skills')
  listSkills() {
    return this.platform.listSkills();
  }

  @Get('skills/:name') getSkill(@Param('name') name: string) { return this.platform.getSkill(name); }
  @Post('skills') createSkill(@Body() body: any) { return this.platform.createSkill(body); }
  @Put('skills/:name') updateSkill(@Param('name') name: string, @Body() body: any) { return this.platform.updateSkill(name, body); }
  @Delete('skills/:name') deleteSkill(@Param('name') name: string) { return this.platform.deleteSkill(name); }

  @Post('skills/:name/toggle')
  toggleSkill(@Param('name') name: string) {
    return this.platform.toggleSkill(name);
  }

  @Get('mcps')
  listMcps() {
    return this.platform.listMcps();
  }

  @Post('mcps/:name/toggle')
  toggleMcp(@Param('name') name: string) {
    return this.platform.toggleMcp(name);
  }

  @Get('mcps/:name') getMcp(@Param('name') name: string) { return this.platform.getMcp(name); }
  @Post('mcps') createMcp(@Body() body: any) { return this.platform.createMcp(body); }
  @Put('mcps/:name') updateMcp(@Param('name') name: string, @Body() body: any) { return this.platform.updateMcp(name, body); }
  @Delete('mcps/:name') deleteMcp(@Param('name') name: string) { return this.platform.deleteMcp(name); }
  @Post('mcps/:name/install') installMcp(@Param('name') name: string) { return this.platform.installMcp(name); }

  @Get('skill-groups') listGroups() { return this.platform.listGroups(); }
  @Get('skill-groups/:id') getGroup(@Param('id') id: string) { return this.platform.getGroup(id); }
  @Post('skill-groups') createGroup(@Body() body: any) { return this.platform.createGroup(body); }
  @Put('skill-groups/:id') updateGroup(@Param('id') id: string, @Body() body: any) { return this.platform.updateGroup(id, body); }
  @Delete('skill-groups/:id') deleteGroup(@Param('id') id: string) { return this.platform.deleteGroup(id); }
}
