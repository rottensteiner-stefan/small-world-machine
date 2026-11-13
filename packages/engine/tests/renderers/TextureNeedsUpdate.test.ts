import "../../src/index.js";
import { describe, expect, it, vi } from "vitest";
import { WebGLTextureManager } from "../../src/renderers/gl/managers/WebGLTextureManager.js";
import { GPUTextureResourceCache } from "../../src/renderers/WebGPU/managers/GPUTextureResourceCache.js";
import { GPUFallbackResources } from "../../src/renderers/WebGPU/managers/GPUFallbackResources.js";
import { Texture } from "../../src/core/textures/Texture.js";
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
