import { Controller, Get, Param, Post } from '@nestjs/common';
import { PlatformService } from './platform.service';

@Controller()
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get('skills')
  listSkills() {
    return this.platform.listSkills();
  }

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
}
