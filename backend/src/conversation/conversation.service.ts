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
  async create(firstMessage: string): Promise<Conversation> {
    const conv = this.convRepo.create({
      title: firstMessage.slice(0, 50) || '新对话',
    });
    const saved = await this.convRepo.save(conv);

    // Save the first user message
    const msg = this.msgRepo.create({
      role: 'user',
      content: firstMessage,
      conversationId: saved.id,
    });
    await this.msgRepo.save(msg);

    return this.convRepo.findOne({ where: { id: saved.id }, relations: ['messages'] }) as Promise<Conversation>;
  }

  async createDraft(): Promise<Conversation> {
    const saved = await this.convRepo.save(this.convRepo.create({ title: '新对话' }));
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
  ): Promise<Message> {
    const msg = this.msgRepo.create({
      role,
      content,
      thinkingChain,
      events: events ? JSON.stringify(events) : undefined,
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
  ): Promise<void> {
    const update: any = { content, thinkingChain };
    if (events) update.events = JSON.stringify(events);
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
