import { describe, expect, it } from "vitest";
import { Texture } from "../../src/core/textures/Texture.js";

describe("Texture", () => {
  it("creates an empty texture that is not loaded", () => {
    const texture = Texture.empty();
    expect(texture.isLoaded).toBe(false);
    expect(texture.image).toBeUndefined();
    expect(texture.needsUpdate).toBe(false);
  });

  it("creates a loaded texture from an image/bitmap via fromImage", () => {
    const bitmap = {} as ImageBitmap;
    const texture = Texture.fromImage(bitmap);
    expect(texture.isLoaded).toBe(true);
    expect(texture.image).toBe(bitmap);
    expect(texture.needsUpdate).toBe(false);
  });

  it("creates a loaded texture backed by a canvas via fromCanvas", () => {
    const canvas = { width: 64, height: 64 } as HTMLCanvasElement;
    const texture = Texture.fromCanvas(canvas);
    expect(texture.isLoaded).toBe(true);
    expect(texture.image).toBe(canvas);
    expect(texture.needsUpdate).toBe(false);
  });

  it("allows flagging a canvas-backed texture for GPU re-upload", () => {
    const canvas = { width: 64, height: 64 } as HTMLCanvasElement;
    const texture = Texture.fromCanvas(canvas);
    texture.needsUpdate = true;
    expect(texture.needsUpdate).toBe(true);
  });

  it("defaults to flipY: true when loading fromUrl", async () => {
    const fakeAssetManager = {
      loadImage: async (_url: string, _onProgress?: unknown, flipY?: boolean) => {
        expect(flipY).toBe(true);
        return {} as ImageBitmap;
      },
    } as unknown as import("../../src/loaders/AssetManager.js").AssetManager;

    const tex = await Texture.fromUrl("dummy.png", { assetManager: fakeAssetManager });
    expect(tex.isLoaded).toBe(true);
  });

  it("respects explicit flipY: false when loading fromUrl", async () => {
    const fakeAssetManager = {
      loadImage: async (_url: string, _onProgress?: unknown, flipY?: boolean) => {
        expect(flipY).toBe(false);
        return {} as ImageBitmap;
      },
    } as unknown as import("../../src/loaders/AssetManager.js").AssetManager;

    const tex = await Texture.fromUrl("dummy.png", {
      assetManager: fakeAssetManager,
      flipY: false,
    });
    expect(tex.isLoaded).toBe(true);
  });

  it("applies flipY when requested on fromCanvas", () => {
    const canvas = { width: 64, height: 64 } as HTMLCanvasElement;
    const texture = Texture.fromCanvas(canvas, { flipY: true });
    expect(texture.repeat.y).toBe(-1);
    expect(texture.offset.y).toBe(1);
  });
});
