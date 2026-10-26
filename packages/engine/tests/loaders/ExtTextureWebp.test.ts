import { describe, it, expect, vi, afterEach } from "vitest";
import "../../src/loaders/gltf/extensions/index.js";
import { GltfMaterialParser } from "../../src/loaders/gltf/GltfMaterialParser.js";
import { AssetManager } from "../../src/loaders/AssetManager.js";
import type { GltfJson } from "../../src/loaders/gltf/types.js";

describe("EXT_texture_webp", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves the WebP source when EXT_texture_webp is present on a texture", async () => {
    const assetManager = new AssetManager();
    const loadedUrls: string[] = [];

    vi.spyOn(assetManager, "loadImage").mockImplementation(async (url: string) => {
      loadedUrls.push(url);
      return { width: 16, height: 16 } as unknown as ImageBitmap;
    });

    const json: GltfJson = {
      asset: { version: "2.0" },
      extensionsUsed: ["EXT_texture_webp"],
      images: [
        { uri: "fallback.png" }, // 0: fallback png
        { uri: "texture.webp" }, // 1: webp texture
      ],
      textures: [
        {
          source: 0,
          extensions: {
            EXT_texture_webp: {
              source: 1,
            },
          },
        },
      ],
      materials: [
        {
          pbrMetallicRoughness: {
            baseColorTexture: { index: 0 },
          },
        },
      ],
    };

    const mat = await GltfMaterialParser.parseMaterial(
      json.materials![0]!,
      json,
      "models/",
      [],
      assetManager,
    );

    expect(mat.diffuseMap).toBeDefined();
    expect(loadedUrls).toEqual(["models/texture.webp"]);
  });

  it("falls back to standard image source when EXT_texture_webp is absent", async () => {
    const assetManager = new AssetManager();
    const loadedUrls: string[] = [];

    vi.spyOn(assetManager, "loadImage").mockImplementation(async (url: string) => {
      loadedUrls.push(url);
      return { width: 16, height: 16 } as unknown as ImageBitmap;
    });

    const json: GltfJson = {
      asset: { version: "2.0" },
      images: [{ uri: "fallback.png" }],
      textures: [
        {
          source: 0,
        },
      ],
      materials: [
        {
          pbrMetallicRoughness: {
            baseColorTexture: { index: 0 },
          },
        },
      ],
    };

    const mat = await GltfMaterialParser.parseMaterial(
      json.materials![0]!,
      json,
      "models/",
      [],
      assetManager,
    );

    expect(mat.diffuseMap).toBeDefined();
    expect(loadedUrls).toEqual(["models/fallback.png"]);
  });

  it("resolves a bufferView-backed WebP image in EXT_texture_webp", async () => {
    const assetManager = new AssetManager();
    const loadedBlobs: string[] = [];

    vi.spyOn(assetManager, "loadImage").mockImplementation(async (url: string) => {
      loadedBlobs.push(url);
      return { width: 16, height: 16 } as unknown as ImageBitmap;
    });

    const webpBytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00]);
    const json: GltfJson = {
      asset: { version: "2.0" },
      extensionsUsed: ["EXT_texture_webp"],
      images: [{ uri: "fallback.jpg" }, { bufferView: 0, mimeType: "image/webp" }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: webpBytes.byteLength }],
      textures: [
        {
          source: 0,
          extensions: {
            EXT_texture_webp: { source: 1 },
          },
        },
      ],
      materials: [
        {
          pbrMetallicRoughness: {
            baseColorTexture: { index: 0 },
          },
        },
      ],
    };

    const mat = await GltfMaterialParser.parseMaterial(
      json.materials![0]!,
      json,
      "models/",
      [webpBytes.buffer],
      assetManager,
    );

    expect(mat.diffuseMap).toBeDefined();
    expect(loadedBlobs).toHaveLength(1);
    expect(loadedBlobs[0]).toMatch(/^blob:/);
  });
});
