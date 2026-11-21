import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import {
  registerGltfExtension,
  Texture,
  CompressedTextureFormat,
} from "@small-world-machine/engine";
import { createKhrTextureBasisuPlugin, khrTextureBasisu } from "../src/basisu/KhrTextureBasisu.js";
import { BasisTranscoder } from "../src/basisu/BasisTranscoder.js";

const vendorDir = fileURLToPath(new URL("../vendor/basis/", import.meta.url));
const fixtureDir = fileURLToPath(new URL("./fixtures/ktx2/", import.meta.url));

function asArrayBuffer(source: Uint8Array<ArrayBufferLike>): ArrayBuffer {
  return source.buffer.slice(
    source.byteOffset,
    source.byteOffset + source.byteLength,
  ) as ArrayBuffer;
}

describe("KHR_texture_basisu", () => {
  beforeEach(() => {
    registerGltfExtension(khrTextureBasisu);
  });

  afterEach(() => {
    BasisTranscoder.setTranscodeHandler(null);
    BasisTranscoder.setConfig({});
  });

  it("handles missing basisu source index gracefully by returning null", async () => {
    const textureDef = {
      extensions: {
        KHR_texture_basisu: {
          source: 99, // out of bounds
        },
      },
    };

    const readCtx = { json: { images: [] }, state: new Map() };
    const res = await khrTextureBasisu.resolveTexture?.(textureDef, readCtx, "", [], {} as never);

    expect(res).toBeNull();
  });

  it("loads external URI images via assetManager.loadBinary [MAJ-09]", async () => {
    const mockTexture = Texture.empty();
    BasisTranscoder.setTranscodeHandler((_buffer, mimeType) => {
      expect(mimeType).toBe("image/ktx2");
      return mockTexture;
    });

    const textureDef = {
      extensions: {
        KHR_texture_basisu: {
          source: 0,
        },
      },
    };

    const readCtx = {
      json: {
        images: [{ uri: "textures/compressed.ktx2" }],
      },
      state: new Map(),
    };

    const fakePayload = new Uint8Array([1, 2, 3, 4]).buffer;
    const mockAssetManager = {
      loadBinary: async (url: string): Promise<ArrayBuffer> => {
        expect(url).toBe("https://assets.local/textures/compressed.ktx2");
        return fakePayload;
      },
    };

    const res = await khrTextureBasisu.resolveTexture?.(
      textureDef,
      readCtx,
      "https://assets.local/",
      [],
      mockAssetManager as never,
    );

    expect(res).toBe(mockTexture);
  });

  it("produces a GPU block-compressed Texture via the built-in transcoder default path", async () => {
    const wasmBinary = asArrayBuffer(readFileSync(vendorDir + "basis_transcoder.wasm"));
    BasisTranscoder.setConfig({ wasmBinary });
    BasisTranscoder.setTranscodeHandler(null);

    const ktx2 = asArrayBuffer(readFileSync(fixtureDir + "2d_etc1s.ktx2"));
    const texture = await BasisTranscoder.transcode(ktx2, "image/ktx2", { format: "etc2" });

    expect(texture.compressedImage).toBeDefined();
    expect(texture.compressedImage!.format).toBe(CompressedTextureFormat.ETC2_RGBA8);
    expect(texture.compressedImage!.width).toBe(40);
    expect(texture.compressedImage!.height).toBe(40);
    // Full mip chain is preserved -- level 0 of a 40x40 ETC2 texture is 10x10 blocks
    // × 16 bytes = 1600 bytes; each level is 25% smaller.
    expect(texture.compressedImage!.mipData).toHaveLength(6);
    expect(texture.compressedImage!.mipData[0]!.length).toBe(1600);
    expect(texture.isLoaded).toBe(true);
    expect(texture.image).toBeUndefined();
  });

  it("falls back to an uncompressed RGBA8 RawMipChain preserving all KTX2 mip levels (AS03)", async () => {
    const wasmBinary = asArrayBuffer(readFileSync(vendorDir + "basis_transcoder.wasm"));
    BasisTranscoder.setConfig({ wasmBinary });
    BasisTranscoder.setTranscodeHandler(null);

    const ktx2 = asArrayBuffer(readFileSync(fixtureDir + "2d_etc1s.ktx2"));
    const texture = await BasisTranscoder.transcode(ktx2, "image/ktx2", { format: "rgba8" });

    // RGBA8 output is not block-compressed -- full RGBA8 mip pyramid lives on rawMipChain.
    expect(texture.compressedImage).toBeUndefined();
    expect(texture.isLoaded).toBe(true);
    expect(texture.rawMipChain).toBeDefined();
    expect(texture.rawMipChain!.width).toBe(40);
    expect(texture.rawMipChain!.height).toBe(40);
    expect(texture.rawMipChain!.mipData).toHaveLength(6);
    expect(texture.rawMipChain!.mipData[0]!.length).toBe(40 * 40 * 4);
    expect(texture.rawMipChain!.mipData[1]!.length).toBe(20 * 20 * 4);
    expect(texture.rawMipChain!.mipData[5]!.length).toBe(1 * 1 * 4);
  });

  it("isolates per-instance BasisU plugins without leaking global static state (AS07)", async () => {
    const texA = Texture.empty();
    const texB = Texture.empty();
    const pluginA = createKhrTextureBasisuPlugin({ customHandler: () => texA });
    const pluginB = createKhrTextureBasisuPlugin({ customHandler: () => texB });

    const payload = new Uint8Array([1, 2, 3, 4]).buffer;
    const textureDef = { extensions: { KHR_texture_basisu: { source: 0 } } };
    const readCtx = {
      json: {
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 4 }],
        images: [{ bufferView: 0, mimeType: "image/ktx2" }],
      },
      state: new Map(),
    };

    const resA = await pluginA.resolveTexture?.(textureDef, readCtx, "", [payload], {} as never);
    const resB = await pluginB.resolveTexture?.(textureDef, readCtx, "", [payload], {} as never);
    expect(resA).toBe(texA);
    expect(resB).toBe(texB);
  });
});
