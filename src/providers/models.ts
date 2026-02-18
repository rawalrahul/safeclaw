import type { ProviderName } from "./types.js";

export interface ModelInfo {
  id: string;         // The ID to pass to the API / /model command
  displayName?: string;
}

// ─── Anthropic ────────────────────────────────────────────────

async function fetchAnthropicModels(apiKey: string): Promise<ModelInfo[]> {
  const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = (await res.json()) as {
    data: Array<{ id: string; display_name?: string }>;
  };

  return data.data.map((m) => ({ id: m.id, displayName: m.display_name }));
}

// ─── OpenAI ───────────────────────────────────────────────────

function isOpenAIChatModel(id: string): boolean {
  const CHAT_PREFIXES = ["gpt-4", "gpt-3.5-turbo", "o1", "o3", "o4", "chatgpt-"];
  const EXCLUDE_SUFFIXES = ["-instruct", "-base"];
  if (!CHAT_PREFIXES.some((p) => id.startsWith(p))) return false;
  if (EXCLUDE_SUFFIXES.some((s) => id.endsWith(s))) return false;
  return true;
}

async function fetchOpenAIModels(apiKey: string): Promise<ModelInfo[]> {
  const res = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = (await res.json()) as { data: Array<{ id: string }> };

  return data.data
    .filter((m) => isOpenAIChatModel(m.id))
    .sort((a, b) => b.id.localeCompare(a.id)) // newest first
    .map((m) => ({ id: m.id }));
}

// ─── Gemini ───────────────────────────────────────────────────

async function fetchGeminiModels(apiKey: string): Promise<ModelInfo[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=100`
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = (await res.json()) as {
    models: Array<{
      name: string;          // "models/gemini-2.0-flash"
      displayName?: string;
      supportedGenerationMethods?: string[];
    }>;
  };

  return data.models
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => ({
      id: m.name.replace(/^models\//, ""), // strip "models/" prefix
      displayName: m.displayName,
    }));
}

// ─── Public API ───────────────────────────────────────────────

export async function fetchModels(
  provider: ProviderName,
  apiKey: string
): Promise<ModelInfo[]> {
  switch (provider) {
    case "anthropic":
      return fetchAnthropicModels(apiKey);
    case "openai":
      return fetchOpenAIModels(apiKey);
    case "gemini":
      return fetchGeminiModels(apiKey);
  }
}
