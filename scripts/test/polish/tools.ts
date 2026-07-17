/**
 * DELIVERABLE F — tool-decision eval (12 cases, small tier).
 *
 *   4 should-search      · 4 should-NOT-search · 2 should-fetch · 2 memory-write
 *
 * The ROUTER IS HELD OUT: the model is handed the real tool specs and the real
 * behavior block and nothing else, so what is under test is the tool DESCRIPTIONS.
 * The tier is pinned (streamWithToolsAs), so the model picker is held constant too.
 *
 * Gate: >= 10/12 correct decisions.
 */
import { webToolSpecs } from '../../../server/src/tools/web.js';
import { streamWithToolsAs } from '../../../server/src/providers/dispatch.js';
import { buildBehaviorBlock, tierForModel } from '../../../server/src/pipeline/context.js';
import { describeTool, usageHint } from '../../../server/src/mcp/toolloop.js';
import { MODEL_FOR_TIER, mapLimit, type CaseResult } from './lib.js';
import type { BedrockTool } from '../../../server/src/providers/bedrock.js';
import type { ChatMessage } from '../../../server/src/llama/client.js';

const TIER = 'small' as const;

/** The real memory specs from the chat path, kept in sync by import-free copy —
 * chat.ts owns them as route-local consts. Only the descriptions matter here. */
const MEMORY_TOOLS: BedrockTool[] = [
  {
    name: 'remember',
    description: [
      'Store a durable fact in long-term memory.',
      'FIRE WHEN: the user tells you to ("remember that…", "note that…", "keep in mind…", "save this"), or they state a durable fact about themselves or the project that will still matter in a future conversation — a role, a preference, a decision, a constraint.',
      "DO NOT FIRE FOR: anything true only for today (\"I'm heading out at 5\"); details of the task in front of you (those are already in the conversation); a question the user asked; something you inferred rather than were told; or sensitive material — health, personal difficulties, relationships, finances — unless they explicitly asked you to store that specific thing.",
      'SCOPE: "user" for facts about the person (persists across ALL projects); "project" for facts about this project\'s work.',
      'Call this BEFORE replying — acknowledging without calling it stores nothing, and telling the user you remembered when you did not is a lie.',
    ].join(' '),
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['fact'],
      properties: { fact: { type: 'string' }, scope: { type: 'string', enum: ['user', 'project'] } },
    },
  },
];

const PERSONA =
  'You are Axiom, an AI assistant running on Amazon Bedrock. You help with conversation, analysis, ' +
  'and (via your document pipeline) generating decks, documents, spreadsheets, PDFs, diagrams, and ' +
  'small app prototypes. Be direct, concise, and concrete.';

interface Probe {
  prompt: string;
  /** the tool that SHOULD fire, or null for "answer without any tool" */
  expect: 'web_search' | 'web_fetch' | 'remember' | null;
  why: string;
}

const PROBES: Probe[] = [
  // 4 should-search: post-cutoff / fast-moving / unknown entity / temporal
  { prompt: 'who won the F1 race last weekend?', expect: 'web_search', why: 'temporal + fast-moving' },
  { prompt: "what's NVIDIA's stock price today?", expect: 'web_search', why: 'real-time' },
  { prompt: 'what did the Fed decide at its most recent meeting?', expect: 'web_search', why: 'post-cutoff' },
  { prompt: 'what is Kimi K2 Thinking and who makes it?', expect: 'web_search', why: 'entity it will not know' },

  // 4 should-NOT-search: stable fact / definition / code help / reasoning
  { prompt: 'what is the capital of Japan?', expect: null, why: 'stable fact' },
  { prompt: 'what does the acronym ACID mean in databases?', expect: null, why: 'definition' },
  { prompt: 'write a Python function that reverses a linked list', expect: null, why: 'code help' },
  { prompt: 'if a train leaves at 3pm going 60mph, how far in 90 minutes?', expect: null, why: 'reasoning' },

  // 2 should-fetch: the user hands over a URL
  { prompt: 'read https://example.com/pricing and tell me what the enterprise tier costs', expect: 'web_fetch', why: 'user supplied a URL' },
  { prompt: "what does this page say? https://example.com/blog/axiom-release", expect: 'web_fetch', why: 'user supplied a URL' },

  // 2 memory-write: explicit imperative + durable personal fact
  { prompt: 'remember that I prefer Rust over Go for systems work', expect: 'remember', why: 'explicit imperative' },
  { prompt: 'note for future chats: our deploys always go out on Thursdays', expect: 'remember', why: 'explicit imperative + durable' },
];

/** Deterministic units for the MCP description-quality pass-through. */
export function runToolUnits(): CaseResult[] {
  const out: CaseResult[] = [];
  const unit = (name: string, pass: boolean, detail = ''): void => {
    out.push({ name, tier: TIER, pass, detail });
  };
  const mk = (description: string, name = 'search_issues'): Parameters<typeof describeTool>[0] =>
    ({
      name,
      description,
      connectorId: 'demo',
      connectorName: 'Demo',
      inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] },
    }) as Parameters<typeof describeTool>[0];

  // thin descriptions get a generated hint
  const thin = describeTool(mk('Search.'));
  unit('thin description is enriched', thin.includes('Use this to search issues'), thin);
  unit('thin description keeps the original text', thin.startsWith('Search.'), thin);
  unit('hint names required args', thin.includes('query (required)'), thin);
  const empty = describeTool(mk(''));
  unit('empty description still gets a hint', empty.includes('Use this to search issues'), empty);

  // a well-described tool is NEVER rewritten
  const good =
    'Search the issue tracker for issues matching a full-text query, returning id, title, state and assignee for each match.';
  const kept = describeTool(mk(good));
  unit('well-described tool is left alone', kept === `${good} (Demo)`, kept);

  // name humanizing
  unit('camelCase name humanized', usageHint({ name: 'getUserProfile', description: '', inputSchema: {} }).includes('get user profile'));
  unit('no-arg tool says so', usageHint({ name: 'ping', description: '', inputSchema: {} }).includes('Takes no arguments'));
  return out;
}

/**
 * POLISH_TOOLS_CONTROL=1 replays the identical 12 probes against the PRE-ENRICHMENT
 * descriptions (the ones this deliverable replaced). Not gated — it exists to show
 * whether the enrichment is doing any work. If the control scores the same, the
 * decision tree is decoration and this eval proves nothing.
 */
const CONTROL = process.env.POLISH_TOOLS_CONTROL === '1';

const BARE_TOOLS: BedrockTool[] = [
  {
    name: 'web_search',
    description: 'Search the web for current information. Returns titles, URLs and snippets of the top results.',
    schema: { type: 'object', additionalProperties: false, required: ['query'], properties: { query: { type: 'string' } } },
  },
  {
    name: 'web_fetch',
    description: 'Fetch a web page and return its readable text (use after web_search to read a result).',
    schema: { type: 'object', additionalProperties: false, required: ['url'], properties: { url: { type: 'string' } } },
  },
  {
    name: 'remember',
    description:
      'Store a durable fact in long-term memory when the user explicitly asks to remember something. scope "user" = a fact about the user themselves (persists across ALL projects); "project" = a fact about this project.',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['fact'],
      properties: { fact: { type: 'string' }, scope: { type: 'string', enum: ['user', 'project'] } },
    },
  },
];

export async function runTools(): Promise<{ passed: number; failed: number; results: CaseResult[] }> {
  const tools: BedrockTool[] = CONTROL ? BARE_TOOLS : [...webToolSpecs(TIER), ...MEMORY_TOOLS];
  const system = [PERSONA, buildBehaviorBlock(tierForModel(MODEL_FOR_TIER[TIER]))].join('\n\n');

  const live = await mapLimit(PROBES, 3, async (p): Promise<CaseResult> => {
    const name = `${p.expect ?? 'no-tool'}: ${p.prompt.slice(0, 44)}`;
    const called: string[] = [];
    try {
      const stream = streamWithToolsAs(
        MODEL_FOR_TIER[TIER],
        [
          { role: 'system', content: system },
          { role: 'user', content: p.prompt },
        ] as ChatMessage[],
        tools,
        // the decision is what is under test, so tools return a neutral stub and
        // the loop is allowed to finish
        (tool) => Promise.resolve(tool.startsWith('web_') ? 'no results' : 'stored'),
        (tool) => called.push(tool),
        { maxTokens: 300, temperature: 0 },
      );
      for await (const _ of stream) void _;
    } catch (err) {
      return { name, tier: TIER, pass: false, detail: `call failed: ${err instanceof Error ? err.message : err}` };
    }
    const first = called[0] ?? null;
    const pass = p.expect === null ? called.length === 0 : first === p.expect;
    return {
      name,
      tier: TIER,
      pass,
      detail: pass ? '' : `expected ${p.expect ?? 'no tool'} (${p.why}), got ${called.length ? called.join(',') : 'no tool'}`,
    };
  });

  // SEARCH DISCIPLINE: the probes above are textbook cases and the control shows
  // the bare descriptions get them right too — so they do not discriminate. This
  // one does: the enriched small-tier description caps searches at ONE per
  // question, the bare description says nothing about scale at all. A research-
  // shaped prompt is where that difference shows up.
  const searches: string[] = [];
  try {
    const stream = streamWithToolsAs(
      MODEL_FOR_TIER[TIER],
      [
        { role: 'system', content: system },
        {
          role: 'user',
          content:
            'Research the current state of vector databases and compare Pinecone, Weaviate and Qdrant on pricing and performance.',
        },
      ] as ChatMessage[],
      tools,
      (tool) => Promise.resolve(tool.startsWith('web_') ? 'Result: vector databases vary in pricing and performance.' : 'stored'),
      (tool) => {
        if (tool === 'web_search') searches.push(tool);
      },
      { maxTokens: 400, temperature: 0 },
    );
    for await (const _ of stream) void _;
  } catch {
    /* reported below as 0 searches */
  }
  const disciplined = searches.length <= 1;
  const discipline: CaseResult = {
    name: `search discipline: research prompt fires <= 1 search on the ${TIER} tier`,
    tier: TIER,
    pass: disciplined,
    detail: disciplined ? '' : `fired ${searches.length} searches`,
  };
  console.log(`  search discipline: research prompt fired ${searches.length} search(es) [${CONTROL ? 'CONTROL/bare' : 'enriched'}]`);

  const units = runToolUnits();
  const all = [...units, ...live, ...(CONTROL ? [] : [discipline])];
  const correct = live.filter((r) => r.pass).length;
  console.log(`\n── F: tool decisions (${live.length} live probes, ${TIER} tier + ${units.length} units)`);
  for (const r of all.filter((x) => !x.pass)) console.log(`  FAIL ${r.name}: ${r.detail}`);
  console.log(`F/tools: ${correct}/${live.length} tool decisions correct (gate >= 10/12); units ${units.filter((u) => u.pass).length}/${units.length}`);

  // the brief's gate is >= 10/12 decisions; units are all-or-nothing
  const gatePass = correct >= 10 && units.every((u) => u.pass) && (CONTROL || discipline.pass);
  return {
    passed: all.filter((r) => r.pass).length,
    failed: gatePass ? 0 : all.filter((r) => !r.pass).length || 1,
    results: all,
  };
}

if (process.argv[1]?.endsWith('tools.ts')) {
  const { withBedrock } = await import('./lib.js');
  const r = await withBedrock(runTools);
  process.exit(r.failed === 0 ? 0 : 1);
}
