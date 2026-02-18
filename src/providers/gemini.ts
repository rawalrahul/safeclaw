import type { LLMProvider, LLMMessage, LLMToolSchema, LLMResponse, LLMToolCall } from "./types.js";

// ─── Gemini REST API types ────────────────────────────────────

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

const BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

export class GeminiProvider implements LLMProvider {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async chat(
    messages: LLMMessage[],
    tools: LLMToolSchema[],
    model: string
  ): Promise<LLMResponse> {
    const systemMsg = messages.find((m) => m.role === "system");
    const contents = this.convertMessages(messages.filter((m) => m.role !== "system"));

    const body: Record<string, unknown> = {
      contents,
      generationConfig: { maxOutputTokens: 4096 },
    };

    if (systemMsg) {
      body.systemInstruction = { parts: [{ text: systemMsg.content }] };
    }

    if (tools.length > 0) {
      body.tools = [
        {
          functionDeclarations: tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
        },
      ];
    }

    const url = `${BASE_URL}/models/${model}:generateContent?key=${this.apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API error (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as {
      candidates?: Array<{
        content?: { role: string; parts: GeminiPart[] };
      }>;
    };

    const parts = data.candidates?.[0]?.content?.parts ?? [];
    return this.parseResponse(parts);
  }

  /**
   * Convert SafeClaw's internal message format to Gemini's contents array.
   *
   * Gemini rules:
   * - Turns must strictly alternate user / model.
   * - A model turn with a functionCall must be immediately followed by a user
   *   turn containing a matching functionResponse.
   * - Both text and functionCall parts can coexist in the same turn.
   *
   * Strategy for tool_result messages:
   * - If the previous turn is already a model turn, append the functionCall to
   *   it (handles the case where the LLM returned text + tool call together).
   * - Otherwise inject a new model turn with just the functionCall.
   * - Then push a user turn with the functionResponse.
   */
  private convertMessages(messages: LLMMessage[]): GeminiContent[] {
    const contents: GeminiContent[] = [];

    for (const msg of messages) {
      if (msg.role === "user") {
        const last = contents[contents.length - 1];
        if (last?.role === "user") {
          // Merge consecutive user turns (e.g. multiple functionResponses)
          last.parts.push({ text: msg.content });
        } else {
          contents.push({ role: "user", parts: [{ text: msg.content }] });
        }
      } else if (msg.role === "assistant") {
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          // Emit a model turn with text (optional) + functionCall parts
          const parts: GeminiPart[] = [];
          if (msg.content) parts.push({ text: msg.content });
          for (const tc of msg.toolCalls) {
            parts.push({ functionCall: { name: tc.name, args: tc.input } });
          }
          contents.push({ role: "model", parts });
        } else {
          const last = contents[contents.length - 1];
          if (last?.role === "model") {
            last.parts.push({ text: msg.content });
          } else {
            contents.push({ role: "model", parts: [{ text: msg.content }] });
          }
        }
      } else if (msg.role === "tool_result") {
        const fnName = msg.toolName ?? "tool";

        // The preceding model turn already has the functionCall part (stored on the
        // assistant message). Just emit the functionResponse as a user turn.
        const last = contents[contents.length - 1];
        if (last?.role === "user") {
          last.parts.push({
            functionResponse: { name: fnName, response: { output: msg.content } },
          });
        } else {
          contents.push({
            role: "user",
            parts: [{ functionResponse: { name: fnName, response: { output: msg.content } } }],
          });
        }
      }
    }

    return contents;
  }

  private parseResponse(parts: GeminiPart[]): LLMResponse {
    let text: string | null = null;
    const toolCalls: LLMToolCall[] = [];

    for (const part of parts) {
      if (part.text) {
        text = (text ?? "") + part.text;
      } else if (part.functionCall) {
        toolCalls.push({
          // Gemini doesn't return call IDs — generate a stable synthetic one
          id: `g-${part.functionCall.name}-${Date.now().toString(36)}`,
          name: part.functionCall.name,
          input: part.functionCall.args ?? {},
        });
      }
    }

    return { text, toolCalls };
  }
}
