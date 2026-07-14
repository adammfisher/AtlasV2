/**
 * Parity-audit MCP server (streamable-HTTP, port 7983): a fast echo tool and a
 * deliberately slow tool. P2 adds it by URL from the UI; P6 kills this process
 * mid-call to prove the tool loop degrades honestly instead of hanging.
 * Run: npx tsx scripts/test/parity-mock-mcp.ts
 */
import { createServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

createServer((req, res) => {
  if (!req.url?.startsWith('/mcp')) {
    res.writeHead(404).end();
    return;
  }
  const s = new McpServer({ name: 'parity-probe', version: '1.0.0' });
  s.tool(
    'probe_echo',
    'Echoes the given text back with a PROBE- prefix. Use when asked to test the probe connector.',
    { text: z.string() },
    async ({ text }) => ({ content: [{ type: 'text', text: `PROBE-${text}` }] }),
  );
  s.tool(
    'probe_slow',
    'Waits the given seconds then replies. Use when asked to run the slow probe.',
    { seconds: z.number().min(1).max(120) },
    async ({ seconds }) => {
      await new Promise((r) => setTimeout(r, seconds * 1000));
      return { content: [{ type: 'text', text: `slow done after ${seconds}s` }] };
    },
  );
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  void s.connect(transport).then(() => transport.handleRequest(req, res));
}).listen(7983, '127.0.0.1', () => console.log('parity mock MCP on http://127.0.0.1:7983/mcp'));
