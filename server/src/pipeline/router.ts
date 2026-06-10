import { completeJson } from '../llama/json.js';
import { logTo } from '../log.js';
import { isSkillId, type SkillId } from './skills.js';

export interface RouteResult {
  intent: 'chat' | 'create_doc' | 'edit_doc';
  skill: SkillId | null;
}

// PRD §4.1 system prompt verbatim + Amendment §A4.1 product line
const ROUTER_SYSTEM = `You are a routing classifier inside Atlas. Output ONLY a raw JSON object, no markdown.
Decide what the user's latest message asks for.
intents: chat (conversation/questions), create_doc (make a document/deck/sheet/pdf/diagram/site/component), edit_doc (modify the most recent generated artifact).
skills: pptx docx xlsx pdf md mermaid svg react site product, or null when intent is chat.
product: define a new product/concept, or evolve an existing product definition
If intent is edit_doc, skill is the skill of the artifact being edited.`;

const ROUTER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['intent', 'skill'],
  properties: {
    intent: { type: 'string', enum: ['chat', 'create_doc', 'edit_doc'] },
    skill: {
      type: 'string',
      enum: ['pptx', 'docx', 'xlsx', 'pdf', 'md', 'mermaid', 'svg', 'react', 'site', 'product', 'null'],
    },
  },
} as const;

function parseRoute(raw: string): RouteResult | null {
  try {
    const parsed = JSON.parse(raw) as { intent?: string; skill?: string };
    if (!parsed.intent || !['chat', 'create_doc', 'edit_doc'].includes(parsed.intent)) return null;
    const skill = parsed.skill && parsed.skill !== 'null' && isSkillId(parsed.skill) ? parsed.skill : null;
    return { intent: parsed.intent as RouteResult['intent'], skill };
  } catch {
    return null;
  }
}

/**
 * §4.1: classify the latest message given the last 3 turns. Schema-invalid
 * output (guarded even under constrained decoding): one retry, then chat.
 * edit_doc without an editable artifact in the conversation downgrades to
 * create_doc (caller passes hasEditableArtifact).
 */
export async function route(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  text: string,
  hasEditableArtifact: boolean,
): Promise<RouteResult> {
  const turns = history.slice(-6); // last 3 user/assistant exchanges
  const content = [
    ...turns.map((t) => `${t.role}: ${t.content.slice(0, 300)}`),
    `user (latest): ${text}`,
  ].join('\n');
  const messages = [
    { role: 'system' as const, content: ROUTER_SYSTEM },
    { role: 'user' as const, content },
  ];

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      // 192 not the PRD's 64: Gemma sometimes emits reasoning despite
      // enable_thinking:false, and finish=length before constrained output starts
      const raw = await completeJson(messages, ROUTER_SCHEMA as unknown as Record<string, unknown>, {
        temperature: 0.2,
        maxTokens: 192,
      });
      const parsed = parseRoute(raw);
      if (parsed) {
        if (parsed.intent === 'edit_doc' && !hasEditableArtifact) {
          return { intent: 'create_doc', skill: parsed.skill };
        }
        if (parsed.intent !== 'chat' && parsed.skill === null) {
          return { intent: 'chat', skill: null };
        }
        return parsed;
      }
      logTo('pipeline', `router attempt ${attempt + 1} schema-invalid: ${raw.slice(0, 120)}`);
    } catch (err) {
      logTo('pipeline', `router attempt ${attempt + 1} error: ${err instanceof Error ? err.message : err}`);
    }
  }
  return { intent: 'chat', skill: null };
}
