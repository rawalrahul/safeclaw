import { randomUUID } from "node:crypto";
import type { LLMProvider, LLMMessage, LLMToolSchema, LLMResponse, LLMToolCall } from "./types.js";

// Ollama native /api/chat endpoint.
// Supports tool-calling for models trained for it (qwen2.5, llama3.1, llama3.2, mistral-nemo).
// Key differences from OpenAI-compat /v1/chat/completions:
//   - Response field is `message` not `choices[0].message`
//   - tool_calls.function.arguments is a JS object (not a JSON string)
//   - tool_calls have no `id` field → we generate UUIDs locally

interface OllamaNativeMessage {
  role: string;
  content: string | null;
  tool_calls?: Array<{
    function: { name: string; arguments: Record<string, unknown> };
  }>;
}

interface OllamaNativeResponse {
  message?: {
    role: string;
    content: string | null;
    tool_calls?: Array<{
      function: { name: string; arguments: unknown };
    }>;
  };
  error?: string;
}

export const OLLAMA_LOCAL_URL = "http://localhost:11434";

/** Resolve "local" shorthand → real URL. */
export function resolveOllamaUrl(key: string): string {
  if (key === "local" || key === "") return OLLAMA_LOCAL_URL;
  return key.replace(/\/$/, "");
}

/**
 * Strip fields that small Ollama models commonly reject or mishandle.
 * Removes: additionalProperties, $ref, format, $schema.
 * Recurses into nested objects and arrays.
 */
export function normalizeSchemaForOllama(schema: Record<string, unknown>): Record<string, unknown> {
  if (!schema || typeof schema !== "object") return schema;

  const STRIPPED_KEYS = new Set(["additionalProperties", "$ref", "format", "$schema"]);
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(schema)) {
    if (STRIPPED_KEYS.has(key)) continue;

    if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        item && typeof item === "object"
          ? normalizeSchemaForOllama(item as Record<string, unknown>)
          : item
      );
    } else if (value && typeof value === "object") {
      result[key] = normalizeSchemaForOllama(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }

  return result;
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
          parameters: normalizeSchemaForOllama(t.parameters),
        },
      }));
    }

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error(
        `Cannot reach Ollama at ${this.baseUrl}. Is it running? (ollama serve)`
      );
    }

    if (!res.ok) {
      const errText = await res.text();
      // Some models (e.g. deepseek-r1) don't support tool calling.
      // Retry without tools so we still get a plain text response.
      if (
        res.status === 400 &&
        (errText.includes("does not support tools") || errText.includes("tool")) &&
        body.tools
      ) {
        delete body.tools;
        let retryRes: Response;
        try {
          retryRes = await fetch(`${this.baseUrl}/api/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
        } catch {
          throw new Error(`Cannot reach Ollama at ${this.baseUrl}. Is it running? (ollama serve)`);
        }
        if (!retryRes.ok) {
          const retryErr = await retryRes.text();
          throw new Error(`Ollama API error (${retryRes.status}): ${retryErr}`);
        }
        const retryData = (await retryRes.json()) as OllamaNativeResponse;
        const baseText = retryData.message?.content ?? null;
        const warning =
          `⚠️ Note: The model "${model}" does not support tool use. ` +
          `Tools are disabled for this response. ` +
          `Switch to a tool-capable model (e.g. /model ollama/llama3.1 or /model ollama/qwen2.5) to use browser, filesystem, and other tools.\n\n`;
        return { text: warning + (baseText ?? ""), toolCalls: [] };
      }
      throw new Error(`Ollama API error (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as OllamaNativeResponse;
    return this.parseResponse(data.message);
  }

  private convertMessages(messages: LLMMessage[]): OllamaNativeMessage[] {
    const result: OllamaNativeMessage[] = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        result.push({ role: "system", content: msg.content });
      } else if (msg.role === "user") {
        result.push({ role: "user", content: msg.content });
      } else if (msg.role === "assistant") {
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          result.push({
            role: "assistant",
            content: msg.content || null,
            tool_calls: msg.toolCalls.map((tc) => ({
              function: { name: tc.name, arguments: tc.input },
            })),
          });
        } else {
          result.push({ role: "assistant", content: msg.content });
        }
      } else if (msg.role === "tool_result") {
        // Native /api/chat uses role "tool" with just content (no tool_call_id needed)
        result.push({
          role: "tool",
          content: msg.content,
        });
      }
    }

    return result;
  }

  private parseResponse(message?: OllamaNativeResponse["message"]): LLMResponse {
    if (!message) return { text: null, toolCalls: [] };

    const toolCalls: LLMToolCall[] = [];
    if (message.tool_calls) {
      for (const tc of message.tool_calls) {
        let input: Record<string, unknown> = {};
        const args = tc.function.arguments;

        if (args && typeof args === "object" && !Array.isArray(args)) {
          // Native format: arguments is already an object
          input = args as Record<string, unknown>;
        } else if (typeof args === "string") {
          // Fallback: some models still return a JSON string
          try {
            const parsed = JSON.parse(args);
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              input = parsed as Record<string, unknown>;
            }
          } catch {
            // malformed — leave as empty object
          }
        }

        toolCalls.push({
          id: randomUUID(), // Ollama native has no ID on tool calls — generate one
          name: tc.function.name,
          input,
        });
      }
    }

    return { text: message.content, toolCalls };
  }
}
