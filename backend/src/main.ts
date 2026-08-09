import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Server } from 'socket.io';
import { AppModule } from './app.module';
import { RealtimeService } from './realtime/realtime.service';
import { PreviewService } from './preview/preview.service';
import { ConversationService } from './conversation/conversation.service';
import { AskUserService } from './agent-sdk/ask-user.service';
import { FeishuService } from './feishu/feishu.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  (app as any).useBodyParser('json', { limit: '50mb' });

  app.enableCors({
    origin: ['http://localhost:3000'],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'anthropic-version'],
  });

  const port = process.env.PORT || 3001;
  await app.listen(port);

  const io = new Server(app.getHttpServer(), {
    cors: {
      origin: 'http://localhost:3000',
      methods: ['GET', 'POST'],
    },
  });

  const realtime = app.get(RealtimeService);
  realtime.setServer(io);
  const previewService = app.get(PreviewService);
  const conversationService = app.get(ConversationService);
  const askUserService = app.get(AskUserService);
  app.get(FeishuService).start();
  const publicBase = process.env.PUBLIC_BASE_URL || 'http://localhost:3001';
  const sandboxUrl = process.env.SANDBOX_SERVICE_URL || 'http://localhost:3002';

  io.on('connection', (socket) => {
    socket.on('preview:join', async (payload: any = {}) => {
      const ids = Array.isArray(payload.conversationIds)
        ? payload.conversationIds
        : payload.conversationId
          ? [payload.conversationId]
          : [];
      for (const id of ids) {
        if (typeof id === 'string') {
          void socket.join(`conversation:${id}`);

          for (const pendingQuestion of await askUserService.getPendingForConversation(id)) {
            socket.emit('ask_user', pendingQuestion);
          }

          const conv = await conversationService.findOne(id).catch(() => null);
          const isRunning = conv?.runStatus === 'running';

          try {
            const startRes = await fetch(`${sandboxUrl}/preview/start`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ taskId: id }),
            });
            const startData = await startRes.json();

            if (startData?.running && startData?.healthy && startData?.url) {
              previewService.setUrl(id, startData.url, startData.port);
              socket.emit('preview', {
                status: 'ready',
                url: `${publicBase}/preview/${id}`,
              });
            } else if (startData?.running) {
              socket.emit('preview', { status: 'starting' });
            } else if (isRunning) {
              socket.emit('preview', { status: 'starting' });
            } else {
              socket.emit('preview', {
                status: 'error',
                message: startData?.error || 'Preview unavailable',
              });
            }
          } catch (error: any) {
            socket.emit('preview', {
              status: isRunning ? 'starting' : 'error',
              message: error?.message || 'Preview unavailable',
            });
          }
        }
      }
    });

    socket.on('preview:leave', (payload: any = {}) => {
      const ids = Array.isArray(payload.conversationIds)
        ? payload.conversationIds
        : payload.conversationId
          ? [payload.conversationId]
          : [];
      for (const id of ids) {
        if (typeof id === 'string') {
          void socket.leave(`conversation:${id}`);
        }
      }
    });
  });

  console.log(`🚀 Backend running on http://localhost:${port}`);
  console.log(`   Anthropic-compatible endpoint: POST http://localhost:${port}/v1/messages`);
}

bootstrap();
