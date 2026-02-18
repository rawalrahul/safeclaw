// ─── Provider Types ──────────────────────────────────────────

export type ProviderName = "anthropic" | "openai" | "gemini" | "ollama";

export const PROVIDER_NAMES: ProviderName[] = ["anthropic", "openai", "gemini", "ollama"];

export interface ApiKeyCredential {
  type: "api_key";
  key: string;
}

export type ProviderCredential = ApiKeyCredential;

export interface AuthStore {
  activeProvider: ProviderName | null;
  activeModel: string | null;
  providers: Partial<Record<ProviderName, ProviderCredential>>;
}

export const DEFAULT_AUTH_STORE: AuthStore = {
  activeProvider: null,
  activeModel: null,
  providers: {},
};

// ─── Model Defaults ──────────────────────────────────────────

export const DEFAULT_MODELS: Record<ProviderName, string> = {
  anthropic: "claude-sonnet-4-5-20250929",
  openai: "gpt-4o",
  gemini: "gemini-2.0-flash",
  ollama: "llama3.2",
};

// ─── LLM Message Types ──────────────────────────────────────

export interface LLMToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface LLMResponse {
  text: string | null;
  toolCalls: LLMToolCall[];
}

export interface LLMMessage {
  role: "system" | "user" | "assistant" | "tool_result";
  content: string;
  toolCallId?: string;
  toolName?: string;
}

export interface LLMToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LLMProvider {
  chat(
    messages: LLMMessage[],
    tools: LLMToolSchema[],
    model: string
  ): Promise<LLMResponse>;
}
