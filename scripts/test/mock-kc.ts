/**
 * Mock Knowledge Core MCP server on port 7979 (PRD §6.2 probe target, Amendment
 * §A9 test surface). Serves canned org_* responses over streamable HTTP so the
 * KC card flips to available, installs cleanly, and product checks can resolve
 * spine refs. Run: npx tsx scripts/test/mock-kc.ts
 */
import { createServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

const KNOWN_REFS = new Set([
  'auto-finance/payments',
  'auto-finance/origination',
  'deposits/savings',
  'corporate/treasury',
]);

function buildServer(): McpServer {
  const server = new McpServer({ name: 'mock-knowledge-core', version: '0.1.0' });
  server.tool('org_search', 'Search org knowledge.', { query: z.string() }, async ({ query }) => ({
    content: [{ type: 'text', text: `mock results for "${query}": [Axiom QBR doc], [Payments runbook]` }],
  }));
  server.tool('org_ask', 'Ask the org graph a question.', { question: z.string() }, async ({ question }) => ({
    content: [{ type: 'text', text: `mock answer to "${question}"` }],
  }));
  server.tool('org_get_entity', 'Resolve an lob/domain spine ref.', { ref: z.string() }, async ({ ref }) => {
    if (KNOWN_REFS.has(ref)) {
      return { content: [{ type: 'text', text: JSON.stringify({ ref, found: true, owner: 'mock-team' }) }] };
    }
    return { content: [{ type: 'text', text: JSON.stringify({ ref, found: false }) }] };
  });
  server.tool('org_traverse', 'Traverse relationships from an entity.', { from: z.string() }, async ({ from }) => ({
    content: [{ type: 'text', text: `${from} → depends-on → payments-gateway` }],
  }));
  server.tool('org_find_experts', 'Find experts for a topic.', { topic: z.string() }, async ({ topic }) => ({
    content: [{ type: 'text', text: `experts for ${topic}: J. Smith, A. Patel` }],
  }));
  server.tool('org_recent_activity', 'Recent org activity.', {}, async () => ({
    content: [{ type: 'text', text: 'mock: 3 Confluence edits, 2 Jira epics updated' }],
  }));
  return server;
}

const httpServer = createServer((req, res) => {
  if (!req.url?.startsWith('/mcp')) {
    res.writeHead(404).end();
    return;
  }
  // stateless mode: fresh server+transport per request
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = buildServer();
  void server.connect(transport).then(() => transport.handleRequest(req, res));
});

httpServer.listen(7979, '127.0.0.1', () => {
  console.log('mock Knowledge Core listening on http://127.0.0.1:7979/mcp');
});
