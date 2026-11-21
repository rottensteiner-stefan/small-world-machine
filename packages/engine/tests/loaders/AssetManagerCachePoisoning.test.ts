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

  it("prevents stale pre-clear rejection from evicting a post-clear load and forwards AbortSignal (AR07/AR08)", async () => {
    const manager = new AssetManager();
    const url = "https://example.com/epoch.txt";

    let rejectFirst!: (err: Error) => void;
    const receivedSignals: (AbortSignal | undefined)[] = [];
    let call = 0;

    globalThis.fetch = vi.fn().mockImplementation((_u: string, init?: RequestInit) => {
      receivedSignals.push(init?.signal ?? undefined);
      call++;
      if (call === 1) {
        return new Promise((_res, rej) => {
          rejectFirst = rej;
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers(),
        body: null,
        blob: async (): Promise<Blob> => new Blob(["fresh"]),
      } as unknown as Response);
    });

    const controller = new AbortController();
    const first = manager.loadText(url, undefined, controller.signal);
    manager.clear();
    const second = manager.loadText(url);

    rejectFirst(new Error("stale failure"));
    await expect(first).rejects.toThrow("stale failure");
    expect(await second).toBe("fresh");
    // Post-clear entry must still be cached (a third call must NOT trigger a 3rd fetch).
    expect(await manager.loadText(url)).toBe("fresh");
    expect(call).toBe(2);
    expect(receivedSignals[0]).toBe(controller.signal);
  });

  it("delivers cached binary bytes to streamBinary onChunk even after loadBinary (LD04)", async () => {
    const manager = new AssetManager();
    const url = "https://example.com/shared.bin";
    const payload = new Uint8Array([7, 8, 9, 10]);

    let fetches = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      fetches++;
      return {
        ok: true,
        status: 200,
        headers: new Headers({ "content-length": "4" }),
        body: null,
        blob: async (): Promise<Blob> => new Blob([payload]),
      } as unknown as Response;
    });

    await manager.loadBinary(url);

    const chunks: Uint8Array[] = [];
    const streamed = await manager.streamBinary(url, (chunk) => chunks.push(chunk));
    expect(fetches).toBe(1);
    expect(chunks).toHaveLength(1);
    expect(Array.from(chunks[0]!)).toEqual([7, 8, 9, 10]);
    expect(Array.from(new Uint8Array(streamed))).toEqual([7, 8, 9, 10]);
  });
});
