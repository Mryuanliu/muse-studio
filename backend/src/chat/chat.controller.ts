import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Res,
  HttpCode,
  Header,
} from '@nestjs/common';
import { Response } from 'express';
import { ChatService } from './chat.service';
import { ConversationService } from '../conversation/conversation.service';

@Controller('chat')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly conversationService: ConversationService,
  ) {}

  /**
   * SSE streaming endpoint: POST /chat/send
   *
   * Accepts a message (and optional conversationId), streams the
   * DeepSeek response back as SSE events:
   *
   *   event: meta      — { conversationId, messageId }
   *   event: thinking  — { content: "chain of thought..." }
   *   event: text      — { content: "response text..." }
   *   event: done      — { messageId }
   *   event: error     — { message: "..." }
   */
  @Post('send')
  @HttpCode(200)
  @Header('Content-Type', 'text/event-stream')
  @Header('Cache-Control', 'no-cache')
  @Header('Connection', 'keep-alive')
  @Header('X-Accel-Buffering', 'no')
  async send(
    @Body() body: { conversationId?: string; message: string; system?: string },
    @Res() res: Response,
  ) {
    if (!body.message || !body.message.trim()) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    await this.chatService.streamResponse(body, res);
  }

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
  async createDraft() {
    return this.conversationService.createDraft();
  }
}
