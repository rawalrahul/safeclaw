import type { LLMProvider, LLMMessage, LLMToolSchema, LLMResponse, LLMToolCall } from "./types.js";

interface AnthropicContent {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface AnthropicMessage {
  role: string;
  content: string | AnthropicContent[];
}

export class AnthropicProvider implements LLMProvider {
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
    const anthropicMessages = this.convertMessages(messages.filter((m) => m.role !== "system"));
    const anthropicTools = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));

    const body: Record<string, unknown> = {
      model,
      max_tokens: 4096,
      messages: anthropicMessages,
    };

    if (systemMsg) {
      body.system = systemMsg.content;
    }

    if (anthropicTools.length > 0) {
      body.tools = anthropicTools;
    }

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Anthropic API error (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as { content: AnthropicContent[] };
    return this.parseResponse(data.content);
  }

  private convertMessages(messages: LLMMessage[]): AnthropicMessage[] {
    const result: AnthropicMessage[] = [];

    for (const msg of messages) {
      if (msg.role === "user") {
        result.push({ role: "user", content: msg.content });
      } else if (msg.role === "assistant") {
        result.push({ role: "assistant", content: msg.content });
      } else if (msg.role === "tool_result") {
        // Tool results go as user messages with tool_result content blocks
        result.push({
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: msg.toolCallId,
              content: msg.content,
            } as unknown as AnthropicContent,
          ],
        });
      }
    }

    return result;
  }

  private parseResponse(content: AnthropicContent[]): LLMResponse {
    let text: string | null = null;
    const toolCalls: LLMToolCall[] = [];

    for (const block of content) {
      if (block.type === "text" && block.text) {
        text = (text || "") + block.text;
      } else if (block.type === "tool_use" && block.id && block.name) {
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: (block.input as Record<string, unknown>) || {},
        });
      }
    }

    return { text, toolCalls };
  }
}
