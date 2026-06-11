/**
 * Bedrock provider (PRD §8): Converse/ConverseStream via the default credential
 * chain with a profile from the connect modal. Connect = ListFoundationModels
 * success — failures surface the real AWS message, never fake success.
 * Structured outputs: json_schema response format only for Claude 4.5+ model
 * ids; everything older gets the forced tool-use fallback. Never combined with
 * citations.
 */
import { BedrockClient, ListFoundationModelsCommand } from '@aws-sdk/client-bedrock';
import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  type Message,
} from '@aws-sdk/client-bedrock-runtime';
import { fromIni } from '@aws-sdk/credential-providers';
import { getSetting, setSetting } from '../db/db.js';
import { logTo } from '../log.js';

export interface BedrockSettings {
  connected: boolean;
  region: string;
  profile: string;
  modelId: string;
}

const DEFAULT_MODEL = 'global.anthropic.claude-sonnet-4-5-20250929-v1:0';

export function bedrockSettings(): BedrockSettings {
  const raw = getSetting('bedrock');
  if (!raw) return { connected: false, region: 'us-east-1', profile: 'default', modelId: DEFAULT_MODEL };
  return JSON.parse(raw) as BedrockSettings;
}

function runtime(settings: BedrockSettings): BedrockRuntimeClient {
  return new BedrockRuntimeClient({
    region: settings.region,
    credentials: fromIni({ profile: settings.profile }),
  });
}

/** Connect = a real ListFoundationModels round-trip. Returns the Claude model ids found. */
export async function connectBedrock(region: string, profile: string): Promise<string[]> {
  const client = new BedrockClient({ region, credentials: fromIni({ profile }) });
  const out = await client.send(new ListFoundationModelsCommand({ byProvider: 'anthropic' }));
  const ids = (out.modelSummaries ?? []).map((m) => m.modelId ?? '').filter(Boolean);
  const preferred =
    ids.find((id) => /claude-sonnet-4-5/.test(id)) ??
    ids.find((id) => /claude-sonnet/.test(id)) ??
    ids[0] ??
    DEFAULT_MODEL;
  setSetting(
    'bedrock',
    JSON.stringify({ connected: true, region, profile, modelId: preferred.startsWith('anthropic.') ? `us.${preferred}` : preferred } satisfies BedrockSettings),
  );
  logTo('app', `bedrock connected: ${region}/${profile} → ${preferred} (${ids.length} anthropic models)`);
  return ids;
}

export function disconnectBedrock(): void {
  const s = bedrockSettings();
  setSetting('bedrock', JSON.stringify({ ...s, connected: false }));
}

/** Claude 4.5+ supports native json_schema response format on Converse. */
export function supportsJsonSchema(modelId: string): boolean {
  const m = /claude-(?:sonnet|opus|haiku)-(\d+)-(\d+)/.exec(modelId);
  if (!m) return false;
  const [, major, minor] = m;
  return Number(major) > 4 || (Number(major) === 4 && Number(minor) >= 5);
}

export interface BedrockJsonOptions {
  maxTokens?: number;
  signal?: AbortSignal;
}

/** Bedrock structured outputs accept a JSON Schema subset — strip what it
 * rejects (size constraints). ajv still validates the result against the FULL
 * schema afterward, so nothing is lost, only deferred to the repair loop. */
function sanitizeForBedrock(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitizeForBedrock);
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (['maxItems', 'minItems', 'maxLength', 'minLength', 'pattern'].includes(key)) continue;
      out[key] = sanitizeForBedrock(value);
    }
    return out;
  }
  return node;
}

/** Constrained JSON on Bedrock: json_schema for 4.5+, forced tool-use below. */
export async function bedrockJson(
  system: string,
  user: string,
  schema: Record<string, unknown>,
  opts: BedrockJsonOptions = {},
): Promise<string> {
  const settings = bedrockSettings();
  if (!settings.connected) throw new Error('Bedrock is not connected');
  const client = runtime(settings);
  const messages: Message[] = [{ role: 'user', content: [{ text: user }] }];

  if (supportsJsonSchema(settings.modelId)) {
    const out = await client.send(
      new ConverseCommand({
        modelId: settings.modelId,
        system: [{ text: system }],
        messages,
        inferenceConfig: { maxTokens: opts.maxTokens ?? 3072, temperature: 0.2 },
        // structured outputs — never combined with citations (PRD §8)
        outputConfig: {
          textFormat: {
            type: 'json_schema',
            structure: { jsonSchema: { name: 'payload', schema: JSON.stringify(sanitizeForBedrock(schema)) } },
          },
        },
      }),
      { abortSignal: opts.signal },
    );
    return out.output?.message?.content?.map((c) => c.text ?? '').join('') ?? '';
  }

  // forced tool-use fallback for pre-4.5 ids
  const out = await client.send(
    new ConverseCommand({
      modelId: settings.modelId,
      system: [{ text: system }],
      messages,
      inferenceConfig: { maxTokens: opts.maxTokens ?? 3072, temperature: 0.2 },
      toolConfig: {
        tools: [
          {
            toolSpec: {
              name: 'emit',
              description: 'Emit the document payload.',
              inputSchema: { json: sanitizeForBedrock(schema) as never },
            },
          },
        ],
        toolChoice: { tool: { name: 'emit' } },
      },
    }),
    { abortSignal: opts.signal },
  );
  const toolUse = out.output?.message?.content?.find((c) => c.toolUse)?.toolUse;
  return toolUse ? JSON.stringify(toolUse.input ?? {}) : '';
}

/** Streaming chat on Bedrock for when Claude is the selected model. */
export async function* bedrockStreamChat(
  system: string,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const settings = bedrockSettings();
  if (!settings.connected) throw new Error('Bedrock is not connected');
  const client = runtime(settings);
  const out = await client.send(
    new ConverseStreamCommand({
      modelId: settings.modelId,
      system: [{ text: system }],
      messages: history.map((m) => ({ role: m.role, content: [{ text: m.content }] })),
      inferenceConfig: { maxTokens: 2048, temperature: 0.7 },
    }),
    { abortSignal: signal },
  );
  for await (const event of out.stream ?? []) {
    const delta = event.contentBlockDelta?.delta?.text;
    if (delta) yield delta;
  }
}
