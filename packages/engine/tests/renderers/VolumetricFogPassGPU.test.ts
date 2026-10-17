import { describe, expect, it, vi } from "vitest";
import { VolumetricFogPassGPU } from "../../src/renderers/post/passes/VolumetricFogPassGPU.js";
import { VolumetricFogElement } from "../../src/renderers/post/elements/VolumetricFogElement.js";
import { WebGPURenderer } from "../../src/renderers/WebGPU/WebGPURenderer.js";
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
} {
  const writes: UniformWrite[] = [];
  let bufferSeq = 0;
  const createBindGroup = vi.fn((desc: unknown) => ({ desc }));
  const createBuffer = vi.fn((desc: { size: number }): MockBuffer => {
    return { id: bufferSeq++, size: desc.size, destroy: vi.fn() };
  });
  const renderPassMocks = {
    setPipeline: vi.fn(),
    setBindGroup: vi.fn(),
    draw: vi.fn(),
    end: vi.fn(),
  };
  const device = {
    createSampler: vi.fn(() => ({})),
    createBuffer,
    createBindGroupLayout: vi.fn(() => ({})),
    createPipelineLayout: vi.fn(() => ({})),
    createComputePipeline: vi.fn(() => ({})),
    createShaderModule: vi.fn(() => ({})),
    createRenderPipeline: vi.fn(() => ({})),
    createTexture: vi.fn(() => ({ createView: vi.fn(() => ({})), destroy: vi.fn() })),
    createBindGroup,
    queue: {
      writeBuffer: vi.fn((buffer: MockBuffer, offset: number, data: Float32Array): void => {
        writes.push({ buffer, offset, data: Float32Array.from(data) });
      }),
    },
    beginRenderPass: vi.fn(() => renderPassMocks),
  } as unknown as GPUDevice;
  return { device, writes, createBindGroup, createBuffer };
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
