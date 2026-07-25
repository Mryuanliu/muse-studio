import {
  Controller,
  Post,
  Body,
  Res,
  HttpCode,
  Header,
} from '@nestjs/common';
import { Response } from 'express';
import { AgentSdkService } from './agent-sdk.service';
import { ConversationService } from '../conversation/conversation.service';

@Controller('agent')
export class AgentSdkController {
  constructor(
    private readonly agentSdk: AgentSdkService,
    private readonly conversation: ConversationService,
  ) {}

  @Post('run')
  @HttpCode(200)
  @Header('Content-Type', 'text/event-stream')
  @Header('Cache-Control', 'no-cache')
  @Header('Connection', 'keep-alive')
  @Header('X-Accel-Buffering', 'no')
  async run(
    @Body() body: {
      prompt: string;
      conversationId?: string;      // our DB conv ID
      resumeSessionId?: string;     // SDK session ID for resume
    },
    @Res() res: Response,
  ) {
    if (!body.prompt || !body.prompt.trim()) {
      res.status(400).json({ error: 'prompt is required' });
      return;
    }

    const sendSSE = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      // ── 1. Load or create conversation ──
      let convId = body.conversationId;
      let resumeSid = body.resumeSessionId;

      if (convId) {
        // Existing conversation: add user message to DB
        await this.conversation.addMessage(convId, 'user', body.prompt);
      } else {
        // New conversation: create in DB
        const conv = await this.conversation.create(body.prompt);
        convId = conv.id;
      }

      // Create placeholder assistant message
      const assistantMsg = await this.conversation.addMessage(convId, 'assistant', '');
      sendSSE('meta', {
        conversationId: convId,
        messageId: assistantMsg.id,
        outputDir: this.agentSdk.getOutputDir(),
      });

      // ── 2. Run agent with resume support ──
      let fullContent = '';
      let fullThinking = '';
      const events: any[] = []; // Accumulate non-content events for DB persistence

      for await (const chunk of this.agentSdk.run(body.prompt, resumeSid)) {
        switch (chunk.type) {
          case 'session':
            if (chunk.sessionId && convId) {
              await this.conversation.updateSdkSessionId(convId, chunk.sessionId);
              sendSSE('meta', { conversationId: convId, messageId: assistantMsg.id, sdkSessionId: chunk.sessionId });
            }
            break;
          case 'thinking':
            fullThinking += chunk.content || '';
            sendSSE('thinking', { content: chunk.content });
            break;
          case 'text':
            fullContent += chunk.content || '';
            sendSSE('text', { content: chunk.content });
            break;
            break;
          case 'tool_start':
            events.push({ type: 'tool_start', toolName: chunk.toolName, toolId: chunk.toolId, toolInput: chunk.toolInput });
            sendSSE('tool_start', { toolName: chunk.toolName, toolId: chunk.toolId, toolInput: chunk.toolInput });
            break;
          case 'tool_update':
            // Update the last tool_start event with the complete input
            events.push({ type: 'tool_update', toolName: chunk.toolName, toolId: chunk.toolId, toolInput: chunk.toolInput });
            sendSSE('tool_update', { toolName: chunk.toolName, toolId: chunk.toolId, toolInput: chunk.toolInput });
            break;
          case 'tool_progress':
            events.push({ type: 'tool_progress', toolName: chunk.toolName, toolId: chunk.toolId, status: chunk.subtype });
            sendSSE('tool_progress', { toolName: chunk.toolName, toolId: chunk.toolId, status: chunk.subtype });
            break;
          case 'status':
            events.push({ type: 'status', content: chunk.content, subtype: chunk.subtype });
            sendSSE('status', { content: chunk.content, subtype: chunk.subtype });
            break;
          case 'command_output':
            events.push({ type: 'command_output', content: chunk.content });
            sendSSE('command_output', { content: chunk.content });
            break;
          case 'done':
            await this.conversation.updateMessage(assistantMsg.id, fullContent, fullThinking, events);
            // Save generated HTML file paths from tool calls to conversation record
            if (convId) {
              for (const ev of events) {
                const fp = ev.type === 'tool_start' && (ev.toolInput?.file_path || ev.toolInput?.path);
                if (fp && typeof fp === 'string' && /\.html?$/i.test(fp)) {
                  await this.conversation.addOutputFile(convId, fp);
                }
              }
            }
            sendSSE('done', { messageId: assistantMsg.id, usage: chunk.usage });
            break;
        }
      }

      res.end();
    } catch (error: any) {
      console.error('Agent SDK endpoint error:', error.message);
      if (!res.headersSent) {
        res.status(500).json({ error: error.message || 'Agent SDK error' });
        return;
      }
      try { sendSSE('error', { message: error.message }); } catch { /* closed */ }
      res.end();
    }
  }
}
