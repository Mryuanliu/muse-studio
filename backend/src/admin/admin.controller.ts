import { Controller, Get, Param, Delete, Query } from '@nestjs/common';
import { ConversationService } from '../conversation/conversation.service';

@Controller('admin')
export class AdminController {
  constructor(private readonly conversation: ConversationService) {}

  /** 数据表结构 */
  @Get('schema')
  getSchema() {
    return {
      tables: [
        {
          name: 'conversation',
          comment: '对话/任务',
          columns: [
            { name: 'id', type: 'UUID', pk: true, comment: '主键' },
            { name: 'title', type: 'varchar', comment: '对话标题（首条消息截取）' },
            { name: 'sdkSessionId', type: 'varchar', nullable: true, comment: 'Claude SDK session UUID，用于 resume' },
            { name: 'status', type: 'varchar', default: 'active', comment: '任务状态：active / archived' },
            { name: 'createdAt', type: 'datetime', comment: '创建时间' },
            { name: 'updatedAt', type: 'datetime', comment: '最后更新时间' },
          ],
        },
        {
          name: 'message',
          comment: '消息',
          columns: [
            { name: 'id', type: 'UUID', pk: true, comment: '主键' },
            { name: 'role', type: 'varchar', comment: '角色：user / assistant' },
            { name: 'content', type: 'text', comment: '消息正文' },
            { name: 'museEvents', type: 'text', nullable: true, comment: '统一事件流（思考、工具、子代理和运行状态）' },
            { name: 'attachments', type: 'text', nullable: true, comment: '用户附件 JSON' },
            { name: 'conversationId', type: 'UUID', fk: 'conversation.id', comment: '所属对话' },
            { name: 'createdAt', type: 'datetime', comment: '创建时间' },
          ],
        },
      ],
    };
  }

  /** 对话列表（含消息数） */
  @Get('conversations')
  async listConversations(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.conversation.adminListConversations(page ?? 1, limit ?? 50);
  }

  /** 消息列表 */
  @Get('messages')
  async listMessages(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.conversation.adminListMessages(page ?? 1, limit ?? 100);
  }

  /** 单条消息详情 */
  @Get('messages/:id')
  async getMessage(@Param('id') id: string) {
    return this.conversation.adminGetMessage(id);
  }

  /** 删除对话 */
  @Delete('conversations/:id')
  async deleteConversation(@Param('id') id: string) {
    await this.conversation.delete(id);
    return { deleted: true };
  }
}
