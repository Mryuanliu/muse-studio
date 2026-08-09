import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as Lark from '@larksuiteoapi/node-sdk';
import { AgentRunService } from '../agent-sdk/agent-run.service';
import { ConversationService } from '../conversation/conversation.service';
import { AgentService } from '../agent/agent.service';
import { FeishuMessageReceipt } from './entities/feishu-message-receipt.entity';
import { FeishuConversationBinding } from './entities/feishu-conversation-binding.entity';

type FeishuMessageEvent = any;

@Injectable()
export class FeishuService {
  private readonly logger = new Logger(FeishuService.name);
  private readonly client?: Lark.Client;
  private readonly wsClient?: Lark.WSClient;
  private readonly agentCode = process.env.FEISHU_AGENT_CODE || 'feishu-agent';
  private readonly chatQueues = new Map<string, Promise<void>>();

  constructor(
    @InjectRepository(FeishuMessageReceipt)
    private readonly receipts: Repository<FeishuMessageReceipt>,
    @InjectRepository(FeishuConversationBinding)
    private readonly chatBindings: Repository<FeishuConversationBinding>,
    private readonly conversation: ConversationService,
    private readonly agents: AgentService,
    private readonly agentRun: AgentRunService,
  ) {
    const appId = process.env.FEISHU_APP_ID;
    const appSecret = process.env.FEISHU_APP_SECRET;
    if (!appId || !appSecret) return;

    const config = { appId, appSecret };
    this.client = new Lark.Client(config);
    this.wsClient = new Lark.WSClient({
      ...config,
      // The SDK logs every reconnect attempt at info level. Sleep/wake can
      // produce many attempts, so keep routine retries quiet and expose only
      // meaningful lifecycle transitions through our own logger.
      loggerLevel: Lark.LoggerLevel.warn,
      onReady: () => this.logger.log('Feishu long connection ready'),
      onReconnecting: () => this.logger.warn('Feishu long connection lost; reconnecting'),
      onReconnected: () => this.logger.log('Feishu long connection restored'),
      onError: (error: Error) => this.logger.error(`Feishu long connection stopped: ${error.message}`),
    });
  }

  isConfigured(): boolean { return Boolean(this.client && this.wsClient); }

  start(): void {
    if (!this.wsClient) {
      this.logger.log('Feishu side channel disabled: FEISHU_APP_ID/FEISHU_APP_SECRET not configured');
      return;
    }
    this.wsClient.start({
      eventDispatcher: new Lark.EventDispatcher({
        encryptKey: process.env.FEISHU_ENCRYPT_KEY,
        verificationToken: process.env.FEISHU_VERIFICATION_TOKEN,
      }).register({
        'im.message.receive_v1': async (data: FeishuMessageEvent) => {
          // Acknowledge the event immediately. Agent execution is deliberately
          // detached because Feishu retries events after a short timeout.
          void this.enqueueMessage(data).catch((error: any) => {
            this.logger.error(`Feishu message handling failed: ${error?.message || error}`);
          });
        },
      }),
    });
    this.logger.log(`Feishu side channel started with agent ${this.agentCode}; subscribe to im.message.receive_v1 and grant message send permission`);
  }

  private enqueueMessage(data: FeishuMessageEvent): Promise<void> {
    const event = data?.event || data;
    const message = event?.message;
    const tenantKey = event?.tenant_key || event?.sender?.tenant_key || '';
    const chatId = message?.chat_id || message?.message_id || 'unknown';
    const queueKey = `${tenantKey}:${chatId}`;
    const previous = this.chatQueues.get(queueKey) || Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => this.handleMessage(data))
      .finally(() => {
        if (this.chatQueues.get(queueKey) === next) this.chatQueues.delete(queueKey);
      });
    this.chatQueues.set(queueKey, next);
    return next;
  }

  private async handleMessage(data: FeishuMessageEvent): Promise<void> {
    const event = data?.event || data;
    const message = event?.message;
    const sender = event?.sender;
    const messageId = message?.message_id;
    if (!messageId || sender?.sender_type === 'bot' || sender?.sender_type === 'app') return;

    const tenantKey = event?.tenant_key || sender?.tenant_key || '';
    const existing = await this.receipts.findOne({ where: { messageId } });
    if (existing) return;
    try {
      await this.receipts.save(this.receipts.create({ messageId, tenantKey }));
    } catch {
      if (await this.receipts.findOne({ where: { messageId } })) return;
      throw new Error('Failed to claim Feishu message');
    }

    const content = this.parseText(message.content, message.message_type);
    if (!content) {
      await this.reply(messageId, '目前只支持文本消息，请直接发送文字问题。');
      return;
    }

    const openId = sender?.sender_id?.open_id || '';
    const chatId = message.chat_id || openId || messageId;
    if (this.isNewConversationCommand(content)) {
      await this.startNewConversation(tenantKey, chatId, openId);
      await this.reply(messageId, '已开启新会话，接下来发送的消息会从全新的上下文开始。');
      return;
    }

    let binding = await this.chatBindings.findOne({ where: { tenantKey, chatId } });
    let conversationId = binding?.museConversationId;
    if (!conversationId) {
      const agent = await this.agents.findByCode(this.agentCode);
      const draft = await this.conversation.createDraft(await this.agents.runtime(agent.id));
      conversationId = draft.id;
      try {
        binding = await this.chatBindings.save(this.chatBindings.create({ tenantKey, chatId, openId, museConversationId: conversationId }));
      } catch {
        // Another delivery created the chat binding concurrently.
        binding = await this.chatBindings.findOne({ where: { tenantKey, chatId } });
        conversationId = binding?.museConversationId || conversationId;
      }
    }

    try {
      await this.reply(messageId, '已收到，我正在调用 feishu-agent 处理。');
    } catch (error: any) {
      this.logFeishuError('acknowledgement reply', error, messageId);
      return;
    }
    const agent = await this.agents.findByCode(this.agentCode);
    try {
      const result = await this.agentRun.runToCompletion({ prompt: content, conversationId, agentId: agent.id });
      const response = result.status === 'completed'
        ? result.content || '任务已完成。'
        : `处理未完成：${result.errorMessage || result.content || result.status}`;
      await this.reply(messageId, response);
    } catch (error: any) {
      const message = `处理失败：${error?.message || '未知错误'}`;
      this.logger.error(message);
      try {
        await this.reply(messageId, message);
      } catch (replyError: any) {
        this.logFeishuError('failure reply', replyError, messageId);
      }
    }
  }

  private parseText(raw: string | undefined, messageType: string | undefined): string {
    if (messageType && messageType !== 'text') return '';
    try {
      const parsed = JSON.parse(raw || '{}');
      return String(parsed.text || '').replace(/@_user_\d+\s*/g, '').trim();
    } catch {
      return '';
    }
  }

  private isNewConversationCommand(content: string): boolean {
    return /^(?:\/new|\/reset|新会话|开启新会话|开始新会话|重新开始)$/i.test(content.trim());
  }

  private async startNewConversation(tenantKey: string, chatId: string, openId: string): Promise<void> {
    const agent = await this.agents.findByCode(this.agentCode);
    const draft = await this.conversation.createDraft(await this.agents.runtime(agent.id));
    const binding = await this.chatBindings.findOne({ where: { tenantKey, chatId } });
    if (binding) {
      binding.openId = openId || binding.openId;
      binding.museConversationId = draft.id;
      await this.chatBindings.save(binding);
      return;
    }
    await this.chatBindings.save(this.chatBindings.create({
      tenantKey,
      chatId,
      openId,
      museConversationId: draft.id,
    }));
  }

  private async reply(messageId: string, text: string): Promise<void> {
    if (!this.client) return;
    const response = await this.client.im.v1.message.reply({
      path: { message_id: messageId },
      data: {
        content: JSON.stringify({ text: text.slice(0, 150 * 1024) }),
        msg_type: 'text',
      },
    });
    if (response.code && response.code !== 0) {
      throw new Error(`Feishu API ${response.code}: ${response.msg || 'request failed'}`);
    }
  }

  private logFeishuError(action: string, error: any, messageId: string): void {
    const response = error?.response?.data || error?.response || error?.data;
    const details = response && typeof response === 'object'
      ? {
          code: response.code,
          msg: response.msg,
          logId: response.log_id || response.logId,
          status: error?.response?.status,
          errorMessage: error?.message,
        }
      : { status: error?.response?.status, response, errorMessage: error?.message };
    this.logger.error(`Feishu ${action} failed for message ${messageId}: ${JSON.stringify(details)}`);
  }
}
