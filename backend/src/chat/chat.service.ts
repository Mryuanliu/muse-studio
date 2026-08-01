import { Injectable, Logger } from '@nestjs/common';
import { Response } from 'express';
import { DeepseekService, ChatMessage } from './deepseek.service';
import { ConversationService } from '../conversation/conversation.service';
import { PAGE_SYSTEM_PROMPT } from './page-system-prompt';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly deepseek: DeepseekService,
    private readonly conversation: ConversationService,
  ) {}

  /**
   * Stream a chat response to the user via SSE.
   * Understands system messages by looking for a "system" field in the request body.
   */
  async streamResponse(
    body: { conversationId?: string; message: string; system?: string },
    res: Response,
  ): Promise<void> {
    const { conversationId, message, system } = body;

    // 1. Create or load conversation
    const conv = conversationId
      ? await this.conversation.findOne(conversationId)
      : await this.conversation.create(message);
    const convId = conv.id;

    // 2. If this is a new message in an existing conversation, save it
    if (conversationId) {
      await this.conversation.addMessage(convId, 'user', message);
    } // For new conversations, the first message is already saved in create()

    // 3. Build message history for DeepSeek
    const messages = await this.conversation.getMessages(convId);
    const dsMessages: ChatMessage[] = [];

    const effectiveSystem = system || PAGE_SYSTEM_PROMPT;
    if (effectiveSystem) {
      dsMessages.push({ role: 'system', content: effectiveSystem });
    }

    for (const msg of messages) {
      if (msg.role === 'assistant' && msg.thinkingChain) {
        // DeepSeek requires reasoning_content to be echoed back
        dsMessages.push({
          role: 'assistant',
          content: msg.content || ' ',
          reasoningContent: msg.thinkingChain,
        });
      } else {
        dsMessages.push({ role: msg.role, content: msg.content });
      }
    }

    // 4. Create a placeholder assistant message in DB
    const assistantMsg = await this.conversation.addMessage(convId, 'assistant', '');

    const sendSSE = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    let fullContent = '';
    let fullThinking = '';
    const events: any[] = [];

    try {
      // 5. Send conversation info
      sendSSE('meta', { conversationId: convId, messageId: assistantMsg.id });

      // 6. Stream from DeepSeek
      for await (const chunk of this.deepseek.streamChat(dsMessages)) {
        if (chunk.type === 'thinking') {
          fullThinking += chunk.content;
          events.push({ type: 'thinking', content: chunk.content });
          sendSSE('thinking', { content: chunk.content });
        } else {
          fullContent += chunk.content;
          events.push({ type: 'text_chunk', content: chunk.content });
          sendSSE('text', { content: chunk.content });
        }
      }

      // 7. Save the complete assistant message
      await this.conversation.updateMessage(assistantMsg.id, fullContent, fullThinking, events);

      sendSSE('done', { messageId: assistantMsg.id });
      res.end();
    } catch (error: any) {
      this.logger.error('Chat stream error:', error.message);

      // Try to save what we have
      if (fullContent || fullThinking) {
        await this.conversation.updateMessage(assistantMsg.id, fullContent, fullThinking, events);
      }

      if (!res.headersSent) {
        res.status(500).json({
          error: { type: 'api_error', message: error.message || 'DeepSeek error' },
        });
        return;
      }

      try {
        sendSSE('error', { message: error.message });
      } catch { /* closed */ }
      res.end();
    }
  }
}
