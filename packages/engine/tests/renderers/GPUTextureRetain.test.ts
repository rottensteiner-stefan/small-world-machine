import "../../src/index.js";
import { describe, expect, it, vi } from "vitest";
import { GPUTextureResourceCache } from "../../src/renderers/WebGPU/managers/GPUTextureResourceCache.js";
import { GPUFallbackResources } from "../../src/renderers/WebGPU/managers/GPUFallbackResources.js";
import { Texture } from "../../src/core/textures/Texture.js";
import { Object3D } from "../../src/core/Object3D.js";
import type { QualityConfig } from "../../src/interfaces/index.js";

// Node/vitest has no WebGPU global; stub the bit-flag constants the code under test reads.
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

function makeCache(): {
  textures: GPUTextureResourceCache;
  gpuTextures: { destroy: ReturnType<typeof vi.fn> }[];
} {
  const gpuTextures: { destroy: ReturnType<typeof vi.fn> }[] = [];
  const device = {
    createTexture: vi.fn(() => {
      const gpuTexture = { createView: vi.fn(() => ({})), destroy: vi.fn() };
      gpuTextures.push(gpuTexture);
      return gpuTexture;
    }),
    createCommandEncoder: vi.fn(() => ({
      beginRenderPass: vi.fn(() => ({
        setPipeline: vi.fn(),
        setBindGroup: vi.fn(),
        draw: vi.fn(),
        end: vi.fn(),
      })),
      finish: vi.fn(() => ({})),
    })),
    createBindGroup: vi.fn(() => ({})),
    createBindGroupLayout: vi.fn(() => ({})),
    createShaderModule: vi.fn(() => ({})),
    createPipelineLayout: vi.fn(() => ({})),
    createRenderPipeline: vi.fn(() => ({})),
    createSampler: vi.fn(() => ({})),
    createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
    queue: {
      copyExternalImageToTexture: vi.fn(),
      submit: vi.fn(),
      writeBuffer: vi.fn(),
      writeTexture: vi.fn(),
    },
  } as unknown as GPUDevice;
  const textures = new GPUTextureResourceCache(device, new GPUFallbackResources(device));
  gpuTextures.length = 0;
  return { textures, gpuTextures };
}

const QUALITY = { mipmapping: false } as QualityConfig;

describe("GPUTextureResourceCache: retained textures", () => {
  it("destroys a texture when the last object using it releases it (baseline)", () => {
    const { textures, gpuTextures } = makeCache();
    const tex = Texture.fromCanvas({ width: 16, height: 16 } as HTMLCanvasElement);
    textures.getTextureView(tex, QUALITY);
    const owner = new Object3D("owner");
    textures.acquireTextures(owner, { u_diffuseMap: tex });

    textures.releaseObjectTextures(owner);

    expect(gpuTextures).toHaveLength(1);
    expect(gpuTextures[0]!.destroy).toHaveBeenCalledTimes(1);
  });

  it("keeps a retained texture alive when the last object releases it, until the retain is dropped", () => {
    const { textures, gpuTextures } = makeCache();
    const tex = Texture.fromCanvas({ width: 16, height: 16 } as HTMLCanvasElement);
    textures.getTextureView(tex, QUALITY);
    const owner = new Object3D("owner");
    textures.acquireTextures(owner, { u_diffuseMap: tex });
    textures.retainTexture(tex);

    textures.releaseObjectTextures(owner);
    expect(gpuTextures[0]!.destroy).not.toHaveBeenCalled();

    textures.releaseRetainedTexture(tex);
    expect(gpuTextures[0]!.destroy).toHaveBeenCalledTimes(1);
  });
});
