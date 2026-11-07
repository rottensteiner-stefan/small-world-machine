import { afterEach, describe, expect, it, vi } from "vitest";
import { AssetManager } from "../../src/loaders/AssetManager.js";

/** Fakes just enough DOM for the HTMLImageElement fallback and records canvas flips. */
function stubFallbackDom(): { flips: number[] } {
  const record = { flips: [] as number[] };
  class FakeImage {
    public crossOrigin = "";
    public naturalWidth = 2;
    public naturalHeight = 2;
    public onload: (() => void) | undefined;
    public onerror: (() => void) | undefined;
    public set src(_value: string) {
      queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal("Image", FakeImage);
  vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: () => undefined });
  vi.stubGlobal("createImageBitmap", () => Promise.reject(new Error("unavailable")));
  vi.stubGlobal("document", {
    createElement: (): unknown => ({
      width: 0,
      height: 0,
      getContext: (): unknown => ({
        translate: (): void => undefined,
        scale: (_x: number, y: number): void => {
          record.flips.push(y);
        },
        drawImage: (): void => undefined,
      }),
      toBlob: (callback: (blob: Blob | null) => void): void => callback(new Blob(["x"])),
    }),
  });
  vi.stubGlobal("console", { ...console, error: () => undefined });
  return record;
}

function manager(): AssetManager {
  const am = new AssetManager();
  am.customFetch = async (): Promise<Response> =>
    ({
      ok: true,
      status: 200,
      headers: new Headers(),
      body: null,
      blob: async (): Promise<Blob> => new Blob(["x"]),
    }) as unknown as Response;
  return am;
}

describe("AssetManager.loadImage HTMLImageElement fallback", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("flips vertically when flipY is true (default)", async () => {
    const record = stubFallbackDom();
    await manager().loadImage("a.png");
    expect(record.flips).toEqual([-1]);
  });

  it("leaves the image untouched when flipY is false", async () => {
    const record = stubFallbackDom();
    await manager().loadImage("a.png", undefined, false);
    expect(record.flips).toEqual([]);
  });

  it("rejects with an Error object, not a string, when the fallback fails", async () => {
    stubFallbackDom();
    class FailingImage {
      public onerror: (() => void) | undefined;
      public set src(_value: string) {
        queueMicrotask(() => this.onerror?.());
      }
    }
    vi.stubGlobal("Image", FailingImage);
    await expect(manager().loadImage("bad.png")).rejects.toBeInstanceOf(Error);
  });
});
