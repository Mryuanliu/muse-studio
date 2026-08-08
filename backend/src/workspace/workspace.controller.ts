import { Body, Controller, Delete, Get, Param, Post, Put, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { WorkspaceService } from './workspace.service';

@Controller('workspace')
export class WorkspaceController {
  constructor(private readonly workspace: WorkspaceService) {}

  @Get(':conversationId/tree')
  async tree(@Param('conversationId') conversationId: string, @Query('path') relativePath?: string) {
    const root = await this.workspace.rootFor(conversationId);
    return { nodes: this.workspace.tree(root, relativePath || '.') };
  }

  @Get(':conversationId/file')
  async read(@Param('conversationId') conversationId: string, @Query('path') relativePath: string) {
    const root = await this.workspace.rootFor(conversationId);
    return this.workspace.read(root, relativePath);
  }

  @Put(':conversationId/file')
  async write(@Param('conversationId') conversationId: string, @Body() body: { path?: string; content?: string }) {
    if (!body.path || typeof body.content !== 'string') throw new Error('path and content are required');
    const root = await this.workspace.rootFor(conversationId);
    return this.workspace.write(root, body.path, body.content);
  }

  @Post(':conversationId/file')
  async createFile(@Param('conversationId') conversationId: string, @Body() body: { path?: string; content?: string }) {
    if (!body.path) throw new Error('path is required');
    return this.workspace.write(await this.workspace.rootFor(conversationId), body.path, body.content || '');
  }

  @Post(':conversationId/folder')
  async mkdir(@Param('conversationId') conversationId: string, @Body() body: { path?: string }) {
    if (!body.path) throw new Error('path is required');
    return this.workspace.mkdir(await this.workspace.rootFor(conversationId), body.path);
  }

  @Delete(':conversationId/node')
  async remove(@Param('conversationId') conversationId: string, @Query('path') relativePath: string) {
    return this.workspace.remove(await this.workspace.rootFor(conversationId), relativePath);
  }

  @Post(':conversationId/upload')
  async upload(@Param('conversationId') conversationId: string, @Body() body: { filename?: string; mimeType?: string; data?: string }) {
    if (!body.filename || !body.data || !body.mimeType?.startsWith('image/')) throw new Error('An image filename, mimeType and data are required');
    return this.workspace.saveUpload(await this.workspace.rootFor(conversationId), body.filename, body.mimeType, body.data);
  }

  @Get(':conversationId/raw')
  async raw(@Param('conversationId') conversationId: string, @Query('path') relativePath: string, @Res() res: Response) {
    const raw = this.workspace.raw(await this.workspace.rootFor(conversationId), relativePath);
    res.setHeader('Content-Type', raw.mimeType);
    res.sendFile(raw.file);
  }
}
