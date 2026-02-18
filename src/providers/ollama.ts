import type { LLMProvider, LLMMessage, LLMToolSchema, LLMResponse, LLMToolCall } from "./types.js";

// Ollama exposes an OpenAI-compatible endpoint at /v1/chat/completions.
// Tool calling is supported for models that have been trained for it
// (e.g. llama3.1, llama3.2, mistral-nemo, qwen2.5, etc.).

interface OllamaMessage {
  role: string;
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

export const OLLAMA_LOCAL_URL = "http://localhost:11434";

/** Resolve "local" shorthand → real URL. */
export function resolveOllamaUrl(key: string): string {
  if (key === "local" || key === "") return OLLAMA_LOCAL_URL;
  return key.replace(/\/$/, "");
}

export class OllamaProvider implements LLMProvider {
  private baseUrl: string;

  constructor(keyOrUrl: string) {
    this.baseUrl = resolveOllamaUrl(keyOrUrl);
  }

  async chat(
    messages: LLMMessage[],
    tools: LLMToolSchema[],
    model: string
  ): Promise<LLMResponse> {
    const ollamaMessages = this.convertMessages(messages);

    const body: Record<string, unknown> = {
      model,
      messages: ollamaMessages,
      stream: false,
    };

    if (tools.length > 0) {
      body.tools = tools.map((t) => ({
        type: "function" as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new Error(
        `Cannot reach Ollama at ${this.baseUrl}. Is it running? (ollama serve)`
      );
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Ollama API error (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as {
      choices: Array<{
        message: {
          content: string | null;
          tool_calls?: Array<{
            id: string;
            function: { name: string; arguments: string };
          }>;
        };
      }>;
    };

    return this.parseResponse(data.choices[0]?.message);
  }

  private convertMessages(messages: LLMMessage[]): OllamaMessage[] {
    const result: OllamaMessage[] = [];

    for (const msg of messages) {
      if (msg.role === "user") {
        result.push({ role: "user", content: msg.content });
      } else if (msg.role === "assistant") {
        result.push({ role: "assistant", content: msg.content });
      } else if (msg.role === "tool_result") {
        result.push({
          role: "tool",
          content: msg.content,
          tool_call_id: msg.toolCallId,
        });
      }
    }

    return result;
  }

  private parseResponse(message?: {
    content: string | null;
    tool_calls?: Array<{
      id: string;
      function: { name: string; arguments: string };
    }>;
  }): LLMResponse {
    if (!message) return { text: null, toolCalls: [] };

    const toolCalls: LLMToolCall[] = [];
    if (message.tool_calls) {
      for (const tc of message.tool_calls) {
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(tc.function.arguments);
        } catch {
          // malformed JSON from model
        }
        toolCalls.push({
          id: tc.id,
          name: tc.function.name,
          input,
        });
      }
    }

    return { text: message.content, toolCalls };
  }
}
