import { describe, expect, it, vi } from "vitest";
import { GPUTextureResourceCache } from "../../src/renderers/WebGPU/managers/GPUTextureResourceCache.js";
import { GPUFallbackResources } from "../../src/renderers/WebGPU/managers/GPUFallbackResources.js";
import { Texture } from "../../src/core/textures/Texture.js";
import { TextureFilter } from "../../src/enums/TextureFilter.js";
import type { QualityConfig } from "../../src/interfaces/EngineOptions.js";

// Node/vitest has no WebGPU globals; @webgpu/types only provides ambient TS types. Stub the
// bit-flag constants the fallback/cache constructors actually read.
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

const quality = { maxAnisotropy: 4 } as QualityConfig;

describe("WebGPU sampler anisotropic filtering", () => {
  const makeCache = (): { device: GPUDevice; textures: GPUTextureResourceCache } => {
    const device = makeMockDevice();
    const textures = new GPUTextureResourceCache(device, new GPUFallbackResources(device));
    vi.mocked(device.createSampler).mockClear();
    return { device, textures };
  };

  const lastSamplerDesc = (device: GPUDevice): GPUSamplerDescriptor | undefined =>
    vi.mocked(device.createSampler).mock.calls.at(-1)?.[0];

  it("applies the inherited engine level to a fully-linear mipmapped texture", () => {
    const { device, textures } = makeCache();
    const tex = Texture.fromImage({} as ImageBitmap);
    textures.getSampler(tex, quality);
    expect(lastSamplerDesc(device)?.maxAnisotropy).toBe(4);
  });

  it("caps an explicit per-texture level at the engine maximum", () => {
    const { device, textures } = makeCache();
    const tex = Texture.fromImage({} as ImageBitmap, { anisotropy: 16 });
    textures.getSampler(tex, quality);
    expect(lastSamplerDesc(device)?.maxAnisotropy).toBe(4);
  });

  it("uses the requested level when not capped by quality", () => {
    const { device, textures } = makeCache();
    const tex = Texture.fromImage({} as ImageBitmap, { anisotropy: 16 });
    textures.getSampler(tex, undefined);
    expect(lastSamplerDesc(device)?.maxAnisotropy).toBe(16);
  });

  it("omits maxAnisotropy on nearest-filtered samplers", () => {
    const { device, textures } = makeCache();
    const tex = Texture.fromImage({} as ImageBitmap, {
      magFilter: TextureFilter.NEAREST,
      minFilter: TextureFilter.NEAREST,
    });
    textures.getSampler(tex, quality);
    expect(lastSamplerDesc(device)?.maxAnisotropy).toBeUndefined();
  });

  it("omits maxAnisotropy when the texture disables filtering (anisotropy 0)", () => {
    const { device, textures } = makeCache();
    const tex = Texture.fromImage({} as ImageBitmap, { anisotropy: 0 });
    textures.getSampler(tex, quality);
    expect(lastSamplerDesc(device)?.maxAnisotropy).toBeUndefined();
  });

  it("omits maxAnisotropy for an undefined texture", () => {
    const { device, textures } = makeCache();
    textures.getSampler(undefined, quality);
    expect(lastSamplerDesc(device)?.maxAnisotropy).toBeUndefined();
  });

  it("caches the sampler per texture/level combo instead of recreating it", () => {
    const { device, textures } = makeCache();
    const tex = Texture.fromImage({} as ImageBitmap);
    textures.getSampler(tex, quality);
    textures.getSampler(tex, quality);
    expect(device.createSampler).toHaveBeenCalledTimes(1);
  });
});
