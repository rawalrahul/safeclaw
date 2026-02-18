import { join } from "node:path";
import { readJson, writeJson } from "../storage/persistence.js";
import type { AuthStore, ProviderCredential, ProviderName } from "./types.js";
import { DEFAULT_AUTH_STORE, PROVIDER_NAMES, DEFAULT_MODELS } from "./types.js";

export class ProviderStore {
  private filePath: string;
  private data: AuthStore = { ...DEFAULT_AUTH_STORE, providers: {} };

  constructor(storageDir: string) {
    this.filePath = join(storageDir, "auth.json");
  }

  async load(): Promise<void> {
    this.data = await readJson<AuthStore>(this.filePath, {
      ...DEFAULT_AUTH_STORE,
      providers: {},
    });
  }

  private async save(): Promise<void> {
    await writeJson(this.filePath, this.data);
  }

  async setCredential(provider: ProviderName, credential: ProviderCredential): Promise<void> {
    this.data.providers[provider] = credential;
    // Auto-set active provider if none set
    if (!this.data.activeProvider) {
      this.data.activeProvider = provider;
      this.data.activeModel = DEFAULT_MODELS[provider];
    }
    await this.save();
  }

  async removeCredential(provider: ProviderName): Promise<boolean> {
    if (!this.data.providers[provider]) return false;
    delete this.data.providers[provider];
    if (this.data.activeProvider === provider) {
      // Switch to another provider if available
      const remaining = Object.keys(this.data.providers) as ProviderName[];
      if (remaining.length > 0) {
        this.data.activeProvider = remaining[0];
        this.data.activeModel = DEFAULT_MODELS[remaining[0]];
      } else {
        this.data.activeProvider = null;
        this.data.activeModel = null;
      }
    }
    await this.save();
    return true;
  }

  async setActiveModel(provider: ProviderName, model: string): Promise<void> {
    this.data.activeProvider = provider;
    this.data.activeModel = model;
    await this.save();
  }

  getCredential(provider: ProviderName): ProviderCredential | undefined {
    return this.data.providers[provider];
  }

  getActiveProvider(): ProviderName | null {
    return this.data.activeProvider;
  }

  getActiveModel(): string | null {
    return this.data.activeModel;
  }

  hasProvider(provider: ProviderName): boolean {
    return !!this.data.providers[provider];
  }

  isValidProvider(name: string): name is ProviderName {
    return PROVIDER_NAMES.includes(name as ProviderName);
  }

  formatStatus(): string {
    const lines = ["Auth Status:"];
    const active = this.data.activeProvider;
    const model = this.data.activeModel;

    if (!active) {
      lines.push("  No provider configured.");
      lines.push("  Use /auth <provider> <api-key> to set up.");
      return lines.join("\n");
    }

    lines.push(`  Active: ${active} / ${model}`);
    lines.push("");
    lines.push("  Providers:");
    for (const name of PROVIDER_NAMES) {
      const cred = this.data.providers[name];
      if (cred) {
        // Ollama stores a URL, not a secret — display it as-is
        const display =
          name === "ollama"
            ? cred.key
            : cred.key.slice(0, 8) + "..." + cred.key.slice(-4);
        const marker = name === active ? " (active)" : "";
        lines.push(`    ${name}: ${display}${marker}`);
      } else {
        lines.push(`    ${name}: not configured`);
      }
    }
    return lines.join("\n");
  }
}
