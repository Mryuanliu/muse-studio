import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(process.env.SANDBOX_ROOT || process.cwd());
fs.mkdirSync(root, { recursive: true });

function inside(target) {
  const abs = path.resolve(root, target);
  const rel = path.relative(root, abs);
  return {
    abs,
    ok: rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)),
  };
}

function assertInside(target) {
  const resolved = inside(target);
  if (!resolved.ok) {
    throw new Error(`Path escapes sandbox root: ${target}`);
  }
  return resolved.abs;
}

const server = new McpServer({
  name: 'workspace',
  version: '0.1.0',
});

server.tool(
  'read_file',
  'Read a text file from the sandbox workspace.',
  { file_path: z.string() },
  async ({ file_path }) => {
    const abs = assertInside(file_path);
    if (!fs.existsSync(abs)) throw new Error(`File not found: ${file_path}`);
    const stat = fs.statSync(abs);
    if (!stat.isFile()) throw new Error(`Not a file: ${file_path}`);
    if (stat.size > 1024 * 1024) throw new Error(`File too large: ${file_path}`);
    return { content: fs.readFileSync(abs, 'utf8') };
  },
);

server.tool(
  'write_file',
  'Write a text file into the sandbox workspace.',
  { file_path: z.string(), content: z.string() },
  async ({ file_path, content }) => {
    const abs = assertInside(file_path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
    return { ok: true, file_path: abs };
  },
);

server.tool(
  'edit_file',
  'Replace the first exact occurrence of old_string in a workspace file.',
  {
    file_path: z.string(),
    old_string: z.string(),
    new_string: z.string(),
  },
  async ({ file_path, old_string, new_string }) => {
    const abs = assertInside(file_path);
    if (!fs.existsSync(abs)) throw new Error(`File not found: ${file_path}`);
    const content = fs.readFileSync(abs, 'utf8');
    if (!content.includes(old_string)) {
      throw new Error(`old_string not found in ${file_path}`);
    }
    const next = content.replace(old_string, new_string);
    fs.writeFileSync(abs, next, 'utf8');
    return { ok: true, file_path: abs };
  },
);

server.tool(
  'list_files',
  'List files and directories inside a workspace path.',
  { path: z.string().optional().default('.') },
  async ({ path: target }) => {
    const abs = assertInside(target || '.');
    if (!fs.existsSync(abs)) throw new Error(`Path not found: ${target}`);
    const entries = fs.readdirSync(abs, { withFileTypes: true }).map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? 'directory' : 'file',
      path: path.join(target || '.', entry.name),
    }));
    return { entries };
  },
);

server.tool(
  'search_files',
  'Search workspace files by substring pattern.',
  {
    pattern: z.string(),
    path: z.string().optional().default('.'),
  },
  async ({ pattern, path: target }) => {
    const abs = assertInside(target || '.');
    const results = [];
    const ignored = new Set(['node_modules', '.next', '.git', 'dist', 'build']);

    function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (ignored.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile()) {
          try {
            const content = fs.readFileSync(full, 'utf8');
            if (content.includes(pattern)) {
              results.push(path.relative(abs, full));
            }
          } catch {
            // skip unreadable files
          }
        }
      }
    }

    walk(abs);
    return { results };
  },
);

server.tool(
  'validate_path',
  'Validate that a path is inside the sandbox workspace.',
  { path: z.string() },
  async ({ path: target }) => {
    const resolved = inside(target);
    return {
      ok: resolved.ok,
      absolute_path: resolved.abs,
      sandbox_root: root,
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
