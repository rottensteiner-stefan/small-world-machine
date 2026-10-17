import { describe, expect, it, vi } from "vitest";
import { VolumetricFogPassGPU } from "../../src/renderers/post/passes/VolumetricFogPassGPU.js";
import { VolumetricFogElement } from "../../src/renderers/post/elements/VolumetricFogElement.js";
import type { WebGPURenderer } from "../../src/renderers/WebGPU/WebGPURenderer.js";
import { Color } from "../../src/core/colors/index.js";
import { Vector3D } from "../../src/math/index.js";
import { createFrameInfo } from "../../src/interfaces/index.js";

// WebGPU is unavailable in the vitest node environment: polyfill the flag objects the pass reads.
type WebGpuConstScope = {
  GPUBufferUsage?: Record<string, number>;
  GPUShaderStage?: Record<string, number>;
  GPUTextureUsage?: Record<string, number>;
};
const wgpuScope = globalThis as unknown as WebGpuConstScope;
wgpuScope.GPUBufferUsage ??= { COPY_DST: 0x8, UNIFORM: 0x40, STORAGE: 0x80 };
wgpuScope.GPUShaderStage ??= { VERTEX: 0x1, FRAGMENT: 0x2, COMPUTE: 0x4 };
wgpuScope.GPUTextureUsage ??= {
  COPY_SRC: 0x01,
  COPY_DST: 0x02,
  TEXTURE_BINDING: 0x04,
  STORAGE_BINDING: 0x08,
  RENDER_ATTACHMENT: 0x10,
};

// FroxelUniforms layout (froxel_inject.wgsl): invView + 4 vec4 (32 floats), 16 FogVolumeData (32 floats
// each), then `scatterTint` (vec4), then 2 x 64 per-light scales, then the element-mask box (2 vec4).
const SCATTER_TINT_INDEX = 32 + 16 * 32;
const INJECT_UNIFORM_BYTES = (SCATTER_TINT_INDEX + 4 + 2 * 64 + 8) * 4;

interface Write {
  size: number;
  data: Float32Array;
}

/** Runs one pass execute with a mock device and returns the FroxelUniforms the injection pass received. */
function injectUniforms(configure: (element: VolumetricFogElement) => void): Float32Array {
  const writes: Write[] = [];
  const device = {
    createSampler: vi.fn(() => ({})),
    createBuffer: vi.fn((desc: { size: number }) => ({ size: desc.size, destroy: vi.fn() })),
    createBindGroupLayout: vi.fn(() => ({})),
    createPipelineLayout: vi.fn(() => ({})),
    createComputePipeline: vi.fn(() => ({})),
    createShaderModule: vi.fn(() => ({})),
    createRenderPipeline: vi.fn(() => ({})),
    createTexture: vi.fn(() => ({ createView: vi.fn(() => ({})), destroy: vi.fn() })),
    createBindGroup: vi.fn(() => ({})),
    queue: {
      writeBuffer: vi.fn((buffer: { size: number }, _offset: number, data: Float32Array): void => {
        writes.push({ size: buffer.size, data: Float32Array.from(data) });
      }),
      writeTexture: vi.fn(),
    },
  } as unknown as GPUDevice;

  const element = new VolumetricFogElement();
  element.enabled = true;
  configure(element);
  const renderer = {
    clusterDims: { x: 16, y: 16, z: 8 },
    frameInfo: createFrameInfo(),
    globalBGL: {},
    computeStructsChunk: "",
    globalBindGroup: {},
    defaultDirShadowTextureView: {},
  } as unknown as WebGPURenderer;
  const makePass = (): Record<string, ReturnType<typeof vi.fn>> => ({
    setPipeline: vi.fn(),
    setBindGroup: vi.fn(),
    dispatchWorkgroups: vi.fn(),
    draw: vi.fn(),
    end: vi.fn(),
  });
  const ce = {
    beginComputePass: vi.fn(makePass),
    beginRenderPass: vi.fn(makePass),
  } as unknown as GPUCommandEncoder;

  new VolumetricFogPassGPU(device).execute(
    renderer,
    ce,
    {} as GPUTextureView,
    320,
    200,
    new Float32Array(16),
    undefined,
    new Vector3D(0, 0, 0),
    0.1,
    100.0,
    undefined,
    element,
  );
  const inject = writes.find((w) => w.size === INJECT_UNIFORM_BYTES);
  if (!inject) throw new Error("No injection uniform write observed.");
  return inject.data;
}

describe("VolumetricFogPassGPU local light shadows", () => {
  it("defaults to on", () => {
    expect(new VolumetricFogElement().localLightShadows).toBe(true);
  });

  it("packs the localLightShadows flag into scatterTint.w", () => {
    expect(injectUniforms((e) => (e.localLightShadows = true))[SCATTER_TINT_INDEX + 3]).toBe(1);
    expect(injectUniforms((e) => (e.localLightShadows = false))[SCATTER_TINT_INDEX + 3]).toBe(0);
  });

  it("keeps the tint (color * scattering albedo) in scatterTint.rgb next to the flag", () => {
    const u = injectUniforms((e) => {
      e.color = new Color(1.0, 0.5, 0.25);
      e.scatteringAlbedo = 0.5;
    });
    expect(Array.from(u.slice(SCATTER_TINT_INDEX, SCATTER_TINT_INDEX + 3))).toEqual([
      0.5, 0.25, 0.125,
    ]);
    expect(u[SCATTER_TINT_INDEX + 3]).toBe(1);
  });
});
