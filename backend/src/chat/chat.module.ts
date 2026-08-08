import { Module } from '@nestjs/common';
import { ChatController } from './chat.controller';
import { ConversationModule } from '../conversation/conversation.module';
import { AgentModule } from '../agent/agent.module';

@Module({
  imports: [ConversationModule, AgentModule],
  controllers: [ChatController],
})
export class ChatModule {}
