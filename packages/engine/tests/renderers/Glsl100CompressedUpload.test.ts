import { describe, expect, it, vi } from "vitest";
import { WebGLTextureManager } from "../../src/renderers/gl/managers/WebGLTextureManager.js";
import { Texture } from "../../src/core/textures/Texture.js";
import { CompressedTextureFormat } from "../../src/enums/CompressedTextureFormat.js";

// K01 (b): the WebGL1 `glsl100` upload path must consume `Texture.compressedImage` block data
// through its extension surface (S3TC / BPTC / ASTC / ETC2-when-present) instead of routing
// compressed-only KTX2/KHR_texture_basisu textures to the default placeholder -- the pre-K01 bug
// rendered KTX2 content as blank/white on WebGL1. The format choice is WebGL1-aware upstream
// (`detectBestBlockFormat`), so auto-decoded KTX2 never reaches this path with a format the
// context cannot consume; a manually fabricated payload with a missing extension fails loudly.
// Mocked WebGL1 context -- no DOM required.

function makeMockGl100(): WebGLRenderingContext {
  return {
    createTexture: vi.fn().mockReturnValue({}),
    deleteTexture: vi.fn(),
    bindTexture: vi.fn(),
    texImage2D: vi.fn(),
    texSubImage2D: vi.fn(),
    texParameteri: vi.fn(),
    texParameterf: vi.fn(),
    generateMipmap: vi.fn(),
    compressedTexImage2D: vi.fn(),
    getExtension: vi.fn(() => null),
    getParameter: vi.fn(() => 16),
    TEXTURE_2D: 1,
    RGBA: 2,
    UNSIGNED_BYTE: 3,
    TEXTURE_MAG_FILTER: 4,
    TEXTURE_MIN_FILTER: 5,
    NEAREST: 6,
    LINEAR: 7,
    LINEAR_MIPMAP_LINEAR: 8,
    NEAREST_MIPMAP_LINEAR: 9,
    TEXTURE_WRAP_S: 10,
    TEXTURE_WRAP_T: 11,
    REPEAT: 12,
    MIRRORED_REPEAT: 13,
    CLAMP_TO_EDGE: 14,
  } as unknown as WebGLRenderingContext;
}

function makeManager(gl: WebGLRenderingContext): {
  manager: WebGLTextureManager;
  defaultTexture: WebGLTexture;
} {
  const defaultTexture = { isDefault: true } as unknown as WebGLTexture;
  const manager = new WebGLTextureManager(gl, new Map(), defaultTexture, {} as never, {
    dialect: "glsl100",
  });
  return { manager, defaultTexture };
}

describe("WebGL1 compressed upload (K01 b)", () => {
  it("uploads a compressed-only texture via compressedTexImage2D, not the default placeholder", () => {
    const gl = makeMockGl100();
    // S3TC (BC1/DXT1) is the WebGL1-typical desktop format.
    const s3tc = { COMPRESSED_RGB_S3TC_DXT1_EXT: 0x83f0 };
    vi.mocked(gl.getExtension).mockReturnValue(s3tc as never);
    const { manager, defaultTexture } = makeManager(gl);

    // 32x32 BC1 = 8x8 blocks x 8 bytes = 512 bytes for level 0, 128 bytes for level 1.
    const tex = Texture.fromCompressed({
      format: CompressedTextureFormat.BC1_RGB,
      width: 32,
      height: 32,
      mipData: [new Uint8Array(512).fill(1), new Uint8Array(128).fill(2)],
    });
    expect(tex.image).toBeUndefined(); // compressed-only payload

    const glTex = manager.getWebGLTexture(tex, undefined);

    // The compressed texture is uploaded -- NOT routed to the default placeholder (the old
    // `_fastPath100` returned `_defaultTexture` for any texture without `.image`).
    expect(glTex).not.toBe(defaultTexture);
    expect(vi.mocked(gl.compressedTexImage2D)).toHaveBeenCalledTimes(2);
    expect(gl.compressedTexImage2D).toHaveBeenNthCalledWith(
      1,
      gl.TEXTURE_2D,
      0,
      0x83f0,
      32,
      32,
      0,
      expect.any(Uint8Array),
    );
    expect(gl.compressedTexImage2D).toHaveBeenNthCalledWith(
      2,
      gl.TEXTURE_2D,
      1,
      0x83f0,
      16,
      16,
      0,
      expect.any(Uint8Array),
    );
    // Explicit mip count (WebGL1 has no TEXTURE_MAX_LEVEL constant; the enumerant is spec-fixed).
    expect(gl.texParameteri).toHaveBeenCalledWith(gl.TEXTURE_2D, 0x813d, 1);
    // Sampler state is applied like any other texture.
    expect(gl.texParameteri).toHaveBeenCalledWith(
      gl.TEXTURE_2D,
      gl.TEXTURE_WRAP_S,
      expect.any(Number),
    );

    // Cached: a repeated request must not re-upload (compressed textures skip the needsUpdate path).
    vi.mocked(gl.compressedTexImage2D).mockClear();
    const cached = manager.getWebGLTexture(tex, undefined);
    expect(cached).toBe(glTex);
    expect(vi.mocked(gl.compressedTexImage2D)).not.toHaveBeenCalled();
  });

  it("uploads ASTC through the WebGL1 ASTC extension", () => {
    const gl = makeMockGl100();
    const astc = { COMPRESSED_RGBA_ASTC_4x4_KHR: 0x93b0 };
    vi.mocked(gl.getExtension).mockReturnValue(astc as never);
    const { manager } = makeManager(gl);

    // 16x16 ASTC 4x4 = 4x4 blocks x 16 bytes = 256 bytes.
    const tex = Texture.fromCompressed({
      format: CompressedTextureFormat.ASTC_4x4_RGBA,
      width: 16,
      height: 16,
      mipData: [new Uint8Array(256).fill(3)],
    });

    const glTex = manager.getWebGLTexture(tex, undefined);
    expect(glTex).toBeDefined();
    expect(gl.compressedTexImage2D).toHaveBeenCalledTimes(1);
    expect(gl.compressedTexImage2D).toHaveBeenCalledWith(
      gl.TEXTURE_2D,
      0,
      0x93b0,
      16,
      16,
      0,
      expect.any(Uint8Array),
    );
    expect(vi.mocked(gl.getExtension)).toHaveBeenCalledWith("WEBGL_compressed_texture_astc");
  });

  it("throws a loud error when the WebGL1 device lacks the block format extension", () => {
    const gl = makeMockGl100();
    // No S3TC extension available on this WebGL1 context.
    const { manager } = makeManager(gl);

    const tex = Texture.fromCompressed({
      format: CompressedTextureFormat.BC1_RGB,
      width: 32,
      height: 32,
      mipData: [new Uint8Array(512)],
    });

    expect(() => manager.getWebGLTexture(tex, undefined)).toThrow(/No S3TC support/);
    // The half-created GL texture is released (it is never cached, so it would leak every frame).
    expect(vi.mocked(gl.deleteTexture)).toHaveBeenCalledTimes(1);
  });
});
