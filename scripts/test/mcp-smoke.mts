import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'node:path';

const repo = '/Users/adamfisher/DEVELOP/AtlasV2';
const dataDir = process.env.HOME + '/Library/Application Support/AtlasLocal';
const env = {
  AXIOM_PROJECT_ID: 'p1',
  AXIOM_DATA_DIR: dataDir,
  AXIOM_DB_PATH: path.join(dataDir, 'data/atlas.db'),
  PATH: process.env.PATH!,
};

for (const name of ['filesystem', 'memory', 'sqlite']) {
  const client = new Client({ name: 'smoke', version: '0' });
  await client.connect(new StdioClientTransport({
    command: path.join(repo, 'node_modules/.bin/tsx'),
    args: [path.join(repo, 'servers', `${name}.ts`)],
    env, cwd: dataDir,
  }));
  const tools = (await client.listTools()).tools.map((t) => t.name);
  let probe = '';
  if (name === 'filesystem') {
    await client.callTool({ name: 'fs_write', arguments: { path: 'hello.txt', content: 'Axiom Stage 4' } });
    probe = JSON.stringify((await client.callTool({ name: 'fs_list', arguments: { path: '.' } })).content);
  } else if (name === 'memory') {
    await client.callTool({ name: 'memory_upsert', arguments: { value: 'Axiom launch target is Q4 2026' } });
    probe = JSON.stringify((await client.callTool({ name: 'memory_search', arguments: { query: 'launch target' } })).content);
  } else {
    probe = JSON.stringify((await client.callTool({ name: 'sql_query', arguments: { sql: 'SELECT COUNT(*) AS n FROM conversations' } })).content);
  }
  console.log(name, '→', tools.join(','), '|', probe.slice(0, 120));
  await client.close();
}
