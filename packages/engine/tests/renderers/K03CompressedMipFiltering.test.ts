import { describe, expect, it, vi } from "vitest";
import { WebGLTextureManager } from "../../src/renderers/gl/managers/WebGLTextureManager.js";
import { Texture } from "../../src/core/textures/Texture.js";
import { CompressedTextureFormat } from "../../src/enums/CompressedTextureFormat.js";

// K03: a KTX2/block-compressed upload carries its FULL mip pyramid explicitly (`mipData`), yet the
// GL upload paths configured the sampler with MIP FILTERING DISABLED (`useMipmaps = false`).
// Result: every KTX2 texture minified on LOD-0 only and aliased silently, while identical content
// on WebGPU (which generates/uses the same chain) stayed sharp -- a cross-tier asymmetry on the
// same data.
// Fix contract: whenever `mipData.length > 1` AND quality.mipmapping is on,
//   1. WebGL2 keeps trilinear filtering (`LINEAR_MIPMAP_LINEAR` min filter) on the explicit chain,
//   2. WebGL1 also enables mip filtering on the explicit chain but MUST NOT re-run
//      `generateMipmap` (GL_INVALID_OPERATION on a non-color-renderable compressed source).
// A single-level payload (`mipData.length === 1`) must stay unfiltered exactly as before.
// Mocked contexts, no DOM required (same pattern as Glsl100CompressedUpload.test.ts).

const MAX_LEVEL = 0x813d; // TEXTURE_MAX_LEVEL, WebGL2-only enumerant (spec-fixed value).

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

function makeMockGl2(): WebGL2RenderingContext {
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
    TEXTURE_MAX_LEVEL: MAX_LEVEL,
  } as unknown as WebGL2RenderingContext;
}

function s3tcExtension(): { COMPRESSED_RGB_S3TC_DXT1_EXT: number } {
  return { COMPRESSED_RGB_S3TC_DXT1_EXT: 0x83f0 };
}

function makeManager(
  gl: WebGLRenderingContext | WebGL2RenderingContext,
  dialect: "glsl100" | "glsl300",
): WebGLTextureManager {
  const defaultTexture = { isDefault: true } as unknown as WebGLTexture;
  return new WebGLTextureManager(gl, new Map(), defaultTexture, {} as never, { dialect });
}

const minFilterCalls = (gl: WebGLRenderingContext | WebGL2RenderingContext): number[] =>
  vi
    .mocked(gl.texParameteri)
    .mock.calls.filter((c) => c[0] === gl.TEXTURE_2D && c[1] === gl.TEXTURE_MIN_FILTER)
    .map((c) => c[2] as number);

describe("K03: compressed KTX2 mip pyramid keeps trilinear filtering", () => {
  it("WebGL1 enables mip filtering on an explicit pyramid WITHOUT re-running generateMipmap", () => {
    const gl = makeMockGl100();
    vi.mocked(gl.getExtension).mockReturnValue(s3tcExtension() as never);
    const manager = makeManager(gl, "glsl100");

    // 32x32 BC1 = 8x8 blocks x 8 bytes = 512 B (L0) + 128 B (L1): a full 2-level chain.
    const tex = Texture.fromCompressed({
      format: CompressedTextureFormat.BC1_RGB,
      width: 32,
      height: 32,
      mipData: [new Uint8Array(512).fill(1), new Uint8Array(128).fill(2)],
    });

    manager.getWebGLTexture(tex, { mipmapping: true });

    // Mip filtering stays on for the explicitly-uploaded chain …
    expect(minFilterCalls(gl)).toContain(gl.LINEAR_MIPMAP_LINEAR);
    // … but `generateMipmap` must be skipped: the source is block-compressed and not
    // color-renderable, so WebGL1 would raise GL_INVALID_OPERATION (K03).
    expect(vi.mocked(gl.generateMipmap)).not.toHaveBeenCalled();
  });

  it("WebGL1 keeps a single-level compressed payload unfiltered and mipmap-free", () => {
    const gl = makeMockGl100();
    vi.mocked(gl.getExtension).mockReturnValue(s3tcExtension() as never);
    const manager = makeManager(gl, "glsl100");

    const tex = Texture.fromCompressed({
      format: CompressedTextureFormat.BC1_RGB,
      width: 32,
      height: 32,
      mipData: [new Uint8Array(512).fill(1)],
    });

    manager.getWebGLTexture(tex, { mipmapping: true });

    expect(minFilterCalls(gl)).not.toContain(gl.LINEAR_MIPMAP_LINEAR);
    expect(minFilterCalls(gl)).not.toContain(gl.NEAREST_MIPMAP_LINEAR);
    expect(vi.mocked(gl.generateMipmap)).not.toHaveBeenCalled();
  });

  it("WebGL2 keeps trilinear filtering on an explicit KTX2 pyramid (regression: hard false)", () => {
    const gl = makeMockGl2();
    vi.mocked(gl.getExtension).mockReturnValue(s3tcExtension() as never);
    const manager = makeManager(gl, "glsl300");

    const tex = Texture.fromCompressed({
      format: CompressedTextureFormat.BC1_RGB,
      width: 32,
      height: 32,
      mipData: [new Uint8Array(512).fill(1), new Uint8Array(128).fill(2)],
    });

    manager.getWebGLTexture(tex, { mipmapping: true });

    // The pre-K03 path passed `useMipmaps = false` here and set LINEAR (aliased minification).
    expect(minFilterCalls(gl)).toContain(gl.LINEAR_MIPMAP_LINEAR);
    // Explicit chain: no generateMipmap on a compressed upload.
    expect(vi.mocked(gl.generateMipmap)).not.toHaveBeenCalled();
  });

  it("WebGL2 keeps a single-level compressed payload unfiltered", () => {
    const gl = makeMockGl2();
    vi.mocked(gl.getExtension).mockReturnValue(s3tcExtension() as never);
    const manager = makeManager(gl, "glsl300");

    const tex = Texture.fromCompressed({
      format: CompressedTextureFormat.BC1_RGB,
      width: 32,
      height: 32,
      mipData: [new Uint8Array(512).fill(1)],
    });

    manager.getWebGLTexture(tex, { mipmapping: true });

    expect(minFilterCalls(gl)).not.toContain(gl.LINEAR_MIPMAP_LINEAR);
    expect(minFilterCalls(gl)).not.toContain(gl.NEAREST_MIPMAP_LINEAR);
  });

  it("WebGL2 honours quality.mipmapping=false: explicit pyramid stays unfiltered", () => {
    const gl = makeMockGl2();
    vi.mocked(gl.getExtension).mockReturnValue(s3tcExtension() as never);
    const manager = makeManager(gl, "glsl300");

    const tex = Texture.fromCompressed({
      format: CompressedTextureFormat.BC1_RGB,
      width: 32,
      height: 32,
      mipData: [new Uint8Array(512).fill(1), new Uint8Array(128).fill(2)],
    });

    manager.getWebGLTexture(tex, { mipmapping: false });

    expect(minFilterCalls(gl)).not.toContain(gl.LINEAR_MIPMAP_LINEAR);
    expect(vi.mocked(gl.generateMipmap)).not.toHaveBeenCalled();
  });
});
