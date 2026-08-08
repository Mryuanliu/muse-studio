import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const url = process.env.MUSE_REMOTE_MCP_URL;
const configuredHeaders = parseJson(process.env.MUSE_REMOTE_MCP_HEADERS, {});
const timeout = Number(process.env.MUSE_REMOTE_MCP_TIMEOUT || 30000);

if (!url) throw new Error('MUSE_REMOTE_MCP_URL is required');

const cookies = new Map();

function parseJson(value, fallback) {
  try {
    const parsed = value ? JSON.parse(value) : fallback;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function rememberCookies(response) {
  const headers = response.headers;
  const setCookies = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : (headers.get('set-cookie') ? [headers.get('set-cookie')] : []);
  for (const value of setCookies) {
    const pair = value.split(';', 1)[0];
    const separator = pair.indexOf('=');
    if (separator > 0) cookies.set(pair.slice(0, separator).trim(), pair.slice(separator + 1).trim());
  }
}

function cookieHeader() {
  return [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

function mergeHeaders(init) {
  const headers = new Headers(init?.headers || {});
  for (const [name, value] of Object.entries(configuredHeaders)) headers.set(name, String(value));
  const cookie = cookieHeader();
  if (cookie) headers.set('cookie', cookie);
  return headers;
}

async function cookieFetch(input, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  const signal = init.signal;
  const abort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', abort, { once: true });
  }
  try {
    const response = await fetch(input, { ...init, headers: mergeHeaders(init), signal: controller.signal });
    rememberCookies(response);
    return response;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

function errorResult(error) {
  const message = error?.name === 'AbortError'
    ? `Remote MCP request timed out after ${timeout}ms`
    : `Remote MCP request failed: ${error?.message || String(error)}`;
  return { content: [{ type: 'text', text: message }], isError: true };
}

const remote = new Client({ name: 'muse-remote-http-bridge', version: '1.0.0' });
const remoteTransport = new StreamableHTTPClientTransport(new URL(url), {
  fetch: cookieFetch,
  reconnectionOptions: {
    maxReconnectionDelay: 5000,
    initialReconnectionDelay: 250,
    reconnectionDelayGrowFactor: 1.5,
    maxRetries: 1,
  },
});

await remote.connect(remoteTransport);
let tools = (await remote.listTools()).tools || [];

const local = new Server(
  { name: 'muse-remote-http-bridge', version: '1.0.0' },
  { capabilities: { tools: { listChanged: false } } },
);

local.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
local.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const result = await remote.callTool({
      name: request.params.name,
      arguments: request.params.arguments || {},
    });
    return result;
  } catch (error) {
    return errorResult(error);
  }
});

const localTransport = new StdioServerTransport();
localTransport.onerror = (error) => process.stderr.write(`[remote-mcp-bridge] stdio error: ${error.message}\n`);
remoteTransport.onerror = (error) => process.stderr.write(`[remote-mcp-bridge] remote error: ${error.message}\n`);
await local.connect(localTransport);

process.on('SIGTERM', async () => {
  await remote.close().catch(() => undefined);
  await local.close().catch(() => undefined);
  process.exit(0);
});
