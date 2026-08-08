import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    @InjectRepository(Conversation)
    private readonly convRepo: Repository<Conversation>,
    @InjectRepository(Message)
    private readonly msgRepo: Repository<Message>,
  ) {}

  /** Create a new conversation with the first user message. */
  async create(firstMessage: string, attachments?: any[], agentSnapshot?: any): Promise<Conversation> {
    const conv = this.convRepo.create({
      title: firstMessage.slice(0, 50) || '新对话',
      agentId: agentSnapshot?.agentId,
      agentName: agentSnapshot?.agentName,
      agentType: agentSnapshot?.agentType,
      agentSnapshot: agentSnapshot ? JSON.stringify(agentSnapshot) : undefined,
    });
    const saved = await this.convRepo.save(conv);

    // Save the first user message
    const msg = this.msgRepo.create({
      role: 'user',
      content: firstMessage,
      attachments: attachments?.length ? JSON.stringify(attachments) : undefined,
      conversationId: saved.id,
    });
    await this.msgRepo.save(msg);

    return this.convRepo.findOne({ where: { id: saved.id }, relations: ['messages'] }) as Promise<Conversation>;
  }

  async createDraft(agentSnapshot?: any): Promise<Conversation> {
    const saved = await this.convRepo.save(this.convRepo.create({
      title: '新对话',
      agentId: agentSnapshot?.agentId,
      agentName: agentSnapshot?.agentName,
      agentType: agentSnapshot?.agentType,
      agentSnapshot: agentSnapshot ? JSON.stringify(agentSnapshot) : undefined,
    }));
    return this.convRepo.findOne({ where: { id: saved.id }, relations: ['messages'] }) as Promise<Conversation>;
  }

  /** Find a conversation by ID with its messages. */
  async findOne(id: string): Promise<Conversation> {
    const conv = await this.convRepo.findOne({
      where: { id },
      relations: ['messages'],
      order: { messages: { createdAt: 'ASC' } },
    });
    if (!conv) throw new NotFoundException(`Conversation ${id} not found`);
    return conv;
  }

  /** List all conversations (without full messages). */
  async findAll(): Promise<Conversation[]> {
    return this.convRepo.find({
      order: { updatedAt: 'DESC' },
    });
  }

  /** Add a message to a conversation. Returns the saved message. */
  async addMessage(
    conversationId: string,
    role: 'user' | 'assistant',
    content: string,
    thinkingChain?: string,
    events?: any[],
    attachments?: any[],
  ): Promise<Message> {
    const msg = this.msgRepo.create({
      role,
      content,
      thinkingChain,
      events: events ? JSON.stringify(events) : undefined,
      attachments: attachments?.length ? JSON.stringify(attachments) : undefined,
      conversationId,
    });
    const saved = await this.msgRepo.save(msg);
    await this.convRepo.update(conversationId, { updatedAt: new Date() });
    return saved;
  }

  /** Update an existing message (e.g., after streaming completes). */
  async updateMessage(
    messageId: string,
    content: string,
    thinkingChain?: string,
    events?: any[],
    attachments?: any[],
  ): Promise<void> {
    const update: any = { content, thinkingChain };
    if (events) update.events = JSON.stringify(events);
    if (attachments) update.attachments = JSON.stringify(attachments);
    await this.msgRepo.update(messageId, update);
  }

  /** Append events to an existing message (streaming). */
  async appendEvents(messageId: string, events: any[]): Promise<void> {
    const msg = await this.msgRepo.findOne({ where: { id: messageId } });
    if (!msg) return;
    const existing = msg.events ? JSON.parse(msg.events) : [];
    existing.push(...events);
    await this.msgRepo.update(messageId, { events: JSON.stringify(existing) });
  }

  /** Upsert an interactive question event without disturbing event order. */
  async upsertAssistantEvent(conversationId: string, event: any): Promise<void> {
    const messages = await this.msgRepo.find({
      where: { conversationId, role: 'assistant' },
      order: { createdAt: 'DESC' },
    });
    let message = messages[0];
    if (!message) return;

    let events: any[] = [];
    for (const candidate of messages) {
      if (!candidate.events) continue;
      try {
        const candidateEvents = JSON.parse(candidate.events);
        if (event.requestId && candidateEvents.some(
          (item: any) => item.type === 'ask_user' && item.requestId === event.requestId,
        )) {
          message = candidate;
          events = candidateEvents;
          break;
        }
      } catch {
        // Ignore malformed legacy event data.
      }
    }
    if (!events.length && message.events) {
      try { events = JSON.parse(message.events); } catch { events = []; }
    }
    const index = event.requestId
      ? events.findIndex((item) => item.type === 'ask_user' && item.requestId === event.requestId)
      : -1;
    if (index >= 0) {
      events[index] = {
        ...events[index],
        ...event,
        type: 'ask_user',
        questions: event.questions || events[index].questions,
      };
    } else {
      events.push(event);
    }
    await this.msgRepo.update(message.id, { events: JSON.stringify(events) });
    await this.convRepo.update(conversationId, { updatedAt: new Date() });
  }

  async findAssistantAskUser(requestId: string): Promise<{ conversationId: string; event: any } | undefined> {
    const messages = await this.msgRepo.find({
      where: { role: 'assistant' },
    });
    for (const message of messages) {
      if (!message.events) continue;
      try {
        const event = JSON.parse(message.events).find(
          (item: any) => item.type === 'ask_user' && item.requestId === requestId,
        );
        if (event) return { conversationId: message.conversationId, event };
      } catch {
        // Ignore malformed legacy event data.
      }
    }
    return undefined;
  }

  /** Get messages for a conversation. */
  async getMessages(conversationId: string): Promise<Message[]> {
    return this.msgRepo.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
    });
  }

  /** Save the SDK session ID after first agent run. */
  async updateSdkSessionId(conversationId: string, sdkSessionId: string): Promise<void> {
    await this.convRepo.update(conversationId, { sdkSessionId });
  }

  /** Save the sandbox output directory so resume uses the same workspace. */
  async updateOutputDir(conversationId: string, outputDir: string): Promise<void> {
    await this.convRepo.update(conversationId, { outputDir });
  }

  async setAgentSnapshot(conversationId: string, snapshot: any): Promise<void> {
    await this.convRepo.update(conversationId, {
      agentId: snapshot?.agentId,
      agentName: snapshot?.agentName,
      agentType: snapshot?.agentType,
      agentSnapshot: snapshot ? JSON.stringify(snapshot) : undefined,
    });
  }

  /** Save the current agent run status. */
  async updateRunStatus(conversationId: string, runStatus: string): Promise<void> {
    await this.convRepo.update(conversationId, { runStatus, updatedAt: new Date() });
  }

  /** Append an output file path to the conversation. */
  async addOutputFile(conversationId: string, filePath: string): Promise<void> {
    const conv = await this.convRepo.findOne({ where: { id: conversationId } });
    if (!conv) return;
    const files: string[] = conv.outputFiles ? JSON.parse(conv.outputFiles) : [];
    if (!files.includes(filePath)) {
      files.push(filePath);
      await this.convRepo.update(conversationId, { outputFiles: JSON.stringify(files) });
    }
  }

  // ── Admin queries ──

  /** List all conversations for admin, with message count. */
  async adminListConversations(page = 1, limit = 50): Promise<{ rows: any[]; total: number }> {
    const [rows, total] = await this.convRepo.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      order: { updatedAt: 'DESC' },
    });
    // Attach message count per conversation
    const enriched = await Promise.all(
      rows.map(async (c) => ({
        ...c,
        messageCount: await this.msgRepo.count({ where: { conversationId: c.id } }),
      })),
    );
    return { rows: enriched, total };
  }

  /** List all messages for admin. */
  async adminListMessages(page = 1, limit = 100): Promise<{ rows: Message[]; total: number }> {
    const [rows, total] = await this.msgRepo.findAndCount({
      skip: (page - 1) * limit,
      take: limit,
      order: { createdAt: 'DESC' },
      relations: ['conversation'],
    });
    return { rows, total };
  }

  /** Get a single message detail. */
  async adminGetMessage(id: string): Promise<Message> {
    const msg = await this.msgRepo.findOne({
      where: { id },
      relations: ['conversation'],
    });
    if (!msg) throw new NotFoundException(`Message ${id} not found`);
    return msg;
  }

  /** Delete a conversation. */
  async delete(id: string): Promise<void> {
    await this.convRepo.delete(id);
  }
}
