import type { AiConfig, IVisionAiProvider, VisionAiRequest, VisionAiResponse } from "../types.js";
import { sortModelsDescending } from "../utils.js";

export const AI_REQUEST_TIMEOUT_MS = 60_000;

export interface HttpRequestSpec {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export interface ModelsRequestSpec {
  url: string;
  headers: Record<string, string>;
}

/**
 * Shared scaffolding of the HTTP vision providers: key check, POST with timeout/abort,
 * error mapping, connection test and model listing with a static fallback.
 * Subclasses only describe their wire format.
 */
export abstract class HttpVisionProvider implements IVisionAiProvider {
  protected readonly _config: AiConfig;

  constructor(config: AiConfig) {
    this._config = config;
  }

  /** Name used in the missing-key message, e.g. "Gemini". */
  protected abstract get _keyLabel(): string;
  /** Prefix of HTTP error messages, e.g. "Gemini API Error". */
  protected abstract get _errorLabel(): string;
  protected abstract get _fallbackModels(): string[];

  protected abstract _buildRequest(req: VisionAiRequest, apiKey: string): HttpRequestSpec;
  protected abstract _parseResponse(data: unknown): string;

  protected get _requiresApiKey(): boolean {
    return true;
  }

  /** Returns null when models cannot be listed (e.g. no key), so the fallback list is used. */
  protected _buildModelsRequest(_apiKey: string): ModelsRequestSpec | null {
    return null;
  }

  protected _parseModels(_data: unknown): string[] {
    return [];
  }

  public async sendMessage(req: VisionAiRequest): Promise<VisionAiResponse> {
    const apiKey = this._config.apiKey?.trim() ?? "";
    if (this._requiresApiKey && "" === apiKey) {
      throw new Error(`${this._keyLabel} API Key is missing. Please configure it in settings.`);
    }

    const spec = this._buildRequest(req, apiKey);
    const res = await fetch(spec.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...spec.headers },
      body: JSON.stringify(spec.body),
      signal: HttpVisionProvider._withTimeout(req.signal),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`${this._errorLabel} (${res.status}): ${errText}`);
    }

    return { text: this._parseResponse(await res.json()) };
  }

  public async testConnection(): Promise<boolean> {
    const res = await this.sendMessage({
      messages: [{ role: "user", content: "Ping: Respond with 'OK' if you can read this." }],
      maxTokens: 10,
    });
    return res.text.length > 0;
  }

  public async listModels(): Promise<string[]> {
    const spec = this._buildModelsRequest(this._config.apiKey?.trim() ?? "");
    if (null !== spec) {
      try {
        const res = await fetch(spec.url, {
          headers: spec.headers,
          signal: HttpVisionProvider._withTimeout(undefined),
        });
        if (res.ok) {
          const models = this._parseModels(await res.json());
          if (models.length > 0) {
            return sortModelsDescending(models);
          }
        }
      } catch {
        // Network or parse failure: fall back to the static list
      }
    }
    return sortModelsDescending(this._fallbackModels);
  }

  private static _withTimeout(signal: AbortSignal | undefined): AbortSignal {
    const timeout = AbortSignal.timeout(AI_REQUEST_TIMEOUT_MS);
    return undefined === signal ? timeout : AbortSignal.any([signal, timeout]);
  }
}
