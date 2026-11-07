import "../../src/index.js";
import { describe, expect, it, vi } from "vitest";
import { WebGL1Renderer } from "../../src/renderers/WebGL1/WebGL1Renderer.js";
import { WebGLTextureManager } from "../../src/renderers/gl/managers/WebGLTextureManager.js";
import { GPUTextureResourceCache } from "../../src/renderers/WebGPU/managers/GPUTextureResourceCache.js";
import { GPUFallbackResources } from "../../src/renderers/WebGPU/managers/GPUFallbackResources.js";
import { Texture } from "../../src/core/textures/Texture.js";
import { TextureArray } from "../../src/core/textures/TextureArray.js";
import { CompressedTextureFormat } from "../../src/enums/CompressedTextureFormat.js";

// Node/vitest has no WebGPU global; @webgpu/types only provides ambient TS types,
// not a runtime value. Stub the bit-flag constants this renderer actually reads.
(globalThis as unknown as { GPUTextureUsage: Record<string, number> }).GPUTextureUsage ??= {
  COPY_SRC: 0x01,
  COPY_DST: 0x02,
  TEXTURE_BINDING: 0x04,
  STORAGE_BINDING: 0x08,
  RENDER_ATTACHMENT: 0x10,
};
(globalThis as unknown as { GPUBufferUsage: Record<string, number> }).GPUBufferUsage ??= {
  MAP_READ: 0x0001,
  MAP_WRITE: 0x0002,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  INDEX: 0x0010,
  VERTEX: 0x0020,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
  INDIRECT: 0x0100,
  QUERY_RESOLVE: 0x0200,
};
(globalThis as unknown as { GPUShaderStage: Record<string, number> }).GPUShaderStage ??= {
  VERTEX: 0x1,
  FRAGMENT: 0x2,
  COMPUTE: 0x4,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RendererInternals = any;

function makeMockGl(): WebGL2RenderingContext {
  return {
    createTexture: vi.fn().mockReturnValue({}),
    deleteTexture: vi.fn(),
    bindTexture: vi.fn(),
    texImage2D: vi.fn(),
    texImage3D: vi.fn(),
    texSubImage3D: vi.fn(),
    texParameteri: vi.fn(),
    generateMipmap: vi.fn(),
    compressedTexImage2D: vi.fn(),
    getExtension: vi.fn(() => null),
    getParameter: vi.fn(() => 16),
    texParameterf: vi.fn(),
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
    TEXTURE_2D_ARRAY: 15,
    TEXTURE_MAX_LEVEL: 16,
  } as unknown as WebGL2RenderingContext;
}

function makeMockDevice(): GPUDevice {
  const view = {};
  const gpuTexture = { createView: vi.fn().mockReturnValue(view) };
  return {
    createTexture: vi.fn().mockReturnValue(gpuTexture),
    createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
    createSampler: vi.fn(() => ({})),
    createBindGroupLayout: vi.fn(() => ({})),
    createBindGroup: vi.fn(() => ({})),
    createShaderModule: vi.fn(() => ({})),
    createPipelineLayout: vi.fn(() => ({})),
    createRenderPipeline: vi.fn(() => ({})),
    queue: { copyExternalImageToTexture: vi.fn(), writeBuffer: vi.fn(), writeTexture: vi.fn() },
    features: { has: vi.fn(() => true) },
  } as unknown as GPUDevice;
}

describe("Texture GPU re-upload on needsUpdate", () => {
  it("WebGL1Renderer re-uploads pixels without recreating the GL texture", () => {
    const gl = makeMockGl();
    const renderer = new WebGL1Renderer();
    (renderer as RendererInternals).gl = gl;
    // Mount the shared GL manager layer the way WebGL1Renderer.initialize() does, with the
    // WebGL1 `glsl100` dialect (NPOT + no TEXTURE_2D_ARRAY uploads).
    (renderer as RendererInternals)._textures = new WebGLTextureManager(
      gl,
      new Map(),
      {} as never,
      {} as never,
      { dialect: "glsl100" },
    );

    const tex = Texture.fromCanvas({ width: 32, height: 33 } as HTMLCanvasElement);

    const first = (renderer as RendererInternals)._textures.getWebGLTexture(tex, undefined);
    expect(gl.createTexture).toHaveBeenCalledTimes(1);
    expect(gl.texImage2D).toHaveBeenCalledTimes(1);
    const firstSamplerCallCount = vi.mocked(gl.texParameteri).mock.calls.length;
    expect(firstSamplerCallCount).toBeGreaterThan(0);

    vi.mocked(gl.texParameteri).mockClear();
    tex.needsUpdate = true;
    const second = (renderer as RendererInternals)._textures.getWebGLTexture(tex, undefined);

    expect(second).toBe(first);
    expect(gl.createTexture).toHaveBeenCalledTimes(1);
    expect(gl.texImage2D).toHaveBeenCalledTimes(2);
    expect(tex.needsUpdate).toBe(false);
    // Sampler params (wrap/filter) must be re-applied on re-upload, not just on first creation --
    // otherwise a texture that changes wrap/filter mode after needsUpdate silently keeps stale GL state.
    expect(vi.mocked(gl.texParameteri).mock.calls.length).toBe(firstSamplerCallCount);
    expect(gl.texParameteri).toHaveBeenCalledWith(
      gl.TEXTURE_2D,
      gl.TEXTURE_WRAP_S,
      expect.any(Number),
    );
  });

  it("WebGLTextureManager re-uploads pixels without recreating the GL texture", () => {
    const gl = makeMockGl();
    const textures = new WebGLTextureManager(gl, new Map(), {} as never, {} as never);

    const tex = Texture.fromCanvas({ width: 32, height: 32 } as HTMLCanvasElement);

    const first = textures.getWebGLTexture(tex, undefined);
    expect(gl.createTexture).toHaveBeenCalledTimes(1);
    expect(gl.texImage2D).toHaveBeenCalledTimes(1);
    const firstSamplerCallCount = vi.mocked(gl.texParameteri).mock.calls.length;
    expect(firstSamplerCallCount).toBeGreaterThan(0);

    vi.mocked(gl.texParameteri).mockClear();
    tex.needsUpdate = true;
    const second = textures.getWebGLTexture(tex, undefined);

    expect(second).toBe(first);
    expect(gl.createTexture).toHaveBeenCalledTimes(1);
    expect(gl.texImage2D).toHaveBeenCalledTimes(2);
    expect(tex.needsUpdate).toBe(false);
    // Same sampler-reapply guarantee as the WebGL1Renderer path above, but through
    // WebGLTextureManager's own (WebGL2) code path.
    expect(vi.mocked(gl.texParameteri).mock.calls.length).toBe(firstSamplerCallCount);
    expect(gl.texParameteri).toHaveBeenCalledWith(
      gl.TEXTURE_2D,
      gl.TEXTURE_WRAP_S,
      expect.any(Number),
    );
  });

  it("WebGLTextureManager re-uploads a TextureArray's layers on needsUpdate, not just on first upload", () => {
    const gl = makeMockGl();
    const textures = new WebGLTextureManager(gl, new Map(), {} as never, {} as never);

    const layer = { width: 8, height: 8 } as ImageBitmap;
    const texArray = TextureArray.fromImages([layer, layer]);

    const first = textures.getWebGLTexture(texArray, undefined);
    expect(gl.createTexture).toHaveBeenCalledTimes(1);
    expect(gl.texImage3D).toHaveBeenCalledTimes(1);
    expect(gl.texSubImage3D).toHaveBeenCalledTimes(2); // one per layer

    vi.mocked(gl.texImage3D).mockClear();
    vi.mocked(gl.texSubImage3D).mockClear();
    texArray.needsUpdate = true;
    const second = textures.getWebGLTexture(texArray, undefined);

    expect(second).toBe(first);
    expect(gl.createTexture).toHaveBeenCalledTimes(1); // no new GL texture, same object re-bound
    expect(gl.texImage3D).toHaveBeenCalledTimes(1);
    expect(gl.texSubImage3D).toHaveBeenCalledTimes(2);
    expect(texArray.needsUpdate).toBe(false);
  });

  it("does not re-upload when needsUpdate stays false", () => {
    const gl = makeMockGl();
    const textures = new WebGLTextureManager(gl, new Map(), {} as never, {} as never);

    const tex = Texture.fromCanvas({ width: 32, height: 32 } as HTMLCanvasElement);

    textures.getWebGLTexture(tex, undefined);
    textures.getWebGLTexture(tex, undefined);

    expect(gl.texImage2D).toHaveBeenCalledTimes(1);
  });

  it("WebGPURenderer re-uploads via copyExternalImageToTexture without recreating the GPU texture", () => {
    const device = makeMockDevice();
    const fallback = new GPUFallbackResources(device);
    const textures = new GPUTextureResourceCache(device, fallback);

    // Mip generation is covered separately in WebGPUMipmapGeneration.test.ts -- this test is
    // only about the re-upload-without-recreation path, so mips are opted out here.
    const tex = Texture.fromCanvas({ width: 16, height: 16 } as HTMLCanvasElement, {
      generateMipmaps: false,
    });

    vi.mocked(device.createTexture).mockClear();
    vi.mocked(device.queue.copyExternalImageToTexture).mockClear();

    const firstView = textures.getTextureView(tex, undefined);
    expect(device.createTexture).toHaveBeenCalledTimes(1);
    expect(device.queue.copyExternalImageToTexture).toHaveBeenCalledTimes(1);

    tex.needsUpdate = true;
    const secondView = textures.getTextureView(tex, undefined);

    expect(secondView).toBe(firstView);
    expect(device.createTexture).toHaveBeenCalledTimes(1);
    expect(device.queue.copyExternalImageToTexture).toHaveBeenCalledTimes(2);
    expect(tex.needsUpdate).toBe(false);
  });

  it("re-creates the GPU texture when the source canvas is resized before needsUpdate re-upload", () => {
    const device = makeMockDevice();
    const fallback = new GPUFallbackResources(device);
    const textures = new GPUTextureResourceCache(device, fallback);

    // Simulate a `TextTexture` whose canvas (backing `texture.image`) is resized by
    // `setText`/`setOptions` -- the full current bounds must be copied only into a texture
    // that actually has those dimensions, otherwise WebGPU raises "Texture copy range ...
    // touches outside of [Texture (unlabeled 1934x622 px)]".
    const canvas = { width: 320, height: 96 } as HTMLCanvasElement;
    const tex = Texture.fromCanvas(canvas, { generateMipmaps: false });

    vi.mocked(device.createTexture).mockClear();
    vi.mocked(device.queue.copyExternalImageToTexture).mockClear();

    textures.getTextureView(tex, undefined);
    expect(device.createTexture).toHaveBeenCalledTimes(1);
    expect(device.queue.copyExternalImageToTexture).toHaveBeenCalledTimes(1);

    // Text changed -> canvas grew; a same-sized in-place copy would now exceed bounds.
    canvas.width = 640;
    canvas.height = 128;
    tex.needsUpdate = true;
    const secondView = textures.getTextureView(tex, undefined);

    // A fresh GPU texture is created at the new size -- never copied into the stale one.
    expect(device.createTexture).toHaveBeenCalledTimes(2);
    const createdSizes = vi
      .mocked(device.createTexture)
      .mock.calls.map(([desc]) => (desc as { size: number[] }).size);
    expect(createdSizes).toEqual([
      [320, 96],
      [640, 128],
    ]);
    // Both the first upload and the resized re-upload copy the source at its own bounds.
    const copySizes = vi
      .mocked(device.queue.copyExternalImageToTexture)
      .mock.calls.map(([, , copySize]) => copySize as number[]);
    expect(copySizes).toEqual([
      [320, 96],
      [640, 128],
    ]);
    expect(tex.needsUpdate).toBe(false);
    expect(secondView).toBeDefined();
  });

  it("WebGLTextureManager uploads block-compressed textures via compressedTexImage2D", () => {
    const gl = makeMockGl();
    const etcExt = { COMPRESSED_RGBA8_ETC2_EAC: 0x9278 };
    vi.mocked(gl.getExtension).mockReturnValue(etcExt as never);
    const textures = new WebGLTextureManager(gl, new Map(), {} as never, {} as never);

    // Two explicit mip levels, each with nonzero block data (40x40 ETC2 = 10x10 blocks x 16).
    const tex = Texture.fromCompressed({
      format: CompressedTextureFormat.ETC2_RGBA8,
      width: 40,
      height: 40,
      mipData: [new Uint8Array(1600).fill(7), new Uint8Array(400).fill(9)],
    });

    const glTex = textures.getWebGLTexture(tex, undefined);

    expect(glTex).toBeDefined();
    expect(vi.mocked(gl.compressedTexImage2D)).toHaveBeenCalledTimes(2);
    expect(gl.compressedTexImage2D).toHaveBeenNthCalledWith(
      1,
      gl.TEXTURE_2D,
      0,
      0x9278,
      40,
      40,
      0,
      expect.any(Uint8Array),
    );
    expect(gl.compressedTexImage2D).toHaveBeenNthCalledWith(
      2,
      gl.TEXTURE_2D,
      1,
      0x9278,
      20,
      20,
      0,
      expect.any(Uint8Array),
    );
    // Mip pyramid is explicit -- WebGL must not expect any further levels.
    expect(gl.texParameteri).toHaveBeenCalledWith(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, 1);

    // Cache: a repeated request must NOT re-upload (compressed textures never enter the
    // `needsUpdate` re-upload path).
    vi.mocked(gl.compressedTexImage2D).mockClear();
    const cached = textures.getWebGLTexture(tex, undefined);
    expect(cached).toBe(glTex);
    expect(vi.mocked(gl.compressedTexImage2D)).not.toHaveBeenCalled();

    // Sampler params (wrap/filter) are set like any other panel texture.
    expect(gl.texParameteri).toHaveBeenCalledWith(
      gl.TEXTURE_2D,
      gl.TEXTURE_WRAP_S,
      expect.any(Number),
    );
  });

  it("WebGLTextureManager throws a clear error when the device lacks the block format", () => {
    const gl = makeMockGl();
    // No ETC2 extension available.
    vi.mocked(gl.getExtension).mockReturnValue(null);
    const textures = new WebGLTextureManager(gl, new Map(), {} as never, {} as never);

    const tex = Texture.fromCompressed({
      format: CompressedTextureFormat.ETC2_RGBA8,
      width: 40,
      height: 40,
      mipData: [new Uint8Array(1600)],
    });

    expect(() => textures.getWebGLTexture(tex, undefined)).toThrow(/No ETC2 support/);
    // The half-created GL texture is released (it is never cached, so it would leak every frame).
    expect(vi.mocked(gl.deleteTexture)).toHaveBeenCalledTimes(1);
  });

  it("GPUTextureResourceCache uploads block-compressed textures via writeTexture", () => {
    const device = makeMockDevice();
    const fallback = new GPUFallbackResources(device);
    const textures = new GPUTextureResourceCache(device, fallback);

    vi.mocked(device.createTexture).mockClear();
    vi.mocked(device.queue.writeTexture).mockClear();

    const tex = Texture.fromCompressed({
      format: CompressedTextureFormat.ETC2_RGBA8,
      width: 40,
      height: 40,
      mipData: [new Uint8Array(1600).fill(7), new Uint8Array(400).fill(9)],
    });

    const view = textures.getTextureView(tex, undefined);
    expect(view).toBeDefined();

    expect(device.createTexture).toHaveBeenCalledTimes(1);
    const createCall = vi.mocked(device.createTexture).mock.calls[0]![0] as {
      format: string;
      mipLevelCount: number;
    };
    expect(createCall.format).toBe("etc2-rgba8unorm");
    expect(createCall.mipLevelCount).toBe(2);

    expect(vi.mocked(device.queue.writeTexture)).toHaveBeenCalledTimes(2);
    // Block-aligned stride for a 40px (=10 block) wide row of ETC2 (16 B/block), 10 block rows.
    expect(vi.mocked(device.queue.writeTexture)).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.any(Uint8Array),
      { offset: 0, bytesPerRow: 160, rowsPerImage: 10 },
      [40, 40],
    );
  });

  it("GPUTextureResourceCache throws when the device lacks the compressed-texture feature", () => {
    const device = makeMockDevice();
    const fallback = new GPUFallbackResources(device);
    const textures = new GPUTextureResourceCache(device, fallback);
    vi.mocked((device.features as { has: (f: string) => boolean }).has).mockReturnValue(false);

    const tex = Texture.fromCompressed({
      format: CompressedTextureFormat.ETC2_RGBA8,
      width: 40,
      height: 40,
      mipData: [new Uint8Array(1600)],
    });

    expect(() => textures.getTextureView(tex, undefined)).toThrow(/texture-compression-etc2/);
  });
});
