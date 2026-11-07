import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AssetManager } from "../../src/loaders/AssetManager.js";

describe("AssetManager Cache-Poisoning Prevention [BLK-L1]", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("evicts text cache on network error allowing subsequent retry", async () => {
    const manager = new AssetManager();
    const url = "https://example.com/data.txt";

    let attempts = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      attempts++;
      if (attempts === 1) {
        return {
          ok: false,
          status: 500,
          headers: new Headers(),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-length": "5" }),
        body: null,
        blob: async (): Promise<Blob> => new Blob(["hello"]),
      } as unknown as Response;
    });

    // First attempt should fail
    await expect(manager.loadText(url)).rejects.toThrow("HTTP error: 500");

    // Second attempt should re-fetch and succeed (not return cached rejected promise)
    const result = await manager.loadText(url);
    expect(result).toBe("hello");
    expect(attempts).toBe(2);
  });

  it("evicts json cache on network error allowing subsequent retry", async () => {
    const manager = new AssetManager();
    const url = "https://example.com/config.json";

    let attempts = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      attempts++;
      if (attempts === 1) {
        throw new Error("Network offline");
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        body: null,
        blob: async (): Promise<Blob> => new Blob([JSON.stringify({ version: "1.0" })]),
      } as unknown as Response;
    });

    // First attempt should fail
    await expect(manager.loadJson(url)).rejects.toThrow("Network offline");

    // Second attempt should re-fetch and succeed
    const json = await manager.loadJson(url);
    expect(json).toEqual({ version: "1.0" });
    expect(attempts).toBe(2);
  });

  it("evicts binary cache on network error allowing subsequent retry", async () => {
    const manager = new AssetManager();
    const url = "https://example.com/model.bin";

    let attempts = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      attempts++;
      if (attempts === 1) {
        return {
          ok: false,
          status: 404,
          headers: new Headers(),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        body: null,
        blob: async (): Promise<Blob> => new Blob([new Uint8Array([1, 2, 3])]),
      } as unknown as Response;
    });

    // First attempt should fail
    await expect(manager.loadBinary(url)).rejects.toThrow("HTTP error: 404");

    // Second attempt should re-fetch and succeed
    const buffer = await manager.loadBinary(url);
    expect(buffer.byteLength).toBe(3);
    expect(attempts).toBe(2);
  });

  it("evicts streamBinary cache on stream error and completes loader tracking [BLK-L2]", async () => {
    const manager = new AssetManager();
    const url = "https://example.com/stream.bin";

    let attempts = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      attempts++;
      if (attempts === 1) {
        return {
          ok: false,
          status: 502,
          headers: new Headers(),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-length": "4" }),
        body: null,
        arrayBuffer: async () => new Uint8Array([4, 3, 2, 1]).buffer,
      } as unknown as Response;
    });

    // First attempt should fail and not leave active loaders hanging
    await expect(manager.streamBinary(url)).rejects.toThrow("Stream error: 502");
    expect(manager.isLoaded).toBe(true); // Must not deadlock / stay false

    // Second attempt should re-stream and succeed
    const buffer = await manager.streamBinary(url);
    expect(buffer.byteLength).toBe(4);
    expect(attempts).toBe(2);
    expect(manager.isLoaded).toBe(true);
  });
});
