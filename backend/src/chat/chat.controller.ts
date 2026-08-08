import { Controller, Get, Param, Post, Body } from '@nestjs/common';
import { ConversationService } from '../conversation/conversation.service';
import { AgentService } from '../agent/agent.service';

@Controller('chat')
export class ChatController {
  constructor(
    private readonly conversationService: ConversationService,
    private readonly agents: AgentService,
  ) {}

  /**
   * List all conversations.
   */
  @Get('conversations')
  async listConversations() {
    return this.conversationService.findAll();
  }

  /**
   * Get a single conversation with its messages.
   */
  @Get('conversations/:id')
  async getConversation(@Param('id') id: string) {
    return this.conversationService.findOne(id);
  }

  @Post('conversations/draft')
  async createDraft(@Body() body: { agentId?: string }) {
    return this.conversationService.createDraft(body?.agentId ? await this.agents.runtime(body.agentId) : undefined);
  }
}
