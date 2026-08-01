import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import PreviewManager from '../dist/preview-manager.js';

const root = path.resolve(process.env.SANDBOX_ROOT || process.cwd());
fs.mkdirSync(root, { recursive: true });

function assertInside(target) {
  const abs = path.resolve(root, target || '.');
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Path escapes sandbox root: ${target}`);
  }
  return abs;
}

const manager = new PreviewManager();
const server = new McpServer({
  name: 'preview',
  version: '0.1.0',
});

server.tool(
  'start_dev_server',
  'Start or restart a frontend dev server for a project inside the sandbox.',
  {
    project_path: z.string(),
    command: z.string().optional().default('npm'),
    args: z.array(z.string()).optional().default(['run', 'dev']),
    port: z.number().int().positive().optional(),
  },
  async ({ project_path, command, args, port }) => {
    const project = assertInside(project_path || '.');
    return manager.start(project, command, args, port);
  },
);

server.tool(
  'stop_dev_server',
  'Stop a running frontend dev server.',
  { project_path: z.string() },
  async ({ project_path }) => {
    return manager.stop(assertInside(project_path || '.'));
  },
);

server.tool(
  'get_preview_url',
  'Get or start the preview URL of a project.',
  { project_path: z.string() },
  async ({ project_path }) => {
    return manager.getUrl(assertInside(project_path || '.'));
  },
);

server.tool(
  'check_health',
  'Check preview health and restart the dev server if it is unavailable.',
  { project_path: z.string() },
  async ({ project_path }) => {
    return manager.check(assertInside(project_path || '.'));
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
