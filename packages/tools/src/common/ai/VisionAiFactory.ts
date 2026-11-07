import type { AiConfig, AiProviderType, IVisionAiProvider } from "./types.js";
import { GeminiProvider } from "./providers/GeminiProvider.js";
import { OpenAiProvider } from "./providers/OpenAiProvider.js";
import { ClaudeProvider } from "./providers/ClaudeProvider.js";
import { OllamaProvider } from "./providers/OllamaProvider.js";

/** Local (Ollama) and custom OpenAI-compatible endpoints work without an API key. */
export function providerRequiresApiKey(provider: AiProviderType): boolean {
  return "ollama" !== provider && "custom" !== provider;
}

export function createVisionAiProvider(config: AiConfig): IVisionAiProvider {
  switch (config.provider) {
    case "gemini":
      return new GeminiProvider(config);
    case "openai":
      return new OpenAiProvider(config);
    case "custom":
      return new OpenAiProvider(config, false);
    case "claude":
      return new ClaudeProvider(config);
    case "ollama":
      return new OllamaProvider(config);
    default:
      return new GeminiProvider(config);
  }
}
