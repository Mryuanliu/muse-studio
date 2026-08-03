import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { RealtimeService } from '../realtime/realtime.service';

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

interface PendingAskUser extends AskUserPayload {
  resolve: (value: AskUserAnswer) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

@Injectable()
export class AskUserService {
  private readonly logger = new Logger(AskUserService.name);
  private readonly pending = new Map<string, PendingAskUser>();
  private readonly waitTimeoutMs = Number(process.env.ASK_USER_TIMEOUT_MS || 10 * 60 * 1000);

  constructor(private readonly realtime: RealtimeService) {}

  getPendingForConversation(conversationId: string): AskUserPayload[] {
    return [...this.pending.values()]
      .filter((item) => item.conversationId === conversationId)
      .map((item) => ({
        requestId: item.requestId,
        conversationId: item.conversationId,
        toolUseID: item.toolUseID,
        questions: item.questions,
      }));
  }

  async wait(payload: AskUserPayload): Promise<AskUserAnswer> {
    if (this.pending.has(payload.requestId)) {
      throw new Error(`AskUser request ${payload.requestId} is already pending`);
    }

    return new Promise<AskUserAnswer>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(payload.requestId);
        reject(new Error(`AskUser request timed out: ${payload.requestId}`));
      }, this.waitTimeoutMs);

      this.pending.set(payload.requestId, {
        ...payload,
        resolve,
        reject,
        timeout,
      });

      this.realtime.emitToConversation(payload.conversationId, 'ask_user', {
        requestId: payload.requestId,
        conversationId: payload.conversationId,
        toolUseID: payload.toolUseID,
        questions: payload.questions,
      });
    });
  }

  submit(payload: {
    requestId: string;
    answers?: Record<string, unknown>;
    response?: string;
    annotations?: Record<string, unknown>;
  }): AskUserAnswer {
    const pending = this.pending.get(payload.requestId);
    if (!pending) {
      throw new NotFoundException(`AskUser request ${payload.requestId} not found`);
    }

    clearTimeout(pending.timeout);
    this.pending.delete(payload.requestId);

    const answer: AskUserAnswer = {
      answers: this.normalizeAnswers(payload.answers || {}),
    };
    if (payload.response) answer.response = payload.response;
    if (payload.annotations) answer.annotations = payload.annotations;

    pending.resolve(answer);
    return answer;
  }

  cancelForConversation(conversationId: string): void {
    for (const [requestId, pending] of [...this.pending.entries()]) {
      if (pending.conversationId !== conversationId) continue;
      clearTimeout(pending.timeout);
      this.pending.delete(requestId);
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
