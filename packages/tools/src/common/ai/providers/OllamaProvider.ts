import type { VisionAiRequest } from "../types.js";
import { parseImageData } from "../utils.js";
import {
  HttpVisionProvider,
  type HttpRequestSpec,
  type ModelsRequestSpec,
} from "./HttpVisionProvider.js";

const DEFAULT_CHAT_ENDPOINT = "http://localhost:11434/api/chat";

interface OllamaMessage {
  role: string;
  content: string;
  images?: string[];
}

interface OllamaResponse {
  message?: { content?: string };
}

interface OllamaTagsResponse {
  models?: Array<{ name: string }>;
}

export class OllamaProvider extends HttpVisionProvider {
  protected override get _requiresApiKey(): boolean {
    return false;
  }

  protected get _keyLabel(): string {
    return "Ollama";
  }

  protected get _errorLabel(): string {
    return "Ollama Error";
  }

  protected get _fallbackModels(): string[] {
    return ["llama3.3", "llama3.2-vision", "minicpm-v", "llava", "bakllava"];
  }

  protected _buildRequest(req: VisionAiRequest, _apiKey: string): HttpRequestSpec {
    const messages: OllamaMessage[] = [];

    if (req.systemInstruction) {
      messages.push({ role: "system", content: req.systemInstruction });
    }

    for (const m of req.messages) {
      const message: OllamaMessage = { role: m.role, content: m.content || "Analyze this image." };
      if (m.imageBase64) {
        message.images = [parseImageData(m.imageBase64).data];
      }
      messages.push(message);
    }

    const body: Record<string, unknown> = {
      model: this._config.model || "llama3.2-vision",
      messages,
      stream: false,
    };
    if (req.temperature !== undefined) {
      body["options"] = { temperature: req.temperature };
    }

    return { url: this._chatEndpoint(), headers: {}, body };
  }

  protected _parseResponse(data: unknown): string {
    return (data as OllamaResponse).message?.content || "";
  }

  protected override _buildModelsRequest(_apiKey: string): ModelsRequestSpec | null {
    return { url: this._chatEndpoint().replace(/\/api\/chat\/?$/, "/api/tags"), headers: {} };
  }

  protected override _parseModels(data: unknown): string[] {
    return ((data as OllamaTagsResponse).models ?? []).map((m) => m.name);
  }

  private _chatEndpoint(): string {
    return this._config.endpoint?.trim() || DEFAULT_CHAT_ENDPOINT;
  }
}
