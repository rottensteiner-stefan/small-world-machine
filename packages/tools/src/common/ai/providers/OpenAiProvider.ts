import type { AiConfig, VisionAiRequest } from "../types.js";
import { parseImageData } from "../utils.js";
import {
  HttpVisionProvider,
  type HttpRequestSpec,
  type ModelsRequestSpec,
} from "./HttpVisionProvider.js";

type OpenAiContent = string | Array<{ type: string; text?: string; image_url?: { url: string } }>;

interface OpenAiResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

interface OpenAiModelsResponse {
  data?: Array<{ id: string }>;
}

const RELEVANT_MODEL_PATTERN = /gpt-[345]|o[134]\b|vision|claude|llama|mistral|gemini/i;

/**
 * GPT-5 and the o-series are reasoning models: they take `max_completion_tokens` (they reject
 * `max_tokens`) and only the default temperature.
 */
const REASONING_MODEL_PATTERN = /^(gpt-5|o\d)/i;

/** OpenAI chat-completions wire format; also serves OpenAI-compatible endpoints that need no key. */
export class OpenAiProvider extends HttpVisionProvider {
  private readonly _keyRequired: boolean;

  constructor(config: AiConfig, requiresApiKey: boolean = true) {
    super(config);
    this._keyRequired = requiresApiKey;
  }

  protected override get _requiresApiKey(): boolean {
    return this._keyRequired;
  }

  protected get _keyLabel(): string {
    return "OpenAI";
  }

  protected get _errorLabel(): string {
    return "OpenAI API Error";
  }

  protected get _fallbackModels(): string[] {
    return ["gpt-5", "gpt-4.1", "gpt-4o", "gpt-4o-mini"];
  }

  protected _buildRequest(req: VisionAiRequest, apiKey: string): HttpRequestSpec {
    const url = this._config.endpoint?.trim() || "https://api.openai.com/v1/chat/completions";
    const messages: Array<{ role: string; content: OpenAiContent }> = [];

    if (req.systemInstruction) {
      messages.push({ role: "system", content: req.systemInstruction });
    }

    for (const m of req.messages) {
      if (m.imageBase64) {
        const { mimeType, data } = parseImageData(m.imageBase64);
        messages.push({
          role: m.role,
          content: [
            { type: "text", text: m.content || "Analyze this image." },
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${data}` } },
          ],
        });
      } else {
        messages.push({ role: m.role, content: m.content });
      }
    }

    const model = this._config.model || "gpt-4o-mini";
    const body: Record<string, unknown> = { model, messages };
    if (REASONING_MODEL_PATTERN.test(model)) {
      if (req.maxTokens !== undefined) body["max_completion_tokens"] = req.maxTokens;
    } else {
      if (req.temperature !== undefined) body["temperature"] = req.temperature;
      if (req.maxTokens !== undefined) body["max_tokens"] = req.maxTokens;
    }

    return { url, headers: OpenAiProvider._authHeaders(apiKey), body };
  }

  protected _parseResponse(data: unknown): string {
    return (data as OpenAiResponse).choices?.[0]?.message?.content || "";
  }

  protected override _buildModelsRequest(apiKey: string): ModelsRequestSpec | null {
    const endpoint = this._config.endpoint?.trim();
    const url = endpoint
      ? endpoint.replace(/\/chat\/completions\/?$/, "/models")
      : "https://api.openai.com/v1/models";
    return { url, headers: OpenAiProvider._authHeaders(apiKey) };
  }

  protected override _parseModels(data: unknown): string[] {
    return ((data as OpenAiModelsResponse).data ?? [])
      .map((m) => m.id)
      .filter((id) => RELEVANT_MODEL_PATTERN.test(id));
  }

  private static _authHeaders(apiKey: string): Record<string, string> {
    return "" === apiKey ? {} : { Authorization: `Bearer ${apiKey}` };
  }
}
