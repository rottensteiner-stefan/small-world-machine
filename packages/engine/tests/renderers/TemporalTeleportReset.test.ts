import { describe, expect, it, vi } from "vitest";
import "../../src/index.js";
import { PostProcessingEffectType } from "../../src/enums/index.js";
import { HistoryBlendPassGPU } from "../../src/renderers/post/passes/HistoryBlendPassGPU.js";
import { HistoryBlendPassGL } from "../../src/renderers/post/passes/HistoryBlendPassGL.js";
import { VolumetricFogPassGPU } from "../../src/renderers/post/passes/VolumetricFogPassGPU.js";
import { PostFxChain } from "../../src/renderers/WebGPU/managers/PostFxChain.js";
import { GLPostEffects } from "../../src/renderers/post/passes/GLPostEffects.js";
import { WebGPURenderer } from "../../src/renderers/WebGPU/WebGPURenderer.js";
import { ShaderRegistry } from "../../src/renderers/shaders/ShaderRegistry.js";
import type { PostEffectPass } from "../../src/renderers/post/PostEffectPass.js";
import type { GLPostEffectPass } from "../../src/renderers/post/passes/GLPostEffectPass.js";

// Node/vitest has no WebGPU global -- stub the bit-flag constants the pass constructors read.
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
(globalThis as unknown as { GPUTextureUsage: Record<string, number> }).GPUTextureUsage ??= {
  COPY_SRC: 0x01,
  COPY_DST: 0x02,
  TEXTURE_BINDING: 0x04,
  STORAGE_BINDING: 0x08,
  RENDER_ATTACHMENT: 0x10,
};
(globalThis as unknown as { GPUMapMode: Record<string, number> }).GPUMapMode ??= {
  READ: 0x1,
  WRITE: 0x2,
};

/**
 * S3 DP-4A pass-level coverage: `notifyCameraTeleport()` fans out to the TAA history
 * (`HistoryBlendPassGPU`/`HistoryBlendPassGL`), the volumetric-fog history
 * (`VolumetricFogPassGPU`) and occlusion state. This file pins the HISTORY side -- each temporal
 * pass must be able to drop its history synchronously and idempotently, and the two registry
 * iterators (`PostFxChain.resetHistory` (WebGPU) / `GLPostEffects.resetHistory` (WebGL2)) must
 * call the optional hook where present and tolerate its absence (WebGL1 registers no temporal
 * pass -> honest no-op, ADR 0043).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Internals = any;

function makeGpuDevice(): Internals {
  return {
    createSampler: vi.fn(() => ({})),
    createBuffer: vi.fn((desc: { size: number }) => ({ size: desc.size, destroy: vi.fn() })),
    createBindGroupLayout: vi.fn(() => ({})),
    createPipelineLayout: vi.fn(() => ({})),
    createShaderModule: vi.fn(() => ({})),
    createRenderPipeline: vi.fn(() => ({})),
    createComputePipeline: vi.fn(() => ({})),
    createTexture: vi.fn(() => ({ createView: vi.fn(() => ({})), destroy: vi.fn() })),
    createBindGroup: vi.fn(() => ({})),
    queue: { writeBuffer: vi.fn() },
    beginRenderPass: vi.fn(() => ({
      setPipeline: vi.fn(),
      setBindGroup: vi.fn(),
      draw: vi.fn(),
      end: vi.fn(),
    })),
  };
}

function makeGl2(): Internals {
  return {
    createShader: (): WebGLShader => ({}),
    shaderSource: (): void => {},
    compileShader: (): void => {},
    getShaderParameter: (): boolean => true,
    getShaderInfoLog: (): string => "",
    createProgram: (): WebGLProgram => ({}),
    attachShader: (): void => {},
    linkProgram: (): void => {},
    getProgramParameter: (): boolean => true,
    getProgramInfoLog: (): string => "",
    deleteShader: (): void => {},
    deleteProgram: (): void => {},
    getUniformLocation: (): WebGLUniformLocation | null => ({}),
    createVertexArray: (): WebGLVertexArrayObject | null => ({}),
    bindVertexArray: (): void => {},
    useProgram: (): void => {},
    bindFramebuffer: (): void => {},
    Framebuffer: 0,
    createFramebuffer: (): WebGLFramebuffer => ({}),
    deleteFramebuffer: (): void => {},
    TEXTURE_2D: 0x0de1,
    TEXTURE0: 0x84c0,
    TEXTURE1: 0x84c1,
    TRIANGLES: 4,
    COLOR_BUFFER_BIT: 16384,
    MAX_FRAGMENT_UNIFORM_VECTORS: 0x8dfd,
    getParameter: () => 1024,
  };
}

describe("HistoryBlendPassGPU.resetHistory (S3 DP-4A, TAA WebGPU tier)", () => {
  it("drops the history flag and resets parity synchronously", () => {
    const pass = new HistoryBlendPassGPU(makeGpuDevice() as unknown as GPUDevice);
    const internals = pass as unknown as { _hasHistory: boolean; _parity: number };
    internals._hasHistory = true;
    internals._parity = 1;

    pass.resetHistory();

    expect(internals._hasHistory).toBe(false);
    expect(internals._parity).toBe(0);
  });

  it("is idempotent", () => {
    const pass = new HistoryBlendPassGPU(makeGpuDevice() as unknown as GPUDevice);
    expect(() => pass.resetHistory()).not.toThrow();
    expect(() => pass.resetHistory()).not.toThrow();
  });
});

describe("HistoryBlendPassGL.resetHistory (S3 DP-4A, TAA WebGL2 tier)", () => {
  it("drops the history flag and resets parity synchronously", () => {
    const pass = new HistoryBlendPassGL(makeGl2() as unknown as WebGL2RenderingContext);
    const internals = pass as unknown as { _hasHistory: boolean; _parity: number };
    internals._hasHistory = true;
    internals._parity = 1;

    pass.resetHistory();

    expect(internals._hasHistory).toBe(false);
    expect(internals._parity).toBe(0);
  });

  it("is idempotent", () => {
    const pass = new HistoryBlendPassGL(makeGl2() as unknown as WebGL2RenderingContext);
    expect(() => pass.resetHistory()).not.toThrow();
  });
});

describe("VolumetricFogPassGPU.resetHistory (S3 DP-4A, fog WebGPU tier)", () => {
  it("drops the history gate so the next execute integrates fresh", () => {
    const pass = new VolumetricFogPassGPU(makeGpuDevice() as unknown as GPUDevice);
    const internals = pass as unknown as { _hasHistory: boolean };
    internals._hasHistory = true;

    pass.resetHistory();

    expect(internals._hasHistory).toBe(false);
  });

  it("is idempotent", () => {
    const pass = new VolumetricFogPassGPU(makeGpuDevice() as unknown as GPUDevice);
    expect(() => pass.resetHistory()).not.toThrow();
  });
});

describe("PostFxChain.resetHistory (WebGPU registry fan-out)", () => {
  it("calls resetHistory on every registered pass that implements it", () => {
    const chain = new PostFxChain(new WebGPURenderer());
    const withReset = {
      execute: vi.fn(() => null),
      destroy: vi.fn(),
      resetHistory: vi.fn(),
    } as unknown as PostEffectPass;
    const withoutReset = {
      execute: vi.fn(() => null),
      destroy: vi.fn(),
    } as unknown as PostEffectPass;
    (chain as unknown as { _passes: Map<PostProcessingEffectType, PostEffectPass> })._passes.set(
      PostProcessingEffectType.TAA,
      withReset,
    );
    (chain as unknown as { _passes: Map<PostProcessingEffectType, PostEffectPass> })._passes.set(
      PostProcessingEffectType.MOTION_TRAIL,
      withoutReset,
    );

    chain.resetHistory();

    expect(withReset.resetHistory).toHaveBeenCalledTimes(1);
    expect(withoutReset).toBeDefined(); // the non-temporal pass is simply skipped, no crash
  });

  it("is safe on an empty registry", () => {
    const chain = new PostFxChain(new WebGPURenderer());
    expect(() => chain.resetHistory()).not.toThrow();
  });
});

describe("GLPostEffects.resetHistory (WebGL2 registry fan-out)", () => {
  it("calls resetHistory on registered GL passes that implement it and skips others (honest WebGL1 no-op shape)", () => {
    const glPost = new GLPostEffects(
      makeGl2() as unknown as WebGL2RenderingContext,
      true,
      new ShaderRegistry(),
    );
    const withReset = {
      execute: vi.fn(() => null),
      destroy: vi.fn(),
      resetHistory: vi.fn(),
    } as unknown as GLPostEffectPass;
    const withoutReset = {
      execute: vi.fn(() => null),
      destroy: vi.fn(),
    } as unknown as GLPostEffectPass;
    (glPost as unknown as { _passes: Map<PostProcessingEffectType, GLPostEffectPass> })._passes.set(
      PostProcessingEffectType.TAA,
      withReset,
    );
    (glPost as unknown as { _passes: Map<PostProcessingEffectType, GLPostEffectPass> })._passes.set(
      PostProcessingEffectType.BLOOM,
      withoutReset,
    );

    glPost.resetHistory();

    expect(withReset.resetHistory).toHaveBeenCalledTimes(1);
    expect(withoutReset).toBeDefined();
  });
});
