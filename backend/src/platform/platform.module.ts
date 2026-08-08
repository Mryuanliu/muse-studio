import { Module } from '@nestjs/common';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Skill } from './entities/skill.entity';
import { McpServer } from './entities/mcp-server.entity';
import { SkillGroup } from './entities/skill-group.entity';
import { McpInstallerService } from './mcp-installer.service';

@Module({
  imports: [TypeOrmModule.forFeature([Skill, McpServer, SkillGroup])],
  controllers: [PlatformController],
  providers: [PlatformService, McpInstallerService],
  exports: [PlatformService],
})
export class PlatformModule {}
