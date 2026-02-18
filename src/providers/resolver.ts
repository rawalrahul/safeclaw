import type { LLMProvider, ProviderName } from "./types.js";
import type { ProviderStore } from "./store.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAIProvider } from "./openai.js";
import { GeminiProvider } from "./gemini.js";

export interface ResolvedProvider {
  provider: LLMProvider;
  providerName: ProviderName;
  model: string;
}

export function resolveProvider(store: ProviderStore): ResolvedProvider | null {
  const providerName = store.getActiveProvider();
  if (!providerName) return null;

  const cred = store.getCredential(providerName);
  if (!cred) return null;

  const model = store.getActiveModel();
  if (!model) return null;

  let provider: LLMProvider;
  switch (providerName) {
    case "anthropic":
      provider = new AnthropicProvider(cred.key);
      break;
    case "openai":
      provider = new OpenAIProvider(cred.key);
      break;
    case "gemini":
      provider = new GeminiProvider(cred.key);
      break;
    default:
      return null;
  }

  return { provider, providerName, model };
}
