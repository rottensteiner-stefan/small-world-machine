import type { VisionAiRequest } from "../types.js";
import { parseImageData } from "../utils.js";
import {
  HttpVisionProvider,
  type HttpRequestSpec,
  type ModelsRequestSpec,
} from "./HttpVisionProvider.js";

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

interface GeminiModelsResponse {
  models?: Array<{ name: string; supportedGenerationMethods?: string[] }>;
}

export class GeminiProvider extends HttpVisionProvider {
  protected get _keyLabel(): string {
    return "Gemini";
  }

  protected get _errorLabel(): string {
    return "Gemini API Error";
  }

  protected get _fallbackModels(): string[] {
    return ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash", "gemini-1.5-flash"];
  }

  protected _buildRequest(req: VisionAiRequest, apiKey: string): HttpRequestSpec {
    const model = this._config.model || "gemini-2.5-flash";
    const url = this._config.endpoint?.trim() || `${GEMINI_BASE_URL}/${model}:generateContent`;

    const contents = req.messages.map((m) => {
      const parts: Array<{ text?: string; inline_data?: { mime_type: string; data: string } }> = [];
      if (m.imageBase64) {
        const { mimeType, data } = parseImageData(m.imageBase64);
        parts.push({ inline_data: { mime_type: mimeType, data } });
      }
      if (m.content) {
        parts.push({ text: m.content });
      }
      return { role: m.role === "assistant" ? "model" : "user", parts };
    });

    const body: Record<string, unknown> = { contents };
    if (req.systemInstruction) {
      body["systemInstruction"] = { parts: [{ text: req.systemInstruction }] };
    }
    if (req.temperature !== undefined || req.maxTokens !== undefined) {
      body["generationConfig"] = {
        temperature: req.temperature,
        maxOutputTokens: req.maxTokens,
      };
    }

    return { url, headers: { "x-goog-api-key": apiKey }, body };
  }

  protected _parseResponse(data: unknown): string {
    const parsed = data as GeminiResponse;
    return parsed.candidates?.[0]?.content?.parts?.[0]?.text || "";
  }

  protected override _buildModelsRequest(apiKey: string): ModelsRequestSpec | null {
    if ("" === apiKey) {
      return null;
    }
    return { url: GEMINI_BASE_URL, headers: { "x-goog-api-key": apiKey } };
  }

  protected override _parseModels(data: unknown): string[] {
    const parsed = data as GeminiModelsResponse;
    return (parsed.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m) => m.name.replace(/^models\//, ""))
      .filter((name) => name.startsWith("gemini"));
  }
}
