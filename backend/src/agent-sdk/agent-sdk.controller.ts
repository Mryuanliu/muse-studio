import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Res,
  HttpCode,
  Header,
} from '@nestjs/common';
import { Response } from 'express';
import { AgentRunService } from './agent-run.service';

@Controller('agent')
export class AgentSdkController {
  constructor(private readonly agentRun: AgentRunService) {}

  @Get('status')
  async status(@Query('conversationId') conversationId: string) {
    if (!conversationId) {
      return { error: 'conversationId is required' };
    }
    return this.agentRun.status(conversationId);
  }

  @Post('run')
  @HttpCode(200)
  @Header('Content-Type', 'text/event-stream')
  @Header('Cache-Control', 'no-cache')
  @Header('Connection', 'keep-alive')
  @Header('X-Accel-Buffering', 'no')
  async run(
    @Body() body: {
      prompt?: string;
      conversationId?: string;      // our DB conv ID
      resumeSessionId?: string;     // SDK session ID for resume
      reattach?: boolean;           // attach without adding a new user/assistant message
    },
    @Res() res: Response,
  ) {
    const subscriber = {
      send: (event: string, data: unknown) => {
        if (res.writableEnded || res.destroyed) return false;
        try {
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
          return true;
        } catch {
          return false;
        }
      },
    };

    try {
      const donePromise = await this.agentRun.startOrAttach({
        prompt: body.prompt,
        conversationId: body.conversationId,
        resumeSessionId: body.resumeSessionId,
        reattach: body.reattach,
      }, subscriber);

      await donePromise;
      if (!res.writableEnded) {
        res.end();
      }
    } catch (error: any) {
      console.error('Agent SDK endpoint error:', error.message);
      if (!res.headersSent) {
        res.status(500).json({ error: error.message || 'Agent SDK error' });
        return;
      }
      subscriber.send('error', { message: error.message });
      if (!res.writableEnded) {
        res.end();
      }
    }
  }
}
