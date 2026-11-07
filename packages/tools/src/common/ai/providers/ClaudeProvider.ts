import type { VisionAiRequest } from "../types.js";
import { parseImageData } from "../utils.js";
import {
  HttpVisionProvider,
  type HttpRequestSpec,
  type ModelsRequestSpec,
} from "./HttpVisionProvider.js";

type ClaudeContent =
  | string
  | Array<{
      type: string;
      text?: string;
      source?: { type: "base64"; media_type: string; data: string };
    }>;

interface ClaudeResponse {
  content?: Array<{ type?: string; text?: string }>;
}

interface ClaudeModelsResponse {
  data?: Array<{ id: string }>;
}

const MODELS_URL = "https://api.anthropic.com/v1/models";

export class ClaudeProvider extends HttpVisionProvider {
  protected get _keyLabel(): string {
    return "Anthropic Claude";
  }

  protected get _errorLabel(): string {
    return "Anthropic API Error";
  }

  protected get _fallbackModels(): string[] {
    return ["claude-opus-4-1", "claude-sonnet-5-5", "claude-haiku-5-5"];
  }

  protected _buildRequest(req: VisionAiRequest, apiKey: string): HttpRequestSpec {
    const url = this._config.endpoint?.trim() || "https://api.anthropic.com/v1/messages";
    const messages: Array<{ role: "user" | "assistant"; content: ClaudeContent }> = [];

    for (const m of req.messages) {
      if (m.role === "system") continue; // system instruction is a separate property
      const role = m.role as "user" | "assistant";
      if (m.imageBase64) {
        const { mimeType, data } = parseImageData(m.imageBase64);
        messages.push({
          role,
          content: [
            { type: "image", source: { type: "base64", media_type: mimeType, data } },
            { type: "text", text: m.content || "Analyze this image." },
          ],
        });
      } else {
        messages.push({ role, content: m.content });
      }
    }

    const body: Record<string, unknown> = {
      model: this._config.model || "claude-haiku-5-5",
      messages,
      max_tokens: req.maxTokens || 1024,
    };
    if (req.systemInstruction) {
      body["system"] = req.systemInstruction;
    }
    if (req.temperature !== undefined) {
      body["temperature"] = req.temperature;
    }

    return { url, headers: ClaudeProvider._headers(apiKey), body };
  }

  protected _parseResponse(data: unknown): string {
    return (data as ClaudeResponse).content?.find((c) => c.type === "text")?.text || "";
  }

  protected override _buildModelsRequest(apiKey: string): ModelsRequestSpec | null {
    if ("" === apiKey) {
      return null;
    }
    return { url: MODELS_URL, headers: ClaudeProvider._headers(apiKey) };
  }

  protected override _parseModels(data: unknown): string[] {
    return ((data as ClaudeModelsResponse).data ?? []).map((m) => m.id);
  }

  private static _headers(apiKey: string): Record<string, string> {
    return {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    };
  }
}
