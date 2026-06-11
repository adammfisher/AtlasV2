/**
 * §6.3 chat tool use: when the active project has enabled connectors, chat
 * completions carry the OpenAI-format tools array (Gemma function calling via
 * llama.cpp --jinja). tool_calls are executed through the MCP manager, results
 * appended, loop capped at 4 iterations, then the final answer streams.
 */
import { config } from '../config.js';
import { logTo } from '../log.js';
import { streamChat, type ChatMessage } from '../llama/client.js';
import { toolsForProject, callTool, type ChatTool } from './manager.js';

export interface ToolChip {
  tool: string;
  connector: string;
}

interface ToolCall {
  id?: string;
  function: { name: string; arguments: string };
}

interface LoopMessage {
  role: string;
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

function mangle(tool: ChatTool): string {
  return `${tool.connectorId.replace(/-/g, '_')}__${tool.name}`;
}

function openAiTools(tools: ChatTool[]): Array<Record<string, unknown>> {
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: mangle(t),
      description: `${t.description} (${t.connectorName})`,
      parameters: t.inputSchema,
    },
  }));
}

async function completeWithTools(
  messages: LoopMessage[],
  tools: Array<Record<string, unknown>>,
  signal: AbortSignal,
): Promise<{ content: string; toolCalls: ToolCall[] }> {
  const res = await fetch(`http://127.0.0.1:${config.llamaServer.chatPort}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      messages,
      tools,
      temperature: 0.4,
      top_p: 0.95,
      top_k: 64,
      max_tokens: 1024,
      chat_template_kwargs: { enable_thinking: false },
    }),
  });
  if (!res.ok) throw new Error(`llama-server responded ${res.status}`);
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | null; tool_calls?: ToolCall[] } }>;
  };
  const message = data.choices?.[0]?.message;
  return { content: message?.content ?? '', toolCalls: message?.tool_calls ?? [] };
}

/**
 * Runs the tool loop, invoking onChip for each executed call, then streams the
 * final answer. Yields content deltas exactly like streamChat.
 */
export async function* streamChatWithTools(
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  systemPrompt: string,
  projectId: string,
  signal: AbortSignal,
  onChip: (chip: ToolChip) => void,
): AsyncGenerator<string> {
  const tools = await toolsForProject(projectId);
  const byMangled = new Map(tools.map((t) => [mangle(t), t]));
  const messages: LoopMessage[] = [
    { role: 'system', content: systemPrompt },
    ...history.map((m) => ({ role: m.role, content: m.content })),
  ];

  let executedAny = false;
  if (tools.length > 0) {
    const oaTools = openAiTools(tools);
    for (let iteration = 0; iteration < 4; iteration++) {
      const { content, toolCalls } = await completeWithTools(messages, oaTools, signal);
      if (!toolCalls.length) {
        if (!executedAny && content) {
          // no tools wanted — first pass already produced the whole answer
          yield content;
          return;
        }
        break; // tools ran; regenerate the final answer as a stream below
      }
      messages.push({ role: 'assistant', content: content || null, tool_calls: toolCalls });
      for (const call of toolCalls) {
        const spec = byMangled.get(call.function.name);
        let result: string;
        if (!spec) {
          result = `unknown tool: ${call.function.name}`;
        } else {
          try {
            const args = call.function.arguments ? (JSON.parse(call.function.arguments) as Record<string, unknown>) : {};
            result = await callTool(spec.connectorId, projectId, spec.name, args);
            onChip({ tool: spec.name, connector: spec.connectorName });
            executedAny = true;
          } catch (err) {
            result = `tool error: ${err instanceof Error ? err.message : String(err)}`;
          }
        }
        messages.push({ role: 'tool', content: result, tool_call_id: call.id ?? call.function.name });
        logTo('mcp', `tool ${call.function.name} → ${result.slice(0, 120)}`);
      }
    }
  }

  // final answer streams; tool results sit in context, tools omitted so the
  // model can't keep calling past the iteration cap
  yield* streamChat(messages as ChatMessage[], { signal });
}
