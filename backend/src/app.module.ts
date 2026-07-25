import { Module } from '@nestjs/common';
import { ProxyModule } from './proxy/proxy.module';
import { DatabaseModule } from './database/database.module';
import { ConversationModule } from './conversation/conversation.module';
import { ChatModule } from './chat/chat.module';
import { AgentSdkModule } from './agent-sdk/agent-sdk.module';
import { AdminModule } from './admin/admin.module';
import { OutputController } from './output/output.controller';

@Module({
  imports: [
    ProxyModule,
    DatabaseModule,
    ConversationModule,
    ChatModule,
    AgentSdkModule,
    AdminModule,
  ],
  controllers: [OutputController],
})
export class AppModule {}
