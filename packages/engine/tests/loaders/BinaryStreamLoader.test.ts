import { describe, it, expect, vi } from "vitest";
import { BinaryStreamLoader } from "../../src/loaders/index.js";

describe("BinaryStreamLoader & DirectStorage Web Streaming", () => {
  it("should stream binary chunks correctly", async () => {
    const chunk1 = new Uint8Array([1, 2, 3]);
    const chunk2 = new Uint8Array([4, 5, 6]);

    const mockStream = new ReadableStream({
      start(controller): void {
        controller.enqueue(chunk1);
        controller.enqueue(chunk2);
        controller.close();
      },
    });

    const mockResponse = {
      ok: true,
      status: 200,
      headers: {
        get: (name: string) => (name.toLowerCase() === "content-length" ? "6" : null),
      },
      body: mockStream,
    } as unknown as Response;

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    const receivedChunks: Uint8Array[] = [];
    const progressLog: number[] = [];

    const buffer = await BinaryStreamLoader.stream("https://example.com/asset.bin", {
      onChunk: (chunk) => receivedChunks.push(chunk),
      onProgress: (loaded, total) => progressLog.push(loaded / total),
    });

    expect(receivedChunks.length).toBe(2);
    expect(new Uint8Array(buffer)).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]));
    expect(progressLog).toContain(1.0);
  });
});
