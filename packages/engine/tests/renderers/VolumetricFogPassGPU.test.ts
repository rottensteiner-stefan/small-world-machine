import { describe, expect, it, vi } from "vitest";
import { VolumetricFogPassGPU } from "../../src/renderers/post/passes/VolumetricFogPassGPU.js";
import { VolumetricFogElement } from "../../src/renderers/post/elements/VolumetricFogElement.js";
import { WebGPURenderer } from "../../src/renderers/WebGPU/WebGPURenderer.js";
import { DirectionalLight } from "../../src/core/lights/index.js";
import { FogVolume } from "../../src/core/objects/FogVolume.js";
import { VolumetricTexture } from "../../src/core/textures/index.js";
import { Color } from "../../src/core/colors/index.js";
import { Vector3D } from "../../src/math/index.js";
import { createFrameInfo, type FrameInfo } from "../../src/interfaces/index.js";

// WebGPU is unavailable in the vitest node environment, so the GPU flag objects the pass reads
// at pipeline build time are polyfilled to plain bit flags.
type WebGpuConstScope = {
  GPUBufferUsage?: Record<string, number>;
  GPUShaderStage?: Record<string, number>;
  GPUTextureUsage?: Record<string, number>;
};
const wgpuScope = globalThis as unknown as WebGpuConstScope;
wgpuScope.GPUBufferUsage ??= {
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
wgpuScope.GPUShaderStage ??= { VERTEX: 0x1, FRAGMENT: 0x2, COMPUTE: 0x4 };
wgpuScope.GPUTextureUsage ??= {
  COPY_SRC: 0x01,
  COPY_DST: 0x02,
  TEXTURE_BINDING: 0x04,
  STORAGE_BINDING: 0x08,
  RENDER_ATTACHMENT: 0x10,
};

// The strict floor the temporal filter's state machine enforces: the first rendered frame is
// unwarmed (history weight 0), the steady state (history present, weight 0.9 with jitter) is in
// effect from the next frame on. A golden capture must warm up at least this many frames before
// the frame it wants to record.
const MIN_WARM_UP_FRAMES = 1;
/** The 0.9 EMA weight, rounded through Float32Array exactly as the engine writes it to the uniform. */
const HISTORY_WEIGHT = new Float32Array([0.9])[0]!;
const STEP_FIXED_DT = 1 / 60;

/** Byte size of the reprojection uniform buffer (44 x f32) -- used to pick it out of the writes. */
const REPROJECT_UNIFORM_BYTES = 176;
/** Index of the history-weight float in FroxelReprojectSettings (see VolumetricFogPassGPU.ts:589). */
const WEIGHT_INDEX = 40;
/** First float index of the previous view-projection matrix in FroxelReprojectSettings. */
const PREV_VIEW_PROJ_INDEX = 16;
/** Float indices of the sub-voxel jitter in FroxelReprojectSettings. */
const JITTER_X_INDEX = 41;
const JITTER_Y_INDEX = 42;
const JITTER_Z_INDEX = 43;

/** Byte size of the injection uniform buffer: base + 16 volumes + scatterTint + 128 scales + mask box (8). */
const INJECT_UNIFORM_BYTES = (32 + 16 * 32 + 4 + 2 * 64 + 8) * 4;
/** Byte size of the integration uniform buffer (116 x f32 after the appended mask box). */
const INTEGRATE_UNIFORM_BYTES = 116 * 4;
/** Float offset of `scatterTint` in FroxelUniforms (right after the 16 FogVolumeData). */
const SCATTER_TINT_INDEX = 32 + 16 * 32;
/** Float offset of the element-mask box uniforms appended to FroxelUniforms. */
const ELEMENT_MASK_INDEX = SCATTER_TINT_INDEX + 4 + 2 * 64;
/** Float offset of the element-mask box uniforms appended to FroxelIntegrationSettings. */
const INTEGRATE_MASK_INDEX = 108;
/** First float index of the sun colour in FroxelIntegrationSettings. */
const SUN_COLOUR_INDEX = 32;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RendererInternals = any;

interface MockBuffer {
  id: number;
  size: number;
  destroy: () => void;
}

interface UniformWrite {
  buffer: MockBuffer;
  offset: number;
  data: Float32Array;
}

interface ComputePassMocks {
  setPipeline: ReturnType<typeof vi.fn>;
  setBindGroup: ReturnType<typeof vi.fn>;
  dispatchWorkgroups: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}

interface PassInternalsSnapshot {
  hasHistory: boolean;
  historyPingPong: boolean;
  prevViewProj: Float32Array;
}

interface FrameTrace {
  frameIndex: number;
  /** History weight actually uploaded to the reprojection uniform for this frame. */
  weight: number;
  prevViewProj: Float32Array;
  jitter: [number, number, number];
  /** The bind group the reproject pass dispatched against this frame (A = !ping-pong, B = ping-pong). */
  chosenReprojectBindGroup: unknown;
  internals: PassInternalsSnapshot;
}

function makeViewProj(seed: number): Float32Array {
  const m = new Float32Array(16);
  for (let i = 0; i < 16; i++) m[i] = seed * 1000 + i;
  return m;
}

function makeComputePassMocks(): ComputePassMocks {
  return {
    setPipeline: vi.fn(),
    setBindGroup: vi.fn(),
    dispatchWorkgroups: vi.fn(),
    end: vi.fn(),
  };
}

function makeDeviceMocks(): {
  device: GPUDevice;
  writes: UniformWrite[];
  createBindGroup: ReturnType<typeof vi.fn>;
  createBuffer: ReturnType<typeof vi.fn>;
  createTexture: ReturnType<typeof vi.fn>;
  writeTexture: ReturnType<typeof vi.fn>;
  createBindGroupLayout: ReturnType<typeof vi.fn>;
} {
  const writes: UniformWrite[] = [];
  let bufferSeq = 0;
  let textureSeq = 0;
  const createBindGroup = vi.fn((desc: unknown) => ({ desc }));
  const createBuffer = vi.fn((desc: { size: number }): MockBuffer => {
    return { id: bufferSeq++, size: desc.size, destroy: vi.fn() };
  });
  const createTexture = vi.fn(() => {
    const id = textureSeq++;
    return {
      id,
      createView: vi.fn(() => ({ textureId: id })),
      destroy: vi.fn(),
    };
  });
  const createBindGroupLayout = vi.fn(() => ({}));
  const writeTexture = vi.fn();
  const renderPassMocks = {
    setPipeline: vi.fn(),
    setBindGroup: vi.fn(),
    draw: vi.fn(),
    end: vi.fn(),
  };
  const device = {
    createSampler: vi.fn(() => ({})),
    createBuffer,
    createBindGroupLayout,
    createPipelineLayout: vi.fn(() => ({})),
    createComputePipeline: vi.fn(() => ({})),
    createShaderModule: vi.fn(() => ({})),
    createRenderPipeline: vi.fn(() => ({})),
    createTexture,
    createBindGroup,
    queue: {
      writeBuffer: vi.fn((buffer: MockBuffer, offset: number, data: Float32Array): void => {
        writes.push({ buffer, offset, data: Float32Array.from(data) });
      }),
      writeTexture,
    },
    beginRenderPass: vi.fn(() => renderPassMocks),
  } as unknown as GPUDevice;
  return {
    device,
    writes,
    createBindGroup,
    createBuffer,
    createTexture,
    writeTexture,
    createBindGroupLayout,
  };
}

interface PassScenario {
  pass: VolumetricFogPassGPU;
  frameInfo: FrameInfo;
  element: VolumetricFogElement;
  renderer: WebGPURenderer;
  depthView: GPUTextureView;
  camPos: Vector3D;
}

function createScenario(jitter = 0.25): { scenario: PassScenario; writes: UniformWrite[] } {
  const { device, writes } = makeDeviceMocks();
  const pass = new VolumetricFogPassGPU(device);
  const frameInfo = createFrameInfo();
  const element = new VolumetricFogElement();
  element.enabled = true;
  element.jitter = jitter;

  const renderer = {
    clusterDims: { x: 16, y: 16, z: 8 },
    frameInfo,
    globalBGL: {},
    computeStructsChunk: "",
    globalBindGroup: {},
    defaultDirShadowTextureView: {},
  } as unknown as WebGPURenderer;

  const scenario: PassScenario = {
    pass,
    frameInfo,
    element,
    renderer,
    depthView: {} as GPUTextureView,
    camPos: new Vector3D(0, 0, 0),
  };
  return { scenario, writes };
}

function lastReprojectWrite(writes: UniformWrite[]): Float32Array {
  let reproject: Float32Array | undefined;
  for (const w of writes) {
    if (w.buffer.size === REPROJECT_UNIFORM_BYTES) reproject = w.data;
  }
  if (!reproject) throw new Error("No reprojection uniform write observed for this frame.");
  return reproject;
}

/** Advances frameInfo exactly like SmallWorldMachine.step() does, then runs one full pass execute. */
function stepFrame(
  scenario: PassScenario,
  writes: UniformWrite[],
  viewProj: Float32Array,
): FrameTrace {
  scenario.frameInfo.frameIndex += 1;
  scenario.frameInfo.time += STEP_FIXED_DT;

  const computePasses: ComputePassMocks[] = [];
  const computePass = vi.fn((): ComputePassMocks => {
    const p = makeComputePassMocks();
    computePasses.push(p);
    return p;
  });
  const ce = {
    beginComputePass: computePass,
    beginRenderPass: vi.fn(() => ({
      setPipeline: vi.fn(),
      setBindGroup: vi.fn(),
      draw: vi.fn(),
      end: vi.fn(),
    })),
  };

  scenario.pass.execute(
    scenario.renderer,
    ce as unknown as GPUCommandEncoder,
    scenario.depthView,
    320,
    200,
    viewProj,
    undefined,
    scenario.camPos,
    0.1,
    100.0,
    undefined,
    scenario.element,
  );

  const repro = lastReprojectWrite(writes);
  const internals = scenario.pass as RendererInternals;
  const chosenReprojectBindGroup = computePasses[1]?.setBindGroup.mock.calls[0]?.[1];

  return {
    frameIndex: scenario.frameInfo.frameIndex,
    weight: repro[WEIGHT_INDEX] ?? 0,
    prevViewProj: Float32Array.from(repro.slice(PREV_VIEW_PROJ_INDEX, PREV_VIEW_PROJ_INDEX + 16)),
    jitter: [repro[JITTER_X_INDEX] ?? 0, repro[JITTER_Y_INDEX] ?? 0, repro[JITTER_Z_INDEX] ?? 0],
    chosenReprojectBindGroup,
    internals: {
      hasHistory: internals._hasHistory as boolean,
      historyPingPong: internals._historyPingPong as boolean,
      prevViewProj: Float32Array.from(internals._prevViewProjMatrix as Float32Array),
    },
  };
}

describe("VolumetricFogPassGPU temporal history warm-up", () => {
  it("renders the first frame unwarmed (weight 0, no prior view-projection) and only then engages history", () => {
    const { scenario, writes } = createScenario();
    const vp = makeViewProj(1);
    expect((scenario.pass as RendererInternals)._hasHistory).toBe(false);

    const t1 = stepFrame(scenario, writes, vp);

    expect(t1.frameIndex).toBe(1);
    expect(t1.weight).toBe(0);
    // No history exists yet, so the reproject uniform falls back to this frame's own matrix.
    expect(t1.prevViewProj).toEqual(vp);
    // After the frame the previous matrix is captured and history is flagged for the next frame.
    expect(t1.internals.hasHistory).toBe(true);
    expect(t1.internals.prevViewProj).toEqual(vp);
    expect(t1.internals.historyPingPong).toBe(true);
  });

  it("uses history weight 0.9 from the second frame on, blending against the exact previous frame matrix", () => {
    const { scenario, writes } = createScenario();
    stepFrame(scenario, writes, makeViewProj(1));
    const t2 = stepFrame(scenario, writes, makeViewProj(2));

    expect(t2.frameIndex).toBe(2);
    expect(t2.weight).toBe(HISTORY_WEIGHT);
    expect(t2.prevViewProj).toEqual(makeViewProj(1));
    expect(t2.internals.hasHistory).toBe(true);
    expect(t2.internals.prevViewProj).toEqual(makeViewProj(2));
  });

  it("keeps the history weight at 0 when jitter is disabled, even after warm-up", () => {
    const { scenario, writes } = createScenario(0);
    stepFrame(scenario, writes, makeViewProj(1));
    const t2 = stepFrame(scenario, writes, makeViewProj(2));

    expect(t2.weight).toBe(0);
    // The bookkeeping still advances -- only the EMA coefficient is gated on jitter.
    expect(t2.internals.hasHistory).toBe(true);
    expect(t2.prevViewProj).toEqual(makeViewProj(1));
  });

  it("destroys and resets the history bookkeeping so the next pass is unwarmed again", () => {
    const { scenario, writes } = createScenario();
    stepFrame(scenario, writes, makeViewProj(1));
    expect((scenario.pass as RendererInternals)._hasHistory).toBe(true);

    expect(() => scenario.pass.destroy()).not.toThrow();
    expect((scenario.pass as RendererInternals)._hasHistory).toBe(false);
  });
});

describe("VolumetricFogPassGPU warm-up / convergence contract", () => {
  it(`reaches steady state on frame ${MIN_WARM_UP_FRAMES + 1}: weight 0 only on the very first frame`, () => {
    const { scenario, writes } = createScenario();
    for (let k = 1; k <= MIN_WARM_UP_FRAMES + 4; k++) {
      const t = stepFrame(scenario, writes, makeViewProj(k));
      expect(t.frameIndex).toBe(k);
      if (k === 1) {
        expect(t.weight).toBe(0);
      } else {
        expect(t.weight).toBe(HISTORY_WEIGHT);
        expect(t.internals.hasHistory).toBe(true);
      }
    }
  });

  it("keeps a stable, non-oscillating history weight once warmed up", () => {
    const { scenario, writes } = createScenario();
    for (let k = 1; k <= 6; k++) stepFrame(scenario, writes, makeViewProj(k));
    for (let k = 7; k <= 10; k++) {
      const t = stepFrame(scenario, writes, makeViewProj(k));
      expect(t.weight).toBe(HISTORY_WEIGHT);
      expect(t.internals.hasHistory).toBe(true);
    }
  });
});

describe("VolumetricFogPassGPU ping-pong parity", () => {
  it("alternates history buffers every frame across 32 frames without parity drift", () => {
    const { scenario, writes } = createScenario();
    for (let k = 1; k <= 32; k++) {
      const t = stepFrame(scenario, writes, makeViewProj(k));
      const internals = scenario.pass as RendererInternals;
      const reprojectA = internals._reprojectBindGroupA as unknown;
      const reprojectB = internals._reprojectBindGroupB as unknown;

      // Frame k reads the texture written by frame k-1 and writes the other one.
      const expected = k % 2 === 0 ? reprojectB : reprojectA;
      expect(t.chosenReprojectBindGroup).toBe(expected);
      expect(t.internals.historyPingPong).toBe(k % 2 === 1);
      if (k >= 2) expect(t.weight).toBe(HISTORY_WEIGHT);
    }
  });
});

describe("VolumetricFogPassGPU determinism under capture stepping", () => {
  it("reproduces identical history payloads across two pass instances for a frozen camera and step-like frame index", () => {
    const runSequence = (): FrameTrace[] => {
      const { scenario, writes } = createScenario();
      const traces: FrameTrace[] = [];
      const frozenVp = makeViewProj(7);
      for (let k = 1; k <= 12; k++) {
        const t = stepFrame(scenario, writes, frozenVp);
        // Frozen camera: the reprojection history input never changes across runs.
        expect(t.prevViewProj).toEqual(frozenVp);
        traces.push(t);
      }
      return traces;
    };

    const a = runSequence();
    const b = runSequence();
    for (let k = 0; k < a.length; k++) {
      expect(a[k]!.weight).toBe(b[k]!.weight);
      expect(a[k]!.prevViewProj).toEqual(b[k]!.prevViewProj);
      expect(a[k]!.jitter).toEqual(b[k]!.jitter);
      expect(a[k]!.internals.prevViewProj).toEqual(b[k]!.internals.prevViewProj);
      expect(a[k]!.internals.historyPingPong).toBe(b[k]!.internals.historyPingPong);
    }
  });

  it("captures the exact previous view-projection matrix of a moving camera for reprojection", () => {
    const { scenario, writes } = createScenario();
    const vps = Array.from({ length: 8 }, (_v, i) => makeViewProj(i + 1));
    for (let k = 0; k < vps.length; k++) {
      const t = stepFrame(scenario, writes, vps[k]!);
      // This frame's reproject input is the matrix of the frame before it -- never stale, never future.
      if (k > 0) expect(t.prevViewProj).toEqual(vps[k - 1]);
      expect(t.internals.prevViewProj).toEqual(vps[k]);
    }
  });
});

// ---- 3D density masks: element-global + per FogVolume (see VolumetricTexture) ----

interface MaskFrameContext {
  pass: VolumetricFogPassGPU;
  frameInfo: FrameInfo;
  renderer: WebGPURenderer;
  depthView: GPUTextureView;
  writes: UniformWrite[];
  createTexture: ReturnType<typeof vi.fn>;
  writeTexture: ReturnType<typeof vi.fn>;
  createBindGroup: ReturnType<typeof vi.fn>;
}

function makeMaskFrameContext(): MaskFrameContext {
  const { device, writes, createTexture, writeTexture, createBindGroup } = makeDeviceMocks();
  const frameInfo = createFrameInfo();
  const renderer = {
    clusterDims: { x: 16, y: 16, z: 8 },
    frameInfo,
    globalBGL: {},
    computeStructsChunk: "",
    globalBindGroup: {},
    defaultDirShadowTextureView: {},
  } as unknown as WebGPURenderer;
  return {
    pass: new VolumetricFogPassGPU(device),
    frameInfo,
    renderer,
    depthView: {} as GPUTextureView,
    writes,
    createTexture,
    writeTexture,
    createBindGroup,
  };
}

/** Advances the frame and runs one full pass execute with the given element/volumes/sun. */
function runMaskFrame(
  ctx: MaskFrameContext,
  element: VolumetricFogElement,
  fogVolumes: FogVolume[] = [],
  dirLight?: DirectionalLight,
): void {
  ctx.frameInfo.frameIndex += 1;
  ctx.frameInfo.time += STEP_FIXED_DT;
  const ce = {
    beginComputePass: vi.fn((): ComputePassMocks => makeComputePassMocks()),
    beginRenderPass: vi.fn(() => ({
      setPipeline: vi.fn(),
      setBindGroup: vi.fn(),
      draw: vi.fn(),
      end: vi.fn(),
    })),
  };
  ctx.pass.execute(
    ctx.renderer,
    ce as unknown as GPUCommandEncoder,
    ctx.depthView,
    320,
    200,
    new Float32Array(16),
    undefined,
    new Vector3D(0, 0, 0),
    0.1,
    100,
    dirLight,
    element,
    fogVolumes,
  );
}

function initElement(color = new Color(1.0, 0.5, 0.25), albedo = 0.5): VolumetricFogElement {
  const element = new VolumetricFogElement();
  element.enabled = true;
  element.color = color;
  element.scatteringAlbedo = albedo;
  return element;
}

function maskBytes(width: number, height: number, depth: number): number {
  return 4 * width * height * depth;
}

function makeMask(width: number, height: number, depth: number, fill = 200): VolumetricTexture {
  return VolumetricTexture.fromData(
    new Uint8Array(maskBytes(width, height, depth)).fill(fill),
    width,
    height,
    depth,
  );
}

function injectUniforms(ctx: MaskFrameContext): Float32Array {
  const inject = ctx.writes.find((w) => w.buffer.size === INJECT_UNIFORM_BYTES);
  if (!inject) throw new Error("No injection uniform write observed.");
  return inject.data;
}

function integrateUniforms(ctx: MaskFrameContext): Float32Array {
  const integrate = ctx.writes.find((w) => w.buffer.size === INTEGRATE_UNIFORM_BYTES);
  if (!integrate) throw new Error("No integration uniform write observed.");
  return integrate.data;
}

function injectBindGroupDesc(ctx: MaskFrameContext): {
  entries: { binding: number; resource: unknown }[];
} {
  for (const call of ctx.createBindGroup.mock.calls as [desc: unknown][]) {
    const desc = call[0] as { entries?: { binding: number; resource: unknown }[] };
    const hasMaskArray = (desc.entries ?? []).some(
      (e) => e.binding === 4 && Array.isArray(e.resource) && e.resource.length === 16,
    );
    if (hasMaskArray) return desc as { entries: { binding: number; resource: unknown }[] };
  }
  throw new Error("No injection bind-group creation observed.");
}

function textureId(resource: unknown): number {
  return (resource as { textureId: number }).textureId;
}

describe("VolumetricFogPassGPU density masks — no-mask regression", () => {
  it("keeps the baked scatterTint and the neutral mask box in the no-mask injection payload", () => {
    const ctx = makeMaskFrameContext();
    const element = initElement();
    runMaskFrame(ctx, element);

    const inj = injectUniforms(ctx);
    // The unchanged CPU path still bakes the global albedo into scatterTint...
    expect(Array.from(inj.slice(SCATTER_TINT_INDEX, SCATTER_TINT_INDEX + 3))).toEqual([
      0.5, 0.25, 0.125,
    ]);
    expect(inj[SCATTER_TINT_INDEX + 3]).toBe(1);
    // ...and the new mask-box lanes hold no-op sentinels (box at origin, unit half-extents).
    expect(Array.from(inj.slice(ELEMENT_MASK_INDEX, ELEMENT_MASK_INDEX + 8))).toEqual([
      0, 0, 0, 0, 1, 1, 1, 0,
    ]);
  });

  it("leaves volume data lanes untouched when volumes have no masks", () => {
    const ctx = makeMaskFrameContext();
    const element = initElement();
    const volume = new FogVolume({
      density: 0.2,
      albedo: new Color(0.25, 0.4, 0.6),
    });
    runMaskFrame(ctx, element, [volume]);

    const inj = injectUniforms(ctx);
    const volBase = 32;
    // Volume data lanes are uploaded raw; masks never perturb them when no mask is present.
    expect(inj[volBase + 17]).toBeCloseTo(0.2, 6); // density
    expect(inj[volBase + 20]).toBeCloseTo(0.25, 6); // albedo.r
    expect(inj[volBase + 21]).toBeCloseTo(0.4, 6);
    expect(inj[volBase + 22]).toBeCloseTo(0.6, 6);
  });

  it("keeps the baked sun colour in the no-mask integration payload", () => {
    const ctx = makeMaskFrameContext();
    const element = initElement();
    const sun = new DirectionalLight({ intensity: 2 });
    sun.volumetricIntensity = 1.5;
    runMaskFrame(ctx, element, [], sun);

    const intg = integrateUniforms(ctx);
    const sunScale = 2 * 1.5 * 0.5; // intensity * volumetricIntensity * albedo, still baked
    expect(intg[SUN_COLOUR_INDEX]).toBeCloseTo(1.0 * sunScale, 10);
    expect(intg[SUN_COLOUR_INDEX + 1]).toBeCloseTo(0.5 * sunScale, 10);
    expect(intg[SUN_COLOUR_INDEX + 2]).toBeCloseTo(0.25 * sunScale, 10);
    expect(intg[SUN_COLOUR_INDEX + 3]).toBe(1); // sun active flag untouched
    expect(Array.from(intg.slice(INTEGRATE_MASK_INDEX, INTEGRATE_MASK_INDEX + 8))).toEqual([
      0, 0, 0, 0, 1, 1, 1, 0,
    ]);
  });
});

describe("VolumetricFogPassGPU element-global density mask", () => {
  it("uploads the unbaked tint and the real mask box when the element mask is bound", () => {
    const ctx = makeMaskFrameContext();
    const element = initElement(new Color(0.9, 0.6, 0.3), 0.5);
    element.densityMask = makeMask(2, 2, 2);
    element.maskPosition.set(10, 20, 30);
    element.maskSize.set(5, 6, 7);
    const sun = new DirectionalLight({ intensity: 2 });
    sun.volumetricIntensity = 1.5;
    runMaskFrame(ctx, element, [], sun);

    const inj = injectUniforms(ctx);
    // The global albedo is NOT baked: the shader applies mask.g per cell instead.
    expect(inj[SCATTER_TINT_INDEX]).toBeCloseTo(0.9, 6);
    expect(inj[SCATTER_TINT_INDEX + 1]).toBeCloseTo(0.6, 6);
    expect(inj[SCATTER_TINT_INDEX + 2]).toBeCloseTo(0.3, 6);
    expect(Array.from(inj.slice(ELEMENT_MASK_INDEX, ELEMENT_MASK_INDEX + 8))).toEqual([
      10, 20, 30, 0, 5, 6, 7, 0,
    ]);

    // Same unbake for the directional sun path: albedo left to the shader.
    const intg = integrateUniforms(ctx);
    const sunScale = 2 * 1.5; // no albedo factor
    expect(intg[SUN_COLOUR_INDEX]).toBeCloseTo(0.9 * sunScale, 6);
    expect(intg[SUN_COLOUR_INDEX + 1]).toBeCloseTo(0.6 * sunScale, 6);
    expect(intg[SUN_COLOUR_INDEX + 2]).toBeCloseTo(0.3 * sunScale, 6);
    expect(Array.from(intg.slice(INTEGRATE_MASK_INDEX, INTEGRATE_MASK_INDEX + 8))).toEqual([
      10, 20, 30, 0, 5, 6, 7, 0,
    ]);
  });

  it("uploads a bound element mask as an rgba8unorm 3D texture and clears needsUpdate", () => {
    const ctx = makeMaskFrameContext();
    const mask = makeMask(2, 2, 2);
    const element = initElement();
    element.densityMask = mask;
    runMaskFrame(ctx, element);

    const maskTexDesc = ctx.createTexture.mock.calls
      .map(
        (call) =>
          call[0] as { size?: number[]; dimension?: string; format?: string; usage?: number },
      )
      .find((desc) => desc.size?.[0] === 2);
    expect(maskTexDesc).toBeDefined();
    expect(maskTexDesc!.size).toEqual([2, 2, 2]);
    expect(maskTexDesc!.dimension).toBe("3d");
    expect(maskTexDesc!.format).toBe("rgba8unorm");
    expect(maskTexDesc!.usage! & 0x04).toBe(0x04); // TEXTURE_BINDING
    expect(maskTexDesc!.usage! & 0x02).toBe(0x02); // COPY_DST
    expect(mask.needsUpdate).toBe(false);

    const maskUploads = ctx.writeTexture.mock.calls.filter(
      (call) => (call[1] as Uint8Array).byteLength === maskBytes(2, 2, 2),
    );
    expect(maskUploads).toHaveLength(1);
  });

  it("re-uploads a mask only when needsUpdate is flagged, then clears the flag", () => {
    const ctx = makeMaskFrameContext();
    const mask = makeMask(2, 2, 2);
    const element = initElement();
    element.densityMask = mask;
    runMaskFrame(ctx, element);

    const maskUploads = (): number =>
      ctx.writeTexture.mock.calls.filter(
        (call) => (call[1] as Uint8Array).byteLength === maskBytes(2, 2, 2),
      ).length;
    expect(maskUploads()).toBe(1);
    // A stable mask set neither re-uploads nor rebuilds bind groups.
    runMaskFrame(ctx, element);
    expect(maskUploads()).toBe(1);

    mask.needsUpdate = true;
    runMaskFrame(ctx, element);
    expect(maskUploads()).toBe(2);
    expect(mask.needsUpdate).toBe(false);
    runMaskFrame(ctx, element);
    expect(maskUploads()).toBe(2);
  });

  it("rebuilds the mask bind groups only when the mask set changes", () => {
    const ctx = makeMaskFrameContext();
    const element = initElement();
    element.densityMask = makeMask(1, 1, 1, 100);
    runMaskFrame(ctx, element);
    const afterFirst = ctx.createBindGroup.mock.calls.length;
    expect(afterFirst).toBeGreaterThan(0);

    runMaskFrame(ctx, element);
    expect(ctx.createBindGroup.mock.calls.length).toBe(afterFirst);

    element.densityMask = makeMask(1, 1, 1, 150);
    runMaskFrame(ctx, element);
    expect(ctx.createBindGroup.mock.calls.length).toBeGreaterThan(afterFirst);
  });
});

describe("VolumetricFogPassGPU mask slot binding", () => {
  it("binds the identity placeholder into element and volume slots when no masks are set", () => {
    const ctx = makeMaskFrameContext();
    const element = initElement();
    runMaskFrame(ctx, element);

    const entries = new Map(
      injectBindGroupDesc(ctx).entries.map((e) => [e.binding, e.resource] as const),
    );
    const identityId = (ctx.createTexture.mock.results[0]!.value as { id: number }).id;
    expect(textureId(entries.get(2)!)).toBe(identityId);
    const maskArray = entries.get(4) as unknown[];
    expect(maskArray).toHaveLength(16);
    for (const view of maskArray) expect(textureId(view)).toBe(identityId);
  });

  it("binds a per-volume mask at the volume index and identity in every other slot", () => {
    const ctx = makeMaskFrameContext();
    const mask = makeMask(1, 1, 1, 200);
    const volume = new FogVolume({ densityMask: mask });
    const element = initElement();
    runMaskFrame(ctx, element, [volume]);

    const entries = new Map(
      injectBindGroupDesc(ctx).entries.map((e) => [e.binding, e.resource] as const),
    );
    const results = ctx.createTexture.mock.results as { value: { id: number } }[];
    const identityId = results[0]!.value.id;
    const maskResult = results.find((r) => r.value.id !== identityId);
    expect(maskResult).toBeDefined();
    const maskArray = entries.get(4) as unknown[];
    expect(maskArray).toHaveLength(16);
    expect(textureId(maskArray[0]!)).toBe(maskResult!.value.id);
    for (let i = 1; i < maskArray.length; i++) expect(textureId(maskArray[i]!)).toBe(identityId);
    // No element mask: the element slot stays on the identity placeholder.
    expect(textureId(entries.get(2)!)).toBe(identityId);
  });

  it("destroys owned mask GPU textures and the identity placeholder on destroy", () => {
    const ctx = makeMaskFrameContext();
    const volume = new FogVolume({ densityMask: makeMask(2, 2, 2) });
    const element = initElement();
    element.densityMask = makeMask(3, 3, 3);
    runMaskFrame(ctx, element, [volume]);

    const created = ctx.createTexture.mock.results.length;
    const destroyed = (): number =>
      ctx.createTexture.mock.results.filter(
        (r) =>
          (r.value as { destroy: { mock: { calls: unknown[] } } }).destroy.mock.calls.length > 0,
      ).length;
    expect(created).toBeGreaterThan(0);
    expect(destroyed()).toBe(0);
    expect(() => ctx.pass.destroy()).not.toThrow();
    expect(destroyed()).toBe(created);
  });
});
