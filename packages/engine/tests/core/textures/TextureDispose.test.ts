import { describe, expect, it, vi } from "vitest";
import type { AssetManager } from "../../../src/loaders/AssetManager.js";
import { Texture } from "../../../src/core/textures/index.js";

describe("Texture.dispose", () => {
  it("shrinks a canvas backing store, drops the image and reads as not loaded", () => {
    const canvas = { width: 256, height: 128 } as HTMLCanvasElement;
    vi.stubGlobal("HTMLCanvasElement", class {});
    Object.setPrototypeOf(
      canvas,
      (globalThis as { HTMLCanvasElement: { prototype: object } }).HTMLCanvasElement.prototype,
    );

    const texture = Texture.fromCanvas(canvas);
    expect(texture.isLoaded).toBe(true);

    texture.dispose();

    expect(canvas.width).toBe(0);
    expect(canvas.height).toBe(0);
    expect(texture.image).toBeUndefined();
    expect(texture.isLoaded).toBe(false);
    vi.unstubAllGlobals();
  });

  it("closes an ImageBitmap", () => {
    const close = vi.fn();
    class FakeBitmap {
      public close = close;
    }
    vi.stubGlobal("ImageBitmap", FakeBitmap);

    const texture = Texture.fromImage(new FakeBitmap() as unknown as ImageBitmap);
    texture.dispose();

    expect(close).toHaveBeenCalledOnce();
    expect(texture.image).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("is safe on an empty texture and when called twice", () => {
    const texture = Texture.empty();
    texture.dispose();
    texture.dispose();
    expect(texture.isLoaded).toBe(false);
  });

  it("does not close a cached bitmap shared through an AssetManager (fromUrl)", async () => {
    const close = vi.fn();
    class FakeBitmap {
      public close = close;
    }
    vi.stubGlobal("ImageBitmap", FakeBitmap);
    const bitmap = new FakeBitmap();
    const assetManager = {
      loadImage: vi.fn().mockResolvedValue(bitmap),
    } as unknown as AssetManager;

    const a = await Texture.fromUrl("x.png", { assetManager });
    const b = await Texture.fromUrl("x.png", { assetManager });
    a.dispose();

    expect(close).not.toHaveBeenCalled();
    expect(b.image).toBe(bitmap);
    expect(b.isLoaded).toBe(true);
    vi.unstubAllGlobals();
  });
});
