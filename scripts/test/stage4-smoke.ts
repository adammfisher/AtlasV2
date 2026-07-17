/**
 * §6.3 tool-reliability smoke set: 10 chat prompts, each expected to trigger a
 * specific tool on E4B. Gate: <7/10 correct ⇒ ship tool-use behind a "/tools"
 * prefix and record the decision in HANDOFF-4. Requires the dev server.
 */
const API = 'http://127.0.0.1:5175/api';

const CASES: Array<{ prompt: string; expect: string }> = [
  { prompt: 'list the files in this project', expect: 'fs_list' },
  { prompt: 'read the file roadmap.md and summarize it', expect: 'fs_read' },
  { prompt: 'create a file called standup.md containing three bullet points about today', expect: 'fs_write' },
  { prompt: 'search the project files for anything mentioning roadmap', expect: 'fs_search' },
  { prompt: 'remember this: our launch codename is Bluebird', expect: 'memory_upsert' },
  { prompt: 'what do you remember about our launch codename?', expect: 'memory_search' },
  { prompt: 'record the fact that Axiom depends on llama.cpp', expect: 'graph_add_fact' },
  { prompt: 'what does Axiom depend on, according to the knowledge graph?', expect: 'graph_query' },
  { prompt: 'what tables exist in the workspace database?', expect: 'sql_schema' },
  { prompt: 'run a sql query to count how many conversations are in the database', expect: 'sql_query' },
];

async function chat(prompt: string): Promise<{ tools: string[]; text: string }> {
  const conv = (await (
    await fetch(`${API}/conversations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: 'p1' }),
    })
  ).json()) as { id: string };
  const res = await fetch(`${API}/conversations/${conv.id}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: prompt }),
  });
  const body = await res.text();
  const tools: string[] = [];
  let text = '';
  for (const block of body.split('\n\n')) {
    const event = /^event: (\S+)/m.exec(block)?.[1];
    const dataRaw = /^data: (.*)$/m.exec(block)?.[1];
    if (!event || !dataRaw) continue;
    try {
      const data = JSON.parse(dataRaw) as Record<string, unknown>;
      if (event === 'tool') tools.push(data.tool as string);
      if (event === 'token') text += data.delta as string;
    } catch {
      // skip malformed frames
    }
  }
  return { tools, text };
}

let correct = 0;
for (const c of CASES) {
  const t0 = Date.now();
  try {
    const { tools, text } = await chat(c.prompt);
    const hit = tools.includes(c.expect);
    if (hit) correct++;
    console.log(
      `${hit ? '✓' : '✗'} [${Math.round((Date.now() - t0) / 1000)}s] "${c.prompt.slice(0, 48)}" → expected ${c.expect}, called [${tools.join(',') || 'none'}]${hit ? '' : ` | answer: ${text.slice(0, 80)}`}`,
    );
  } catch (err) {
    console.log(`✗ "${c.prompt.slice(0, 48)}" — ${err instanceof Error ? err.message : err}`);
  }
}
console.log(`TOOL RELIABILITY: ${correct}/10 ${correct >= 7 ? '— ship tool-use on by default' : '— gate to /tools prefix (PRD §6.3)'}`);
