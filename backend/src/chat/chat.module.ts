import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { DeepseekService } from './deepseek.service';
import { ConversationModule } from '../conversation/conversation.module';
import { AgentModule } from '../agent/agent.module';

@Module({
  imports: [ConversationModule, AgentModule],
  controllers: [ChatController],
  providers: [ChatService, DeepseekService],
})
export class ChatModule {}
