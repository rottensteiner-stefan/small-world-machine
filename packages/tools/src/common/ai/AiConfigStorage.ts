import type { AiConfig, AiProviderType } from "./types.js";

export const DEFAULT_AI_CONFIGS: Record<AiProviderType, AiConfig> = {
  gemini: {
    provider: "gemini",
    apiKey: "",
    model: "gemini-2.5-flash",
    endpoint: "",
  },
  openai: {
    provider: "openai",
    apiKey: "",
    model: "gpt-4o-mini",
    endpoint: "",
  },
  claude: {
    provider: "claude",
    apiKey: "",
    model: "claude-haiku-5-5",
    endpoint: "",
  },
  ollama: {
    provider: "ollama",
    apiKey: "",
    model: "llama3.2-vision",
    endpoint: "http://localhost:11434/api/chat",
  },
  custom: {
    provider: "custom",
    apiKey: "",
    model: "default",
    endpoint: "",
  },
};

const STORAGE_KEY = "smallworldmachine_ai_config";

function isProviderType(value: unknown): value is AiProviderType {
  return "string" === typeof value && Object.hasOwn(DEFAULT_AI_CONFIGS, value);
}

function optionalString(value: unknown): string | undefined {
  return "string" === typeof value ? value : undefined;
}

export class AiConfigStorage {
  public static load(): AiConfig {
    try {
      if (typeof localStorage !== "undefined") {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as Record<string, unknown> | null;
          const provider = parsed?.["provider"];
          if (!isProviderType(provider)) {
            return { ...DEFAULT_AI_CONFIGS.gemini };
          }
          const defaults = DEFAULT_AI_CONFIGS[provider];
          return {
            provider,
            apiKey: optionalString(parsed?.["apiKey"]) ?? defaults.apiKey,
            model: optionalString(parsed?.["model"]) || defaults.model,
            endpoint: optionalString(parsed?.["endpoint"]) ?? defaults.endpoint,
          };
        }
      }
    } catch {
      // Fallback
    }
    return { ...DEFAULT_AI_CONFIGS.gemini };
  }

  public static save(config: AiConfig): void {
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
      }
    } catch {
      // LocalStorage quota or access issue
    }
  }
}
