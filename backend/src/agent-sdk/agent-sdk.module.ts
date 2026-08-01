import { Module } from '@nestjs/common';
import { AgentSdkService } from './agent-sdk.service';
import { AgentRunService } from './agent-run.service';
import { AgentSdkController } from './agent-sdk.controller';
import { ConversationModule } from '../conversation/conversation.module';

@Module({
  imports: [ConversationModule],
  controllers: [AgentSdkController],
  providers: [AgentSdkService, AgentRunService],
  exports: [AgentSdkService],
})
export class AgentSdkModule {}
