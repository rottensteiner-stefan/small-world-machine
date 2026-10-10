import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  parseImageData,
  sortModelsDescending,
  AiConfigStorage,
  createVisionAiProvider,
  GeminiProvider,
  OpenAiProvider,
  ClaudeProvider,
  OllamaProvider,
  AiConfig,
  AiProviderType,
  IVisionAiProvider,
} from "../../src/common/ai/index.js";

describe("Vision AI Multi-Provider System", () => {
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => mockStorage[key] || null,
      setItem: (key: string, value: string) => {
        mockStorage[key] = value;
      },
      removeItem: (key: string) => {
        delete mockStorage[key];
      },
      clear: () => {
        mockStorage = {};
      },
      length: 0,
      key: (_index: number) => null,
    } as Storage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sorts models descending by version across providers", () => {
    // Gemini models: 2.0 before 1.5, 1.5-pro vs 1.5-flash
    const geminiInput = [
      "gemini-1.5-flash",
      "gemini-2.0-flash",
      "gemini-1.5-pro",
      "gemini-1.0-pro",
    ];
    const geminiSorted = sortModelsDescending(geminiInput);
    expect(geminiSorted[0]).toBe("gemini-2.0-flash");
    expect(geminiSorted).toEqual([
      "gemini-2.0-flash",
      "gemini-1.5-flash",
      "gemini-1.5-pro",
      "gemini-1.0-pro",
    ]);

    // Claude models: 3.5 before 3.0, newer date before older date
    const claudeInput = [
      "claude-3-opus-20240229",
      "claude-3-5-sonnet-20241022",
      "claude-3-5-sonnet-20240620",
      "claude-3-haiku-20240307",
    ];
    const claudeSorted = sortModelsDescending(claudeInput);
    expect(claudeSorted).toEqual([
      "claude-3-5-sonnet-20241022",
      "claude-3-5-sonnet-20240620",
      "claude-3-haiku-20240307",
      "claude-3-opus-20240229",
    ]);

    // OpenAI models: 4.5 > 4o > 4-turbo > 3.5-turbo
    const openaiInput = [
      "gpt-3.5-turbo",
      "gpt-4o",
      "gpt-4-turbo",
      "gpt-4o-mini",
      "o1-mini",
      "o3-mini",
    ];
    const openaiSorted = sortModelsDescending(openaiInput);
    expect(openaiSorted).toEqual([
      "gpt-4o",
      "gpt-4o-mini",
      "gpt-4-turbo",
      "gpt-3.5-turbo",
      "o3-mini",
      "o1-mini",
    ]);

    // Ollama / Llama models: 3.3 > 3.2 > 3.1 > 3 > 2
    const llamaInput = ["llama2", "llama3.2", "llama3.3", "llama3.1", "llama3"];
    const llamaSorted = sortModelsDescending(llamaInput);
    expect(llamaSorted).toEqual(["llama3.3", "llama3.2", "llama3.1", "llama3", "llama2"]);
  });

  it("parses data URLs correctly", () => {
    const dataUrl = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
    const res = parseImageData(dataUrl);
    expect(res.mimeType).toBe("image/jpeg");
    expect(res.data).toBe("/9j/4AAQSkZJRg==");

    const rawBase64 = "iVBORw0KGgoAAAANSUhEUg==";
    const resRaw = parseImageData(rawBase64);
    expect(resRaw.mimeType).toBe("image/png");
    expect(resRaw.data).toBe(rawBase64);
  });

  it("stores and loads configuration in localStorage", () => {
    const config: AiConfig = {
      provider: "claude",
      apiKey: "sk-ant-test-12345",
      model: "claude-3-5-sonnet-20241022",
    };

    AiConfigStorage.save(config);
    const loaded = AiConfigStorage.load();
    expect(loaded.provider).toBe("claude");
    expect(loaded.apiKey).toBe("sk-ant-test-12345");
    expect(loaded.model).toBe("claude-3-5-sonnet-20241022");
  });

  it("creates the correct provider instances via factory", () => {
    const gemini = createVisionAiProvider({
      provider: "gemini",
      model: "gemini-1.5-flash",
      apiKey: "key",
    });
    expect(gemini).toBeInstanceOf(GeminiProvider);

    const openai = createVisionAiProvider({ provider: "openai", model: "gpt-4o", apiKey: "key" });
    expect(openai).toBeInstanceOf(OpenAiProvider);

    const claude = createVisionAiProvider({
      provider: "claude",
      model: "claude-3-5-haiku",
      apiKey: "key",
    });
    expect(claude).toBeInstanceOf(ClaudeProvider);

    const ollama = createVisionAiProvider({ provider: "ollama", model: "llama3.2-vision" });
    expect(ollama).toBeInstanceOf(OllamaProvider);
  });

  it("formats and executes Gemini requests correctly", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "Detected 4 frames with palette #ff0000" }] } }],
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const provider = new GeminiProvider({
      provider: "gemini",
      apiKey: "AIzaTestKey",
      model: "gemini-1.5-flash",
    });

    const res = await provider.sendMessage({
      messages: [
        { role: "user", content: "Analyze sprite", imageBase64: "data:image/png;base64,AAAA" },
      ],
      systemInstruction: "Game Dev Mode",
    });

    expect(res.text).toBe("Detected 4 frames with palette #ff0000");
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, options] = mockFetch.mock.calls[0]!;
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent",
    );
    expect(url).not.toContain("AIzaTestKey");
    expect(options.headers["x-goog-api-key"]).toBe("AIzaTestKey");
    const body = JSON.parse(options.body as string);
    expect(body.contents[0].parts[0].inline_data.data).toBe("AAAA");
    expect(body.systemInstruction.parts[0].text).toBe("Game Dev Mode");
  });

  it("formats and executes OpenAI requests correctly", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "PBR: Roughness 0.4, Metallic 0.0" } }],
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const provider = new OpenAiProvider({
      provider: "openai",
      apiKey: "sk-openai-test",
      model: "gpt-4o-mini",
    });

    const res = await provider.sendMessage({
      messages: [
        { role: "user", content: "Analyze material", imageBase64: "data:image/png;base64,BBBB" },
      ],
    });

    expect(res.text).toBe("PBR: Roughness 0.4, Metallic 0.0");
    const [_url, options] = mockFetch.mock.calls[0]!;
    expect(options.headers["Authorization"]).toBe("Bearer sk-openai-test");
    const body = JSON.parse(options.body as string);
    expect(body.model).toBe("gpt-4o-mini");
    expect(body.messages[0].content[1].image_url.url).toBe("data:image/png;base64,BBBB");
  });

  it.each([
    ["gpt-4o-mini", "max_tokens", true],
    ["gpt-5", "max_completion_tokens", false],
    ["o3-mini", "max_completion_tokens", false],
  ])("OpenAI model %s sends %s", async (model, tokenField, sendsTemperature) => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "ok" } }] }),
    });
    vi.stubGlobal("fetch", mockFetch);

    await new OpenAiProvider({ provider: "openai", apiKey: "k", model }).sendMessage({
      messages: [{ role: "user", content: "hi" }],
      maxTokens: 256,
      temperature: 0.2,
    });

    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string);
    expect(body[tokenField]).toBe(256);
    expect(Object.keys(body).filter((k) => k.startsWith("max_"))).toEqual([tokenField]);
    expect("temperature" in body).toBe(sendsTemperature);
  });

  it("formats and executes Claude requests with direct browser access headers", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: "Claude analyzed: 8 frames [SLICE: 8]" }],
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const provider = new ClaudeProvider({
      provider: "claude",
      apiKey: "sk-ant-test",
      model: "claude-3-5-haiku-20241022",
    });

    const res = await provider.sendMessage({
      messages: [{ role: "user", content: "Find frames", imageBase64: "CCCC" }],
      systemInstruction: "Sprite Expert",
    });

    expect(res.text).toBe("Claude analyzed: 8 frames [SLICE: 8]");
    const [_url, options] = mockFetch.mock.calls[0]!;
    expect(options.headers["x-api-key"]).toBe("sk-ant-test");
    expect(options.headers["anthropic-dangerous-direct-browser-access"]).toBe("true");
    const body = JSON.parse(options.body as string);
    expect(body.system).toBe("Sprite Expert");
  });

  it("formats and executes Local Ollama requests", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: { content: "Ollama local response" },
      }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const provider = new OllamaProvider({
      provider: "ollama",
      model: "llama3.2-vision",
      endpoint: "http://localhost:11434/api/chat",
    });

    const res = await provider.sendMessage({
      messages: [{ role: "user", content: "Check local image", imageBase64: "DDDD" }],
    });

    expect(res.text).toBe("Ollama local response");
    const [url, options] = mockFetch.mock.calls[0]!;
    expect(url).toBe("http://localhost:11434/api/chat");
    const body = JSON.parse(options.body as string);
    expect(body.messages[0].images[0]).toBe("DDDD");
  });

  it("lists models from providers dynamically sorted descending", async () => {
    // Gemini listModels
    const mockGeminiFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          { name: "models/gemini-1.5-flash", supportedGenerationMethods: ["generateContent"] },
          { name: "models/gemini-2.0-flash", supportedGenerationMethods: ["generateContent"] },
          { name: "models/embedding-001", supportedGenerationMethods: ["embedContent"] },
        ],
      }),
    });
    vi.stubGlobal("fetch", mockGeminiFetch);

    const gemini = new GeminiProvider({
      provider: "gemini",
      apiKey: "key",
      model: "gemini-1.5-flash",
    });
    const geminiModels = await gemini.listModels();
    expect(geminiModels).toEqual(["gemini-2.0-flash", "gemini-1.5-flash"]);

    // Ollama listModels
    const mockOllamaFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [{ name: "llama3.1:latest" }, { name: "llama3.2-vision:latest" }],
      }),
    });
    vi.stubGlobal("fetch", mockOllamaFetch);

    const ollama = new OllamaProvider({ provider: "ollama", model: "llama3.2-vision" });
    const ollamaModels = await ollama.listModels();
    expect(ollamaModels).toEqual(["llama3.2-vision:latest", "llama3.1:latest"]);
  });

  it("keeps the API key out of Gemini model-list URLs", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal("fetch", mockFetch);
    const gemini = new GeminiProvider({ provider: "gemini", apiKey: "secret", model: "m" });
    await gemini.listModels();
    const [url, options] = mockFetch.mock.calls[0]!;
    expect(url).not.toContain("secret");
    expect(options.headers["x-goog-api-key"]).toBe("secret");
  });

  describe("error paths", () => {
    const providers: Array<[string, () => IVisionAiProvider]> = [
      [
        "gemini",
        (): IVisionAiProvider =>
          new GeminiProvider({ provider: "gemini", apiKey: "k", model: "m" }),
      ],
      [
        "openai",
        (): IVisionAiProvider =>
          new OpenAiProvider({ provider: "openai", apiKey: "k", model: "m" }),
      ],
      [
        "claude",
        (): IVisionAiProvider =>
          new ClaudeProvider({ provider: "claude", apiKey: "k", model: "m" }),
      ],
      ["ollama", (): IVisionAiProvider => new OllamaProvider({ provider: "ollama", model: "m" })],
    ];
    const request = { messages: [{ role: "user" as const, content: "hi" }] };

    it.each(providers)("%s maps a non-ok response to an error with status", async (_n, make) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({ ok: false, status: 429, text: async () => "rate limited" }),
      );
      await expect(make().sendMessage(request)).rejects.toThrow(/\(429\): rate limited/);
    });

    it.each(providers)("%s propagates network failures", async (_n, make) => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
      await expect(make().sendMessage(request)).rejects.toThrow("Failed to fetch");
    });

    it.each(providers)("%s listModels falls back when the request fails", async (_n, make) => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
      const models = await make().listModels!();
      expect(models.length).toBeGreaterThan(0);
    });

    it.each(providers.filter(([name]) => name !== "ollama"))(
      "%s rejects a missing API key without calling fetch",
      async (name) => {
        const mockFetch = vi.fn();
        vi.stubGlobal("fetch", mockFetch);
        const provider = createVisionAiProvider({ provider: name as AiProviderType, model: "m" });
        await expect(provider.sendMessage(request)).rejects.toThrow(/API Key is missing/);
        expect(mockFetch).not.toHaveBeenCalled();
      },
    );

    it("custom OpenAI-compatible endpoints work without a key", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ choices: [{ message: { content: "pong" } }] }),
      });
      vi.stubGlobal("fetch", mockFetch);
      const provider = createVisionAiProvider({
        provider: "custom",
        model: "m",
        endpoint: "http://localhost:1234/v1/chat/completions",
      });
      await expect(provider.sendMessage(request)).resolves.toEqual({ text: "pong" });
      expect(mockFetch.mock.calls[0]![1].headers["Authorization"]).toBeUndefined();
    });

    it("passes a combined abort signal and honours caller cancellation", async () => {
      const mockFetch = vi.fn((_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        });
      });
      vi.stubGlobal("fetch", mockFetch);
      const controller = new AbortController();
      const pending = providers[3]![1]().sendMessage({ ...request, signal: controller.signal });
      controller.abort(new Error("cancelled"));
      await expect(pending).rejects.toThrow("cancelled");
    });
  });

  describe("AiConfigStorage validation", () => {
    it("ignores unknown providers and non-string fields", () => {
      localStorage.setItem(
        "smallworldmachine_ai_config",
        JSON.stringify({ provider: "evil", model: 5 }),
      );
      expect(AiConfigStorage.load().provider).toBe("gemini");

      localStorage.setItem(
        "smallworldmachine_ai_config",
        JSON.stringify({ provider: "claude", model: 5, apiKey: 7 }),
      );
      const loaded = AiConfigStorage.load();
      expect(loaded.provider).toBe("claude");
      expect(loaded.model).toBe("claude-haiku-5-5");
      expect(loaded.apiKey).toBe("");
    });

    it("falls back to defaults on corrupt JSON", () => {
      localStorage.setItem("smallworldmachine_ai_config", "{not json");
      expect(AiConfigStorage.load().provider).toBe("gemini");
    });
  });
});
