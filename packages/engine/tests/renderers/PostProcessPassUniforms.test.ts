import { describe, expect, it, vi, beforeAll } from "vitest";
import { ShaderRegistry } from "../../src/renderers/shaders/ShaderRegistry.js";
import { PostProcessPass } from "../../src/renderers/passes/PostProcessPass.js";
import type { ToneMappingElement, VignetteElement, ColorGradingElement } from "../../src/index.js";
import { PostProcessingGroup } from "../../src/index.js";
import { PostProcessingEffectType } from "../../src/enums/index.js";
import { CoreShaderChunks } from "../../src/renderers/shaders/CoreShaderChunks.js";

const testShaderRegistry = new ShaderRegistry();

(globalThis as unknown as { GPUShaderStage: Record<string, number> }).GPUShaderStage ??= {
  VERTEX: 0x1,
  FRAGMENT: 0x2,
  COMPUTE: 0x4,
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PassInternals = any;

(globalThis as unknown as { GPUTextureUsage: Record<string, number> }).GPUTextureUsage ??= {
  COPY_SRC: 0x01,
  COPY_DST: 0x02,
  TEXTURE_BINDING: 0x04,
  STORAGE_BINDING: 0x08,
  RENDER_ATTACHMENT: 0x10,
};

function makeMockDevice(): {
  device: GPUDevice;
  renderPass: Record<string, ReturnType<typeof vi.fn>>;
} {
  const renderPass = {
    setPipeline: vi.fn(),
    setBindGroup: vi.fn(),
    draw: vi.fn(),
    end: vi.fn(),
  };
  const commandEncoder = { beginRenderPass: vi.fn(() => renderPass) };
  const device = {
    createSampler: vi.fn(() => ({})),
    createBuffer: vi.fn(() => ({})),
    createBindGroupLayout: vi.fn(() => ({})),
    createPipelineLayout: vi.fn(() => ({})),
    createShaderModule: vi.fn(() => ({})),
    createRenderPipeline: vi.fn(() => ({})),
    createBindGroup: vi.fn(() => ({})),
    createTexture: vi.fn(() => ({ createView: (): object => ({}), destroy: vi.fn() })),
    queue: { writeBuffer: vi.fn(), writeTexture: vi.fn() },
    __commandEncoder: commandEncoder,
  } as unknown as GPUDevice;
  return { device, renderPass };
}

function makeMockRenderer(device: GPUDevice, group: PostProcessingGroup): PassInternals {
  return {
    postProcessing: group,
    context: { shaderRegistry: new ShaderRegistry() },
    frameInfo: { time: 0, deltaTime: 0, realTime: 0, realDeltaTime: 0, frameIndex: 0 },
    hdrTextureView: {},
    motionTrailResolvedView: undefined,
    taaResolvedView: undefined,
    bloomTextureView: {},
    hbaoTextureView: {},
    whiteTextureView: {},
    gpuDevice: device,
    gpuFormat: "rgba8unorm",
    gpuCanvasContext: { getCurrentTexture: () => ({ createView: () => ({}) }) },
  };
}

function makeGroup(): PostProcessingGroup {
  const group = new PostProcessingGroup();
  group.enabled = true;
  group.loadConfig({
    effects: {
      toneMapping: { enabled: true, mode: 1, exposure: 1.0, gamma: 2.2 },
      vignette: { enabled: true, offset: 0.8, darkness: 0.5, roundness: 2.0 },
    },
  });
  return group;
}

describe("PostProcessPass: continuous tuning values never rebuild the pipeline", () => {
  beforeAll(async () => {
    await CoreShaderChunks.init(testShaderRegistry);
  });

  it("does not rebuild the pipeline when only continuous values change", () => {
    const { device } = makeMockDevice();
    const group = makeGroup();
    const renderer = makeMockRenderer(device, group);
    const pass = new PostProcessPass() as PassInternals;
    const ce = (device as PassInternals).__commandEncoder;

    pass.execute(renderer, {}, ce, {}, new Float32Array(16), { x: 0, y: 0, z: 0 });
    // 2 modules per build (vertex + fragment), 1 pipeline.
    expect(device.createShaderModule).toHaveBeenCalledTimes(2);
    expect(device.createRenderPipeline).toHaveBeenCalledTimes(1);

    const tm = group.get<ToneMappingElement>(PostProcessingEffectType.TONE_MAPPING)!;
    const vig = group.get<VignetteElement>(PostProcessingEffectType.VIGNETTE)!;
    tm.exposure = 3.5;
    vig.offset = 0.2;
    vig.darkness = 0.9;

    pass.execute(renderer, {}, ce, {}, new Float32Array(16), { x: 0, y: 0, z: 0 });
    expect(device.createShaderModule).toHaveBeenCalledTimes(2);
    expect(device.createRenderPipeline).toHaveBeenCalledTimes(1);
  });

  it("rebuilds the pipeline when a structural flag changes", () => {
    const { device } = makeMockDevice();
    const group = makeGroup();
    const renderer = makeMockRenderer(device, group);
    const pass = new PostProcessPass() as PassInternals;
    const ce = (device as PassInternals).__commandEncoder;

    pass.execute(renderer, {}, ce, {}, new Float32Array(16), { x: 0, y: 0, z: 0 });
    expect(device.createRenderPipeline).toHaveBeenCalledTimes(1);

    const vig = group.get<VignetteElement>(PostProcessingEffectType.VIGNETTE)!;
    vig.enabled = false;

    pass.execute(renderer, {}, ce, {}, new Float32Array(16), { x: 0, y: 0, z: 0 });
    expect(device.createRenderPipeline).toHaveBeenCalledTimes(2);
  });

  it("writes the current continuous values into the DynUniforms buffer every execute()", () => {
    const { device } = makeMockDevice();
    const group = makeGroup();
    const renderer = makeMockRenderer(device, group);
    const pass = new PostProcessPass() as PassInternals;
    const ce = (device as PassInternals).__commandEncoder;

    const tm = group.get<ToneMappingElement>(PostProcessingEffectType.TONE_MAPPING)!;
    const vig = group.get<VignetteElement>(PostProcessingEffectType.VIGNETTE)!;
    const grade = group.get<ColorGradingElement>(PostProcessingEffectType.COLOR_GRADING)!;
    tm.exposure = 2.5;
    vig.offset = 0.42;
    grade.enabled = true;
    grade.contrast = 1.2;
    grade.gain.set(0.9, 1.0, 1.1);

    pass.execute(renderer, {}, ce, {}, new Float32Array(16), { x: 0, y: 0, z: 0 });

    const calls = (device.queue.writeBuffer as ReturnType<typeof vi.fn>).mock.calls;
    const [buffer, offset, data] = calls[calls.length - 1]!;
    expect(buffer).toBeDefined();
    expect(offset).toBe(0);
    const d = data as Float32Array;
    expect(d.length).toBe(52);
    expect(d[1]).toBeCloseTo(2.5); // a.y: exposure
    expect(d[3]).toBeCloseTo(0.42); // a.w: vignetteOffset
    expect(d[11]).toBeCloseTo(1.1); // c.w: gainB
    expect(d[20]).toBeCloseTo(1.2); // grading0.x: contrast
    expect(d[30]).toBeCloseTo(0.9); // grading2.z: gainR
    expect(d[32]).toBeCloseTo(0.0); // singularityPos.x
    expect(d[33]).toBeCloseTo(0.0); // singularityPos.y
    expect(d[34]).toBeCloseTo(1.0); // singularityPos.z
    expect(d[35]).toBeCloseTo(0.03); // singularityPos.w: eventHorizonRadius
    expect(d[36]).toBeCloseTo(0.25); // lensingParams.x: strength
    expect(d[40]).toBeCloseTo(1.0); // flashParams.x: color.r (default, no FlashElement override)
    expect(d[43]).toBeCloseTo(0.0); // flashParams.w: intensity (default, no active flash)
    expect(d[44]).toBeCloseTo(1.0); // shaftsParams.x: intensity (default)
    expect(d[45]).toBeCloseTo(0.05); // shaftsParams.y: density (default)
    expect(d[46]).toBeCloseTo(0.0);
    expect(d[47]).toBeCloseTo(0.0);
    expect(d[48]).toBeCloseTo(1.0); // shaftsColor.r
    expect(d[49]).toBeCloseTo(0.95); // shaftsColor.g
    expect(d[50]).toBeCloseTo(0.85); // shaftsColor.b
  });

  it("rebuilds bind groups but NEVER rebuilds pipeline when only texture views change (BLK-R3)", () => {
    const { device } = makeMockDevice();
    const group = makeGroup();
    const renderer = makeMockRenderer(device, group);
    const pass = new PostProcessPass() as PassInternals;
    const ce = (device as PassInternals).__commandEncoder;

    // Frame 1
    pass.execute(renderer, {}, ce, {}, new Float32Array(16), { x: 0, y: 0, z: 0 });
    expect(device.createRenderPipeline).toHaveBeenCalledTimes(1);
    expect(device.createBindGroup).toHaveBeenCalledTimes(1);

    // Frame 2 with different texture views (e.g. dynamic bloom/hdr views)
    renderer.hdrTextureView = {};
    renderer.bloomTextureView = {};
    pass.execute(renderer, {}, ce, {}, new Float32Array(16), { x: 0, y: 0, z: 0 });

    // Pipeline must NOT be recompiled or recreated
    expect(device.createRenderPipeline).toHaveBeenCalledTimes(1);
    expect(device.createShaderModule).toHaveBeenCalledTimes(2); // Still only initial 2 modules
    // Bind group must be recreated with the new views
    expect(device.createBindGroup).toHaveBeenCalledTimes(2);
  });
});
