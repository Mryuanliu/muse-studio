import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentModule } from '../agent/agent.module';
import { AgentSdkModule } from '../agent-sdk/agent-sdk.module';
import { ConversationModule } from '../conversation/conversation.module';
import { FeishuMessageReceipt } from './entities/feishu-message-receipt.entity';
import { FeishuConversationBinding } from './entities/feishu-conversation-binding.entity';
import { FeishuService } from './feishu.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([FeishuMessageReceipt, FeishuConversationBinding]),
    ConversationModule,
    AgentModule,
    AgentSdkModule,
  ],
  providers: [FeishuService],
})
export class FeishuModule {}
