import { Module } from '@nestjs/common';
import { ProxyController } from './proxy.controller';
import { ProxyService } from './proxy.service';
import { OpenAICompatibleAdapter } from '../ai/providers/openai-compatible.adapter';

@Module({
  controllers: [ProxyController],
  providers: [ProxyService, OpenAICompatibleAdapter],
  exports: [ProxyService],
})
export class ProxyModule {}
