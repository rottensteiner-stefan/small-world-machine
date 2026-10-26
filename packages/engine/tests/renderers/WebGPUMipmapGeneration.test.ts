import "../../src/index.js";
import { describe, expect, it, vi } from "vitest";
import { GPUTextureResourceCache } from "../../src/renderers/WebGPU/managers/GPUTextureResourceCache.js";
import { GPUFallbackResources } from "../../src/renderers/WebGPU/managers/GPUFallbackResources.js";
import { Texture } from "../../src/core/textures/Texture.js";
import type { QualityConfig } from "../../src/interfaces/index.js";

// Node/vitest has no WebGPU global; @webgpu/types only provides ambient TS types,
// not a runtime value. Stub the bit-flag constants this class actually reads.
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

function makeMockDevice(): { device: GPUDevice; renderPass: { draw: ReturnType<typeof vi.fn> } } {
  const view = {};
  const gpuTexture = { createView: vi.fn().mockReturnValue(view), destroy: vi.fn() };
  const renderPass = {
    setPipeline: vi.fn(),
    setBindGroup: vi.fn(),
    draw: vi.fn(),
    end: vi.fn(),
  };
  const commandEncoder = {
    beginRenderPass: vi.fn().mockReturnValue(renderPass),
    finish: vi.fn().mockReturnValue({}),
  };
  const device = {
    createTexture: vi.fn().mockReturnValue(gpuTexture),
    createCommandEncoder: vi.fn().mockReturnValue(commandEncoder),
    createBindGroup: vi.fn().mockReturnValue({}),
    createBindGroupLayout: vi.fn().mockReturnValue({}),
    createShaderModule: vi.fn().mockReturnValue({}),
    createPipelineLayout: vi.fn().mockReturnValue({}),
    createRenderPipeline: vi.fn().mockReturnValue({}),
    createSampler: vi.fn().mockReturnValue({}),
    createBuffer: vi.fn().mockReturnValue({ destroy: vi.fn() }),
    queue: {
      copyExternalImageToTexture: vi.fn(),
      submit: vi.fn(),
      writeBuffer: vi.fn(),
      writeTexture: vi.fn(),
    },
  } as unknown as GPUDevice;
  return { device, renderPass };
}

function makeTextures(): { textures: GPUTextureResourceCache; device: GPUDevice } {
  const { device } = makeMockDevice();
  const fallback = new GPUFallbackResources(device);
  const textures = new GPUTextureResourceCache(device, fallback);
  // Fallback/textures-cache construction above makes its own createTexture/createCommandEncoder
  // calls -- clear the mock history so the assertions below only see calls made by the actual
  // code under test.
  vi.mocked(device.createTexture).mockClear();
  vi.mocked(device.createCommandEncoder).mockClear();
  vi.mocked(device.queue.copyExternalImageToTexture).mockClear();
  vi.mocked(device.queue.submit).mockClear();
  return { textures, device };
}

describe("WebGPU runtime mipmap generation", () => {
  it("computes the standard full mip chain length", () => {
    const { textures } = makeTextures();
    expect(textures.computeMipLevelCount(16, 16)).toBe(5);
    expect(textures.computeMipLevelCount(1, 1)).toBe(1);
    expect(textures.computeMipLevelCount(300, 150)).toBe(9);
  });

  it("creates a full mip chain and generates it for a fresh texture by default", () => {
    const { textures, device } = makeTextures();
    const tex = Texture.fromCanvas({ width: 16, height: 16 } as HTMLCanvasElement);

    textures.getTextureView(tex, { mipmapping: true } as QualityConfig);

    expect(device.createTexture).toHaveBeenCalledWith(
      expect.objectContaining({ mipLevelCount: 5 }),
    );
    expect(device.queue.submit).toHaveBeenCalledTimes(1);
  });

  it("gives normal maps the same full mip chain (they aliased into per-pixel noise without, ADR 0051)", () => {
    const { textures, device } = makeTextures();
    const tex = Texture.fromCanvas({ width: 16, height: 16 } as HTMLCanvasElement);

    textures.getNormalTextureView(tex, { mipmapping: true } as QualityConfig);

    expect(device.createTexture).toHaveBeenCalledWith(
      expect.objectContaining({ mipLevelCount: 5 }),
    );
    expect(device.queue.submit).toHaveBeenCalledTimes(1);
  });

  it("issues mipLevelCount - 1 blit draws per generation", () => {
    const { textures, device } = makeTextures();
    const tex = Texture.fromCanvas({ width: 16, height: 16 } as HTMLCanvasElement);

    textures.getTextureView(tex, { mipmapping: true } as QualityConfig);

    const commandEncoder = (device.createCommandEncoder as ReturnType<typeof vi.fn>).mock
      .results[0]!.value;
    expect(commandEncoder.beginRenderPass).toHaveBeenCalledTimes(4);
  });

  it("skips generation when the texture opts out via generateMipmaps: false", () => {
    const { textures, device } = makeTextures();
    const tex = Texture.fromCanvas({ width: 16, height: 16 } as HTMLCanvasElement, {
      generateMipmaps: false,
    });

    textures.getTextureView(tex, { mipmapping: true } as QualityConfig);

    expect(device.createTexture).toHaveBeenCalledWith(
      expect.objectContaining({ mipLevelCount: 1 }),
    );
    expect(device.queue.submit).not.toHaveBeenCalled();
  });

  it("skips generation when quality.mipmapping is disabled, even if the texture allows it", () => {
    const { textures, device } = makeTextures();
    const tex = Texture.fromCanvas({ width: 16, height: 16 } as HTMLCanvasElement);

    textures.getTextureView(tex, { mipmapping: false } as QualityConfig);

    expect(device.createTexture).toHaveBeenCalledWith(
      expect.objectContaining({ mipLevelCount: 1 }),
    );
    expect(device.queue.submit).not.toHaveBeenCalled();
  });

  it("regenerates the mip chain on a needsUpdate re-upload", () => {
    const { textures, device } = makeTextures();
    const tex = Texture.fromCanvas({ width: 16, height: 16 } as HTMLCanvasElement);

    textures.getTextureView(tex, { mipmapping: true } as QualityConfig);
    expect(device.queue.submit).toHaveBeenCalledTimes(1);

    tex.needsUpdate = true;
    textures.getTextureView(tex, { mipmapping: true } as QualityConfig);

    expect(device.queue.copyExternalImageToTexture).toHaveBeenCalledTimes(2);
    expect(device.queue.submit).toHaveBeenCalledTimes(2);
  });
});
