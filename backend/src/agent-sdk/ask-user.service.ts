import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { RealtimeService } from '../realtime/realtime.service';
import { ConversationService } from '../conversation/conversation.service';

export interface AskUserQuestion {
  question: string;
  header?: string;
  options?: Array<{
    label: string;
    description?: string;
    preview?: string;
  }>;
  multiSelect?: boolean;
}

export interface AskUserPayload {
  requestId: string;
  conversationId: string;
  toolUseID: string;
  questions: AskUserQuestion[];
}

export interface AskUserAnswer {
  answers: Record<string, string>;
  response?: string;
  annotations?: Record<string, unknown>;
}

export interface AskUserEvent {
  type: 'ask_user';
  requestId: string;
  conversationId: string;
  toolUseID: string;
  questions?: AskUserQuestion[];
  answers?: Record<string, string>;
  status: 'pending' | 'submitted' | 'expired' | 'cancelled';
}

interface PendingAskUser extends AskUserPayload {
  resolve: (value: AskUserAnswer) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
  promise: Promise<AskUserAnswer>;
}

@Injectable()
export class AskUserService {
  private readonly logger = new Logger(AskUserService.name);
  private readonly pending = new Map<string, PendingAskUser>();
  private readonly earlyAnswers = new Map<string, AskUserAnswer>();
  private readonly listeners = new Set<(event: AskUserEvent) => void>();
  private readonly waitTimeoutMs = Number(process.env.ASK_USER_TIMEOUT_MS || 10 * 60 * 1000);

  constructor(
    private readonly realtime: RealtimeService,
    private readonly conversation: ConversationService,
  ) {}

  async getPendingForConversation(conversationId: string): Promise<AskUserPayload[]> {
    const inMemory = [...this.pending.values()]
      .filter((item) => item.conversationId === conversationId)
      .map((item) => ({
        requestId: item.requestId,
        conversationId: item.conversationId,
        toolUseID: item.toolUseID,
        questions: item.questions,
      }));
    const known = new Set(inMemory.map((item) => item.requestId));
    const persisted = await this.conversation.findOne(conversationId)
      .then((conv) => (conv.messages || []).flatMap((message) => {
        if (message.role !== 'assistant' || !message.events) return [];
        try { return JSON.parse(message.events); } catch { return []; }
      }))
      .catch(() => [] as any[]);
    for (const event of persisted) {
      if (event.type !== 'ask_user' || event.status !== 'pending' || known.has(event.requestId)) continue;
      inMemory.push({
        requestId: event.requestId,
        conversationId,
        toolUseID: event.toolUseID,
        questions: event.questions || [],
      });
      known.add(event.requestId);
    }
    return inMemory;
  }

  subscribe(listener: (event: AskUserEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async wait(payload: AskUserPayload): Promise<AskUserAnswer> {
    if (this.pending.has(payload.requestId)) {
      return this.pending.get(payload.requestId)!.promise;
    }

    const persisted = await this.conversation.findAssistantAskUser(payload.requestId);
    if (persisted?.event.status === 'submitted') {
      return {
        answers: persisted.event.answers || {},
      };
    }

    const earlyAnswer = this.earlyAnswers.get(payload.requestId);
    if (earlyAnswer) {
      this.earlyAnswers.delete(payload.requestId);
      await this.persistEvent(payload, {
        type: 'ask_user',
        requestId: payload.requestId,
        conversationId: payload.conversationId,
        toolUseID: payload.toolUseID,
        answers: earlyAnswer.answers,
        status: 'submitted',
      });
      return earlyAnswer;
    }

    const event: AskUserEvent = { ...payload, type: 'ask_user', status: 'pending' };
    await this.persistEvent(payload, event);

    let resolvePromise!: (value: AskUserAnswer) => void;
    let rejectPromise!: (error: Error) => void;
    const promise = new Promise<AskUserAnswer>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    const timeout = setTimeout(() => {
      this.pending.delete(payload.requestId);
      void this.persistEvent(payload, {
        type: 'ask_user',
        requestId: payload.requestId,
        conversationId: payload.conversationId,
        toolUseID: payload.toolUseID,
        questions: payload.questions,
        status: 'expired',
      });
      rejectPromise(new Error(`AskUser request timed out: ${payload.requestId}`));
    }, this.waitTimeoutMs);

    this.pending.set(payload.requestId, {
      ...payload,
      resolve: resolvePromise,
      reject: rejectPromise,
      timeout,
      promise,
    });

    this.publish(event);
    return promise;
  }

  async submit(payload: {
    requestId: string;
    answers?: Record<string, unknown>;
    response?: string;
    annotations?: Record<string, unknown>;
  }): Promise<AskUserAnswer> {
    const pending = this.pending.get(payload.requestId);
    if (!pending) {
      const known = await this.conversation.findAssistantAskUser(payload.requestId);
      if (!known || known.event.status !== 'pending') {
        throw new NotFoundException(`AskUser request ${payload.requestId} not found`);
      }
      const answer = this.buildAnswer(payload);
      this.earlyAnswers.set(payload.requestId, answer);
      await this.persistEvent({
        requestId: payload.requestId,
        conversationId: known.conversationId,
        toolUseID: known.event.toolUseID,
        questions: known.event.questions || [],
      }, {
        type: 'ask_user',
        requestId: payload.requestId,
        conversationId: known.conversationId,
        toolUseID: known.event.toolUseID,
        questions: known.event.questions || [],
        answers: answer.answers,
        status: 'submitted',
      });
      this.publish({
        type: 'ask_user',
        requestId: payload.requestId,
        conversationId: known.conversationId,
        toolUseID: known.event.toolUseID,
        questions: known.event.questions || [],
        answers: answer.answers,
        status: 'submitted',
      });
      return answer;
    }

    clearTimeout(pending.timeout);
    this.pending.delete(payload.requestId);

    const answer = this.buildAnswer(payload);

    await this.persistEvent(pending, {
      type: 'ask_user',
      requestId: pending.requestId,
      conversationId: pending.conversationId,
      toolUseID: pending.toolUseID,
      answers: answer.answers,
      status: 'submitted',
    });
    this.publish({
      type: 'ask_user',
      requestId: pending.requestId,
      conversationId: pending.conversationId,
      toolUseID: pending.toolUseID,
      answers: answer.answers,
      status: 'submitted',
    });

    pending.resolve(answer);
    return answer;
  }

  private buildAnswer(payload: { answers?: Record<string, unknown>; response?: string; annotations?: Record<string, unknown> }): AskUserAnswer {
    const answer: AskUserAnswer = { answers: this.normalizeAnswers(payload.answers || {}) };
    if (payload.response) answer.response = payload.response;
    if (payload.annotations) answer.annotations = payload.annotations;
    return answer;
  }

  private async persistEvent(payload: AskUserPayload, event: AskUserEvent): Promise<void> {
    await this.conversation.upsertAssistantEvent(payload.conversationId, event);
  }

  private publish(event: AskUserEvent): void {
    for (const listener of this.listeners) listener(event);
    this.realtime.emitToConversation(event.conversationId, 'ask_user', event);
  }

  cancelForConversation(conversationId: string): void {
    for (const [requestId, pending] of [...this.pending.entries()]) {
      if (pending.conversationId !== conversationId) continue;
      clearTimeout(pending.timeout);
      this.pending.delete(requestId);
      void this.persistEvent(pending, {
        type: 'ask_user',
        requestId: pending.requestId,
        conversationId: pending.conversationId,
        toolUseID: pending.toolUseID,
        questions: pending.questions,
        status: 'cancelled',
      });
      this.publish({
        type: 'ask_user',
        requestId: pending.requestId,
        conversationId: pending.conversationId,
        toolUseID: pending.toolUseID,
        questions: pending.questions,
        status: 'cancelled',
      });
      pending.reject(new Error('AskUser request cancelled'));
    }
  }

  private normalizeAnswers(answers: Record<string, unknown>): Record<string, string> {
    const normalized: Record<string, string> = {};
    for (const [question, value] of Object.entries(answers)) {
      if (Array.isArray(value)) {
        normalized[question] = value
          .filter((item) => item !== null && item !== undefined)
          .map((item) => String(item))
          .join(',');
      } else if (value !== null && value !== undefined) {
        normalized[question] = String(value);
      }
    }
    return normalized;
  }
}
