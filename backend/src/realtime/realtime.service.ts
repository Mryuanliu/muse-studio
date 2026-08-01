import { Injectable } from '@nestjs/common';
import { Server } from 'socket.io';

@Injectable()
export class RealtimeService {
  private io: Server | null = null;

  setServer(io: Server): void {
    this.io = io;
  }

  emitToConversation(conversationId: string, event: string, data: unknown): void {
    this.io?.to(`conversation:${conversationId}`).emit(event, data);
  }
}
