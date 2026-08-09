import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Conversation } from '../conversation/entities/conversation.entity';
import { Message } from '../conversation/entities/message.entity';
import { Skill } from '../platform/entities/skill.entity';
import { McpServer } from '../platform/entities/mcp-server.entity';
import { SkillGroup } from '../platform/entities/skill-group.entity';
import { Agent } from '../agent/entities/agent.entity';
import { FeishuMessageReceipt } from '../feishu/entities/feishu-message-receipt.entity';
import { FeishuConversationBinding } from '../feishu/entities/feishu-conversation-binding.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: './data/h5-platform.db',
      entities: [Conversation, Message, Skill, McpServer, SkillGroup, Agent, FeishuMessageReceipt, FeishuConversationBinding],
      synchronize: true, // auto-create tables (dev only)
    }),
  ],
})
export class DatabaseModule {}
