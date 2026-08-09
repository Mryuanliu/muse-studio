import { Module } from '@nestjs/common';
import { ProxyModule } from './proxy/proxy.module';
import { DatabaseModule } from './database/database.module';
import { ConversationModule } from './conversation/conversation.module';
import { ChatModule } from './chat/chat.module';
import { AgentSdkModule } from './agent-sdk/agent-sdk.module';
import { AdminModule } from './admin/admin.module';
import { OutputController } from './output/output.controller';
import { PlatformModule } from './platform/platform.module';
import { RealtimeModule } from './realtime/realtime.module';
import { PreviewModule } from './preview/preview.module';
import { WorkspaceModule } from './workspace/workspace.module';
import { AgentModule } from './agent/agent.module';
import { FeishuModule } from './feishu/feishu.module';

@Module({
  imports: [
    ProxyModule,
    DatabaseModule,
    ConversationModule,
    ChatModule,
    AgentSdkModule,
    AdminModule,
    PlatformModule,
    RealtimeModule,
    PreviewModule,
    WorkspaceModule,
    AgentModule,
    FeishuModule,
  ],
  controllers: [OutputController],
})
export class AppModule {}
