import type { LLMProvider, LLMMessage, LLMToolSchema, LLMResponse, LLMToolCall } from "./types.js";

interface OpenAIMessage {
  role: string;
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

export class OpenAIProvider implements LLMProvider {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async chat(
    messages: LLMMessage[],
    tools: LLMToolSchema[],
    model: string
  ): Promise<LLMResponse> {
    const openaiMessages = this.convertMessages(messages);
    const openaiTools = tools.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const body: Record<string, unknown> = {
      model,
      messages: openaiMessages,
    };

    if (openaiTools.length > 0) {
      body.tools = openaiTools;
    }

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI API error (${res.status}): ${errText}`);
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

  private convertMessages(messages: LLMMessage[]): OpenAIMessage[] {
    const result: OpenAIMessage[] = [];

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
          // malformed JSON from LLM
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
