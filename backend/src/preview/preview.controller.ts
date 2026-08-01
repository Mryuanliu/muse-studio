import { Controller, All, Param, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import * as http from 'http';
import { PreviewService } from './preview.service';

@Controller('preview/:conversationId')
export class PreviewController {
  private readonly sandboxUrl = process.env.SANDBOX_SERVICE_URL || 'http://localhost:3002';
  private readonly publicBase = process.env.PUBLIC_BASE_URL || 'http://localhost:3001';

  constructor(private readonly preview: PreviewService) {}

  @All()
  async proxyRoot(
    @Param('conversationId') conversationId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await this.handleProxy(conversationId, req, res);
  }

  @All('*path')
  async proxy(
    @Param('conversationId') conversationId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await this.handleProxy(conversationId, req, res);
  }

  private async handleProxy(
    conversationId: string,
    req: Request,
    res: Response,
  ): Promise<void> {
    const projectPath = this.preview.getProjectPath(conversationId);
    if (projectPath) {
      try {
        const resp = await fetch(`${this.sandboxUrl}/preview/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId: conversationId, projectPath }),
        });
        const data = await resp.json();
        if (data?.url) {
          this.preview.setUrl(conversationId, data.url, data.port, projectPath);
        }
      } catch {
        // sandbox may already be handling this request
      }
    }

    const prefix = `/preview/${conversationId}`;
    const rawPath = req.originalUrl || req.url || '/';
    const subpath = rawPath.startsWith(prefix)
      ? rawPath.slice(prefix.length) || '/'
      : rawPath;
    const target = new URL(
      `${this.sandboxUrl}/preview/${encodeURIComponent(conversationId)}${subpath}`,
    );
    const headers = { ...req.headers };
    headers.host = target.host;

    const proxyReq = http.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: req.method,
        headers,
      },
      (proxyRes) => {
        res.status(proxyRes.statusCode || 502);
        for (const [key, value] of Object.entries(proxyRes.headers)) {
          if (value !== undefined) res.setHeader(key, value);
        }
        proxyRes.pipe(res);
      },
    );

    proxyReq.on('error', () => {
      const projectPath = this.preview.getProjectPath(conversationId);
      if (!res.headersSent && projectPath) {
        void this.restartAndRedirect(conversationId, projectPath, res);
        return;
      }
      if (!res.headersSent) res.status(502).json({ error: 'Preview unavailable' });
      else res.end();
    });

    req.pipe(proxyReq);
  }

  private async restartAndRedirect(
    conversationId: string,
    projectPath: string,
    res: Response,
  ): Promise<void> {
    try {
      const resp = await fetch(`${this.sandboxUrl}/preview/${encodeURIComponent(conversationId)}/restart`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await resp.json();
      if (data?.url) {
        this.preview.setUrl(conversationId, data.url, data.port, projectPath);
      }
    } catch {
      // restart failed; redirect will surface the retry to the frontend
    }
    if (!res.headersSent) {
      res.redirect(307, `${this.publicBase}/preview/${conversationId}`);
    } else {
      res.end();
    }
  }
}
