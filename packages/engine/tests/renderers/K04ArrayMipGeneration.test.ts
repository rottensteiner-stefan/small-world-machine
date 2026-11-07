import "../../src/index.js";
import { describe, expect, it, vi } from "vitest";
import { GPUTextureResourceCache } from "../../src/renderers/WebGPU/managers/GPUTextureResourceCache.js";
import { GPUFallbackResources } from "../../src/renderers/WebGPU/managers/GPUFallbackResources.js";
import type { TextureArray } from "../../src/core/index.js";
import type { QualityConfig } from "../../src/interfaces/index.js";

// K04: runtime `TextureArray`s were uploaded with `mipLevelCount: 1` and no mip generation at all,
// while single textures got a full generated chain -- the array path minified on LOD-0 only and
// aliased silently (tier asymmetry on the same data). Fix contract:
//   * `quality.mipmapping && texArray.generateMipmaps` computes the full level count and requests
//     it in `createTexture` -- the same gate as the single-image path.
//   * The downsample shader is `texture_2d`, so `generateArrayMipmaps` renders each layer's chain
//     through per-layer 2D views (`dimension:"2d"`, `baseArrayLayer`, `arrayLayerCount:1`).
//   * With the chain disabled the upload stays exactly as before: `mipLevelCount:1`, no blits.
// Node/vitest has no WebGPU global; stub the bit-flag constants (pattern from GPUTextureRetain).

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

type GpuTextureMock = {
  format: string;
  createView: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
};

/** Structural stand-in for `GPUTextureViewDescriptor`, which is not ambient in node/vitest. */
type ViewDesc = {
  dimension?: string;
  baseMipLevel?: number;
  mipLevelCount?: number;
  baseArrayLayer?: number;
  arrayLayerCount?: number;
};

function makeCache(): {
  textures: GPUTextureResourceCache;
  device: GPUDevice;
  gpuTextures: GpuTextureMock[];
} {
  const gpuTextures: GpuTextureMock[] = [];
  const device = {
    createTexture: vi.fn((desc: { format: string }) => {
      const gpuTexture: GpuTextureMock = {
        format: desc.format,
        createView: vi.fn((vdesc: ViewDesc) => ({ vdesc })),
        destroy: vi.fn(),
      };
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
  // Drop fallback setup traffic: only the tested upload's textures/views must be asserted.
  gpuTextures.length = 0;
  vi.mocked(device.createTexture).mockClear();
  vi.mocked(device.queue.submit).mockClear();
  vi.mocked(device.queue.copyExternalImageToTexture).mockClear();
  return { textures, device, gpuTextures };
}

function makeArray(generateMipmaps: boolean): TextureArray {
  const img = { width: 4, height: 4 } as ImageBitmap;
  return {
    isTextureArray: true,
    isLoaded: true,
    image: img,
    images: [img, img, img],
    generateMipmaps,
    needsUpdate: false,
  } as unknown as TextureArray;
}

const QUALITY_MIPS = { mipmapping: true } as QualityConfig;

const viewCalls = (gpu: GpuTextureMock): ViewDesc[] =>
  vi.mocked(gpu.createView).mock.calls.map((c) => c[0] as ViewDesc);

const view2d = (gpu: GpuTextureMock): ViewDesc[] =>
  viewCalls(gpu).filter((d) => d.dimension === "2d");

describe("GPUTextureResourceCache: texture-array mip chain (K04)", () => {
  it("creates the array with a full mip level count and downsamples per layer via 2D views", () => {
    const { textures, device, gpuTextures } = makeCache();
    const tex = makeArray(true);

    textures.getTextureView(tex, QUALITY_MIPS);

    // Upload happened (3 layers copied), and the texture was created with the FULL chain.
    expect(vi.mocked(device.queue.copyExternalImageToTexture)).toHaveBeenCalledTimes(3);
    const desc = vi.mocked(device.createTexture).mock.calls[0]![0] as {
      size: number[];
      mipLevelCount: number;
    };
    expect(desc.size).toEqual([4, 4, 3]);
    // K04 regression: pre-fix this was hard-coded to 1 (LOD-0-only, aliased).
    expect(desc.mipLevelCount).toBe(3);

    // Mip pass ran exactly once; per (layer, level) a src+dst 2D view pair was created.
    expect(vi.mocked(device.queue.submit)).toHaveBeenCalledTimes(1);
    const gpu = gpuTextures[0]!;
    const pair = view2d(gpu);
    expect(pair).toHaveLength(3 * 2 * 2); // 3 layers x 2 generated levels x (src+dst)
    for (const layer of [0, 1, 2]) {
      for (const level of [1, 2]) {
        // Source view reads the previous level of THIS layer only.
        expect(pair).toContainEqual({
          dimension: "2d",
          baseMipLevel: level - 1,
          mipLevelCount: 1,
          baseArrayLayer: layer,
          arrayLayerCount: 1,
        });
        // Destination view writes THIS level of THIS layer only.
        expect(pair).toContainEqual({
          dimension: "2d",
          baseMipLevel: level,
          mipLevelCount: 1,
          baseArrayLayer: layer,
          arrayLayerCount: 1,
        });
      }
    }
    // The bindable view is the full array (2d-array), as before K04.
    expect(viewCalls(gpu).filter((d) => d.dimension === "2d-array")).toHaveLength(1);
  });

  it("keeps the array at mipLevelCount 1 and runs no mip pass when the chain is disabled", () => {
    const { textures, device, gpuTextures } = makeCache();
    const tex = makeArray(false); // generateMipmaps off

    textures.getTextureView(tex, QUALITY_MIPS);

    const desc = vi.mocked(device.createTexture).mock.calls[0]![0] as {
      mipLevelCount: number;
    };
    expect(desc.mipLevelCount).toBe(1);
    expect(vi.mocked(device.queue.submit)).not.toHaveBeenCalled();
    const gpu = gpuTextures[0]!;
    // Only the full-array bindable view exists -- no per-layer 2D downsample views.
    expect(view2d(gpu)).toHaveLength(0);
  });

  it("honours quality.mipmapping=false for arrays, same as the single-image path", () => {
    const { textures, device, gpuTextures } = makeCache();
    const tex = makeArray(true);

    textures.getTextureView(tex, { mipmapping: false } as QualityConfig);

    const desc = vi.mocked(device.createTexture).mock.calls[0]![0] as {
      mipLevelCount: number;
    };
    expect(desc.mipLevelCount).toBe(1);
    expect(vi.mocked(device.queue.submit)).not.toHaveBeenCalled();
    expect(view2d(gpuTextures[0]!)).toHaveLength(0);
  });
});
