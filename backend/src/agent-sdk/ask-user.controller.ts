import { BadRequestException, Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { AskUserService, AskUserPayload } from './ask-user.service';

@Controller('agent/ask-user')
export class AskUserController {
  constructor(private readonly askUser: AskUserService) {}

  @Get('pending')
  async pending(@Query('conversationId') conversationId: string) {
    if (!conversationId) {
      throw new BadRequestException('conversationId is required');
    }
    return this.askUser.getPendingForConversation(conversationId);
  }

  @Post('wait')
  @HttpCode(200)
  async wait(@Body() body: AskUserPayload) {
    if (!body.requestId || !body.conversationId || !body.toolUseID) {
      throw new BadRequestException('requestId, conversationId and toolUseID are required');
    }
    if (!Array.isArray(body.questions) || body.questions.length === 0) {
      throw new BadRequestException('questions are required');
    }
    return this.askUser.wait(body);
  }

  @Post('answer')
  @HttpCode(200)
  answer(@Body() body: {
    requestId: string;
    answers?: Record<string, unknown>;
    response?: string;
    annotations?: Record<string, unknown>;
  }) {
    if (!body.requestId) {
      throw new BadRequestException('requestId is required');
    }
    return this.askUser.submit(body);
  }
}
