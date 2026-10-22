import "../../src/index.js";
import { createDefaultRendererContext } from "../../src/interfaces/index.js";
import { describe, expect, it, vi } from "vitest";
import { WebGPURenderer } from "../../src/renderers/WebGPU/WebGPURenderer.js";
import { GPUFallbackResources } from "../../src/renderers/WebGPU/managers/GPUFallbackResources.js";
import { GlobalUniformWriter } from "../../src/renderers/WebGPU/managers/GlobalUniformWriter.js";
import { GPURenderTargetCache } from "../../src/renderers/WebGPU/managers/GPURenderTargetCache.js";
import { OpaqueCapture } from "../../src/renderers/WebGPU/managers/OpaqueCapture.js";
import { GPUTextureResourceCache } from "../../src/renderers/WebGPU/managers/GPUTextureResourceCache.js";
import { GPUPipelineCache } from "../../src/renderers/WebGPU/managers/GPUPipelineCache.js";
import { GPUObjectRingBuffer } from "../../src/renderers/WebGPU/managers/GPUObjectRingBuffer.js";
import { GPUGeometryCache } from "../../src/renderers/WebGPU/managers/GPUGeometryCache.js";
import { RenderTarget } from "../../src/core/textures/index.js";
import { CascadedShadowPassGPU } from "../../src/renderers/passes/CascadedShadowPassGPU.js";
import { ShaderRegistry } from "../../src/renderers/shaders/ShaderRegistry.js";
import type { RenderManifest } from "../../src/renderers/shaders/RenderManifest.js";
import { Object3D } from "../../src/core/Object3D.js";
import { Scene } from "../../src/core/Scene.js";
import { Vector3D, Matrix4 } from "../../src/math/index.js";
import { BoundingSphere } from "../../src/physix/index.js";

const testShaderRegistry = new ShaderRegistry();

// Node/vitest has no WebGPU global; @webgpu/types only provides ambient TS types, not a runtime
// value. Stub the bit-flag constants the code under test actually reads.
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Internals = any;

function makeMockDevice(): GPUDevice {
  return {
    createBuffer: vi.fn(() => ({
      destroy: vi.fn(),
      getMappedRange: () => new ArrayBuffer(256),
      unmap: vi.fn(),
    })),
    createBindGroup: vi.fn(() => ({})),
    createBindGroupLayout: vi.fn(() => ({})),
    createShaderModule: vi.fn(() => ({
      getCompilationInfo: () => Promise.resolve({ messages: [] }),
    })),
    createPipelineLayout: vi.fn((desc: { bindGroupLayouts: unknown[] }) => ({
      bindGroupLayouts: desc.bindGroupLayouts,
    })),
    createRenderPipeline: vi.fn((desc: { layout: { bindGroupLayouts: unknown[] } }) => ({
      layout: desc.layout,
      getBindGroupLayout: vi.fn(() => ({})),
    })),
    createSampler: vi.fn(() => ({})),
    createTexture: vi.fn((desc: { format: string; usage: number }) => ({
      format: desc.format,
      usage: desc.usage,
      createView: vi.fn(() => ({})),
      destroy: vi.fn(),
    })),
    queue: { writeBuffer: vi.fn(), writeTexture: vi.fn(), copyExternalImageToTexture: vi.fn() },
    limits: { minUniformBufferOffsetAlignment: 256 },
  } as unknown as GPUDevice;
}

function makeRenderer(): { renderer: Internals; device: GPUDevice } {
  const device = makeMockDevice();
  const renderer = new WebGPURenderer({
    ...createDefaultRendererContext(),
    shaderRegistry: testShaderRegistry,
  }) as Internals;
  renderer._device = device;
  renderer._format = "bgra8unorm";
  renderer._fallback = new GPUFallbackResources(device);
  renderer._textures = new GPUTextureResourceCache(device, renderer._fallback);
  renderer._globalBGL = { mock: "globalBGL" };
  renderer._objectBGL = { mock: "objectBGL" };
  renderer._viewBGL = { mock: "viewBGL" };
  renderer._pipelineCache = new GPUPipelineCache(
    device,
    renderer.context.deviceCaps,
    renderer._globalBGL,
    renderer._objectBGL,
    renderer._viewBGL,
    renderer.context.shaderRegistry,
  );
  renderer._objectRing = new GPUObjectRingBuffer(device, renderer._objectBGL);
  renderer._geometryCache = new GPUGeometryCache(device);
  renderer._opaqueCapture = new OpaqueCapture(device, renderer._fallback);
  renderer._globalUniformWriter = new GlobalUniformWriter(renderer);
  renderer._targetCache = new GPURenderTargetCache(device, renderer._textures);
  renderer._viewUniformBuffer = { mock: "viewUniformBuffer" };
  renderer._viewBindGroup = { mock: "viewBindGroup" };
  renderer._viewUniformStride = 256;
  vi.mocked(device.queue.writeBuffer).mockClear();
  vi.mocked(device.queue.writeTexture).mockClear();
  return { renderer, device };
}

const SHADER_ID = "test/offscreen-target-format-shader";

function registerTestShader(): void {
  if (testShaderRegistry.get(SHADER_ID)) return;
  testShaderRegistry.register({
    id: SHADER_ID,
    sources: { wgsl: "@vertex fn vs() -> Out { var o: Out; return o; }" },
    layout: { uniforms: {}, uniformLayout: [], textures: {} },
  });
}

function makeManifest(): RenderManifest {
  return { shaderId: SHADER_ID, properties: {}, textures: {} };
}

describe("WebGPURenderer.currentColorTargetFormat", () => {
  registerTestShader();

  it("targets the swapchain format when post-processing is off and nothing is offscreen", () => {
    const { renderer } = makeRenderer();
    renderer.postProcessing = { enabled: false };
    expect(renderer.currentColorTargetFormat).toBe("bgra8unorm");
  });

  it("targets the HDR intermediate buffer format when post-processing is on and nothing is offscreen", () => {
    const { renderer } = makeRenderer();
    renderer.postProcessing = { enabled: true };
    expect(renderer.currentColorTargetFormat).toBe("rgba16float");
  });

  it("targets the swapchain format for a custom RenderTarget even while post-processing is on", () => {
    // This is the regression: a custom offscreen RenderTarget's backing texture is always
    // created with `_format` (see WebGPURenderer.render()'s offscreen branch), regardless of
    // postProcessing.enabled -- only the main scene pass without an active render target uses
    // the "rgba16float" HDR intermediate buffer. Before the fix, this getter's logic (inlined at
    // the one call site) used `postProcessing.enabled` alone, which built a pipeline for the
    // wrong format whenever something rendered into a custom RenderTarget (e.g.
    // `PlanarReflectionNode.updateReflection()`), and WebGPU rejects that as an
    // attachment-state mismatch (the whole command buffer is silently dropped).
    const { renderer } = makeRenderer();
    renderer.postProcessing = { enabled: true };
    const target = RenderTarget.create({ width: 256, height: 256 });
    renderer.setRenderTarget(target);
    expect(renderer.currentColorTargetFormat).toBe("bgra8unorm");
  });

  it("targets the swapchain format for a custom RenderTarget when post-processing is off too", () => {
    const { renderer } = makeRenderer();
    renderer.postProcessing = { enabled: false };
    const target = RenderTarget.create({ width: 256, height: 256 });
    renderer.setRenderTarget(target);
    expect(renderer.currentColorTargetFormat).toBe("bgra8unorm");
  });

  it("_renderSubgroup requests a pipeline in the format matching the currently active target, not just postProcessing.enabled", () => {
    const { renderer } = makeRenderer();
    renderer.postProcessing = { enabled: true };
    const obj = new Object3D("A");
    obj.geometry = {
      vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      getBoundingVolume: (): never => {
        throw new Error("not used in this test");
      },
    };
    const rp = {
      setPipeline: vi.fn(),
      setBindGroup: vi.fn(),
      setVertexBuffer: vi.fn(),
      draw: vi.fn(),
      drawIndexed: vi.fn(),
    } as unknown as GPURenderPassEncoder;

    // Main scene context: no active render target.
    renderer._renderSubgroup(rp, [obj], false, "matA", makeManifest(), 0);
    const mainPipeline = (rp.setPipeline as ReturnType<typeof vi.fn>).mock.calls[0]![0];

    // Offscreen context: a custom RenderTarget is active, postProcessing is still enabled.
    const target = RenderTarget.create({ width: 256, height: 256 });
    renderer.setRenderTarget(target);
    renderer._renderSubgroup(rp, [obj], false, "matA", makeManifest(), 0);
    const offscreenPipeline = (rp.setPipeline as ReturnType<typeof vi.fn>).mock.calls[1]![0];

    // Same manifest/material/topology in both calls -- the ONLY thing that differs is the
    // target format, so these must be two distinct cached pipelines, not the same one reused.
    expect(offscreenPipeline).not.toBe(mainPipeline);
  });
});

describe("Shadow passes' dummy color attachment tracks the active target's format", () => {
  function makeCaster(): Object3D {
    const obj = new Object3D("caster");
    obj.castShadow = true;
    obj.bounds = new BoundingSphere(new Vector3D(0, 0, 0), 0.1);
    return obj;
  }

  function makeMockShadowRenderer(colorTargetFormat: string): Internals {
    const device = {
      createTexture: vi.fn((desc: { format: string; size: number[] }) => ({
        format: desc.format,
        width: desc.size[0],
        depthOrArrayLayers: desc.size[2] ?? 1,
        createView: vi.fn(() => ({})),
      })),
      queue: { writeBuffer: vi.fn() },
    };
    const identityVp = new Matrix4().data;
    const dLight: Internals = {
      castShadow: true,
      numCascades: 1,
      shadowResolution: 256,
      cascadeCameras: [{ viewProjectionMatrix: identityVp, viewMatrix: identityVp }],
      cascadeSplits: [1.0],
      shadowBias: 0.001,
      shadowNormalBias: 0.002,
    };

    return {
      extractLights: vi.fn(() => ({ dLight })),
      gpuDevice: device,
      postProcessing: { enabled: true },
      gpuFormat: "bgra8unorm",
      currentColorTargetFormat: colorTargetFormat,
      deferDestroyTexture: vi.fn(),
      context: { shaderRegistry: new ShaderRegistry() },
      shadowMaps: new Map(),
      defaultDirShadowTextureView: {},
      dummyDirShadowTextureView: {},
      defaultSpotShadowTextureView: {},
      dummySpotShadowTextureView: {},
      defaultEVSMTextureView: {},
      dummyEVSMTextureView: {},
      evsmSampler: {},
      quality: {},
      _createGlobalBindGroup: vi.fn(() => ({})),
      _setViewMatrix: vi.fn(() => 0),
      _renderSubgroup: vi.fn(),
      scratchGlobalBufferData: new Float32Array(216),
      globalUniformBuffer: {},
      globalBindGroup: undefined,
    };
  }

  function makeMockScene(objects: Object3D[]): Internals {
    return {
      getVisibleObjectsSorted: vi.fn(() => ({
        opaqueBatches: [{ shaderId: "test-batch", objects, topology: undefined }],
      })),
    };
  }

  it("creates one dummy view per format instead of caching a single one forever", () => {
    // The regression this covers: the pass used to create its dummy color attachment ONCE
    // (`if (!this._dummyTargetView)`), fixed at whichever format `postProcessing.enabled` implied
    // at that first call. `_renderSubgroup`'s pipeline is built fresh from
    // `currentColorTargetFormat` every call, so once that getter became context-aware (main pass
    // vs. a `PlanarReflectionNode` sub-render), the single cached dummy silently mismatched
    // whichever context didn't match its first-ever caller -- an attachment-state mismatch
    // WebGPU rejects outright.
    const caster = makeCaster();
    const pass = new CascadedShadowPassGPU() as Internals;
    const ce = { beginRenderPass: vi.fn(() => ({ setBindGroup: vi.fn(), end: vi.fn() })) };

    // Only the dummy color attachment's own creation calls matter here -- `execute()` also
    // creates the actual depth32float shadow-map `fbo` once (unrelated to this bug), so filter
    // calls down to ones matching the dummy's 2D single-layer color-texture shape.
    const dummyCreations = (renderer: Internals): unknown[][] =>
      (renderer.gpuDevice.createTexture as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call: Internals) => call[0].format !== "depth32float",
      );

    const mainRenderer = makeMockShadowRenderer("rgba16float");
    pass.execute(
      mainRenderer,
      makeMockScene([caster]),
      ce,
      {},
      new Float32Array(16),
      new Vector3D(),
    );
    expect(dummyCreations(mainRenderer)).toHaveLength(1);
    expect(dummyCreations(mainRenderer)[0]![0]).toMatchObject({ format: "rgba16float" });

    // Same pass INSTANCE, now in an offscreen (e.g. reflection sub-render) context.
    const offscreenRenderer = makeMockShadowRenderer("bgra8unorm");
    pass.execute(
      offscreenRenderer,
      makeMockScene([caster]),
      ce,
      {},
      new Float32Array(16),
      new Vector3D(),
    );
    expect(dummyCreations(offscreenRenderer)).toHaveLength(1);
    expect(dummyCreations(offscreenRenderer)[0]![0]).toMatchObject({ format: "bgra8unorm" });

    // Going back to the first format must reuse the cached view, not recreate it a third time.
    pass.execute(
      mainRenderer,
      makeMockScene([caster]),
      ce,
      {},
      new Float32Array(16),
      new Vector3D(),
    );
    expect(dummyCreations(mainRenderer)).toHaveLength(1);
  });
});

describe("WebGPURenderer.render(): custom RenderTarget's own depth texture usage flags", () => {
  it("includes COPY_SRC, matching the main canvas depth texture, so captureOpaqueDepth() can copy from it", () => {
    // The regression this covers: a custom RenderTarget's depth texture (created lazily inside
    // render()'s offscreen branch) was missing GPUTextureUsage.COPY_SRC -- unlike the main
    // canvas's own `_depthTexture`, which has always included it. Any scene with a transparent
    // object rendered into that custom RenderTarget (e.g. a `PlanarReflectionNode` sub-render)
    // then hit `captureOpaqueDepth()`'s `copyTextureToTexture`, which WebGPU rejects outright
    // when the source texture's usage doesn't include COPY_SRC.
    const { renderer, device } = makeRenderer();
    renderer.postProcessing = { enabled: false, get: vi.fn(() => undefined) };
    renderer._context = {
      canvas: { width: 64, height: 64 },
      getCurrentTexture: vi.fn(() => ({ createView: vi.fn(() => ({})) })),
    };
    renderer._passes = [];
    renderer._objectRing.beginFrame();
    device.createCommandEncoder = vi.fn(() => ({
      finish: vi.fn(() => ({})),
    })) as unknown as GPUDevice["createCommandEncoder"];
    (device.queue as unknown as { submit: ReturnType<typeof vi.fn> }).submit = vi.fn();

    const target = RenderTarget.create({ width: 128, height: 128, depth: true });
    renderer.setRenderTarget(target);

    const scene = new Scene();
    renderer.render(scene, new Float32Array(16), new Vector3D());

    // `createTexture` is also called for various fallback/dummy 1x1 textures during renderer
    // construction (GPUFallbackResources etc.), which are irrelevant here -- identify our own
    // RenderTarget's depth texture by its distinctive 128x128 size instead of format alone.
    const depthTextureCall = (device.createTexture as ReturnType<typeof vi.fn>).mock.calls.find(
      ([desc]) => desc.format === "depth32float" && desc.size?.[0] === 128,
    );
    expect(depthTextureCall).toBeDefined();
    const usage = depthTextureCall![0].usage as number;
    const COPY_SRC = (globalThis as unknown as { GPUTextureUsage: Record<string, number> })
      .GPUTextureUsage["COPY_SRC"]!;
    expect(usage & COPY_SRC).toBe(COPY_SRC);
  });
});

describe("WebGPURenderer.captureOpaqueTexture() and captureOpaqueDepth() format validation", () => {
  it("recreates cached opaque texture when source format changes (e.g. bgra8unorm to rgba16float HDR)", () => {
    const { renderer, device } = makeRenderer();
    const ce = {
      copyTextureToTexture: vi.fn(),
    } as unknown as GPUCommandEncoder;

    const bgraTex = {
      width: 100,
      height: 100,
      format: "bgra8unorm" as GPUTextureFormat,
      createView: vi.fn(() => ({})),
      destroy: vi.fn(),
    } as unknown as GPUTexture;

    // Capture first with bgra8unorm
    renderer.captureOpaqueTexture(ce, bgraTex);
    expect(device.createTexture).toHaveBeenCalledWith(
      expect.objectContaining({
        size: [100, 100, 1],
        format: "bgra8unorm",
      }),
    );

    const hdrTex = {
      width: 100,
      height: 100,
      format: "rgba16float" as GPUTextureFormat,
      createView: vi.fn(() => ({})),
      destroy: vi.fn(),
    } as unknown as GPUTexture;

    // Capture next with rgba16float (same dimensions)
    renderer.captureOpaqueTexture(ce, hdrTex);
    expect(device.createTexture).toHaveBeenCalledWith(
      expect.objectContaining({
        size: [100, 100, 1],
        format: "rgba16float",
      }),
    );
  });

  it("recreates cached opaque depth texture when depth format changes", () => {
    const { renderer, device } = makeRenderer();
    const ce = {
      copyTextureToTexture: vi.fn(),
    } as unknown as GPUCommandEncoder;

    renderer._depthTexture = {
      width: 100,
      height: 100,
      format: "depth24plus" as GPUTextureFormat,
      createView: vi.fn(() => ({})),
      destroy: vi.fn(),
    } as unknown as GPUTexture;

    renderer.captureOpaqueDepth(ce);
    expect(device.createTexture).toHaveBeenCalledWith(
      expect.objectContaining({
        size: [100, 100, 1],
        format: "depth24plus",
      }),
    );

    renderer._depthTexture = {
      width: 100,
      height: 100,
      format: "depth32float" as GPUTextureFormat,
      createView: vi.fn(() => ({})),
      destroy: vi.fn(),
    } as unknown as GPUTexture;

    renderer.captureOpaqueDepth(ce);
    expect(device.createTexture).toHaveBeenCalledWith(
      expect.objectContaining({
        size: [100, 100, 1],
        format: "depth32float",
      }),
    );
  });

  it("resolves activeColorTexture and activeDepthTexture correctly for offscreen RenderTargets", () => {
    const { renderer } = makeRenderer();
    const rt = RenderTarget.create({ width: 256, height: 256 });
    const mockRtTex = { mock: "rtTex" } as unknown as GPUTexture;
    const mockRtDepth = { mock: "rtDepth" } as unknown as GPUTexture;
    const mockRtView = { mock: "rtView" } as unknown as GPUTextureView;

    renderer._targetCache.renderTargetTextures.set(rt, {
      tex: mockRtTex,
      view: mockRtView,
      depth: mockRtDepth,
      depthView: { mock: "rtDepthView" } as unknown as GPUTextureView,
    });

    renderer.setRenderTarget(rt);
    expect(renderer.activeColorTexture).toBe(mockRtTex);
    expect(renderer.activeDepthTexture).toBe(mockRtDepth);

    // When no render target is set, falls back to HDR texture or context
    renderer.setRenderTarget(null);
    renderer.postProcessing.enabled = true;
    const mockHdrTex = { mock: "hdrTex" } as unknown as GPUTexture;
    renderer._hdrTexture = mockHdrTex;
    expect(renderer.activeColorTexture).toBe(mockHdrTex);

    renderer.postProcessing.enabled = false;
    renderer._hdrTexture = undefined;
    const mockCanvasTex = { mock: "canvasTex" } as unknown as GPUTexture;
    renderer._context = {
      getCurrentTexture: vi.fn(() => mockCanvasTex),
    };
    expect(renderer.activeColorTexture).toBe(mockCanvasTex);
    expect(renderer._context.getCurrentTexture).toHaveBeenCalledTimes(1);
  });
});
