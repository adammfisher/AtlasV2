/**
 * Mock Confluence (7981) + Jira (7982) MCP connectors (Amendment §A9 test
 * surface). zod schemas ASSERT the received structure — a malformed push fails
 * the MCP call, which fails the gate. Run: npx tsx scripts/test/mock-connectors.ts
 */
import { createServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

function serve(port: number, build: () => McpServer): void {
  createServer((req, res) => {
    if (!req.url?.startsWith('/mcp')) {
      res.writeHead(404).end();
      return;
    }
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    void build().connect(transport).then(() => transport.handleRequest(req, res));
  }).listen(port, '127.0.0.1', () => console.log(`mock connector on http://127.0.0.1:${port}/mcp`));
}

serve(7981, () => {
  const s = new McpServer({ name: 'mock-confluence', version: '0.1.0' });
  s.tool(
    'confluence_create_page',
    'Create a Confluence page from storage-format XHTML.',
    {
      title: z.string().min(3),
      space: z.string().min(1),
      storage: z.string().min(20).refine((v) => v.includes('<h1>'), 'storage must be XHTML with an <h1>'),
    },
    async ({ title, space }) => ({
      content: [{ type: 'text', text: `created CONF page ${space}/PAGE-42 "${title}"` }],
    }),
  );
  return s;
});

serve(7982, () => {
  const s = new McpServer({ name: 'mock-jira', version: '0.1.0' });
  s.tool(
    'jira_create_epic',
    'Create a Jira epic with stories.',
    {
      summary: z.string().min(3),
      description: z.string(),
      stories: z.array(z.object({ summary: z.string().min(5) })),
    },
    async ({ summary, stories }) => ({
      content: [{ type: 'text', text: `created EPIC-7 "${summary}" with ${stories.length} stories` }],
    }),
  );
  return s;
});
