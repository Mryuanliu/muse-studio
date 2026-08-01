import { Controller, Get, Param, Res } from '@nestjs/common';
import { Response } from 'express';
import * as path from 'path';
import * as fs from 'fs';
import { resolveOutputDir } from '../output-dir';

/**
 * Serves generated HTML files from the h5-output directory.
 * GET /output/finance-website.html → serves the file.
 */
@Controller('output')
export class OutputController {
  @Get(':filename')
  serveFile(@Param('filename') filename: string, @Res() res: Response) {
    const outputDir = resolveOutputDir();
    const filePath = path.join(outputDir, filename);

    // Security: prevent directory traversal
    if (!filePath.startsWith(outputDir)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.sendFile(filePath);
  }
}
