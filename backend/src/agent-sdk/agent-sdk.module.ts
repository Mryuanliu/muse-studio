import { Module } from '@nestjs/common';
import { AgentRunService } from './agent-run.service';
import { AgentSdkController } from './agent-sdk.controller';
import { SandboxServiceClient } from '../sandbox/sandbox-service-client';
import { ConversationModule } from '../conversation/conversation.module';
import { PlatformModule } from '../platform/platform.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { PreviewModule } from '../preview/preview.module';
import { AskUserController } from './ask-user.controller';
import { AskUserService } from './ask-user.service';

@Module({
  imports: [ConversationModule, PlatformModule, RealtimeModule, PreviewModule],
  controllers: [AgentSdkController, AskUserController],
  providers: [SandboxServiceClient, AgentRunService, AskUserService],
  exports: [AskUserService],
})
export class AgentSdkModule {}
