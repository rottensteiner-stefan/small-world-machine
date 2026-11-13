import { describe, expect, it, vi } from "vitest";
import { VolumetricFogPassGPU } from "../../src/renderers/post/passes/VolumetricFogPassGPU.js";
import { VolumetricFogElement } from "../../src/renderers/post/elements/VolumetricFogElement.js";
import type { WebGPURenderer } from "../../src/renderers/WebGPU/WebGPURenderer.js";
import { DirectionalLight } from "../../src/core/lights/index.js";
import { FogVolume } from "../../src/core/objects/FogVolume.js";
import { VolumetricTexture } from "../../src/core/textures/index.js";
import { Color } from "../../src/core/colors/index.js";
import { Matrix4, Vector3D } from "../../src/math/index.js";
import { createFrameInfo } from "../../src/interfaces/index.js";
import type { FrameInfo, LightDataInterface } from "../../src/interfaces/index.js";
import type { PostEffectPassContext } from "../../src/renderers/post/PostEffectPass.js";
import injectWGSL from "../../src/renderers/shaders/source/web_gpu/compute/froxel_inject.wgsl?raw";
import reprojectWGSL from "../../src/renderers/shaders/source/web_gpu/compute/froxel_reproject.wgsl?raw";
import integrateWGSL from "../../src/renderers/shaders/source/web_gpu/compute/froxel_integrate.wgsl?raw";

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

/** The 0.9 EMA weight, rounded through Float32Array exactly as the engine writes it to the uniform. */
const HISTORY_WEIGHT = new Float32Array([0.9])[0]!;
const STEP_FIXED_DT = 1 / 60;

/** Byte size of the reprojection uniform buffer (44 x f32) -- used to pick it out of the writes. */
const REPROJECT_UNIFORM_BYTES = 176;
/** Index of the history-weight float in FroxelReprojectSettings (see VolumetricFogPassGPU.ts:589). */
const WEIGHT_INDEX = 40;
/** First float index of the previous view-projection matrix in FroxelReprojectSettings. */
const PREV_VIEW_PROJ_INDEX = 16;

/** Byte size of the injection uniform buffer: base + 16 volumes + scatterTint + 128 scales + mask box (8). */
const INJECT_UNIFORM_BYTES = (32 + 16 * 32 + 4 + 2 * 64 + 8) * 4;
/** Byte size of the integration uniform buffer (116 x f32 after the appended mask box). */
const INTEGRATE_UNIFORM_BYTES = 116 * 4;
/** First float index of the sun colour in FroxelIntegrationSettings. */
const SUN_COLOUR_INDEX = 32;

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

interface FrameTrace {
  frameIndex: number;
  /** History weight actually uploaded to the reprojection uniform for this frame. */
  weight: number;
  prevViewProj: Float32Array;
}

/**
 * Invertible, seed-distinct view-projection stand-in: a real perspective matrix whose translation
 * column differs per seed (the determinant only depends on the other entries, so it never goes singular).
 * The pass fails fast on singular matrices, so fake `seed * 1000 + i` matrices would not run at all.
 */
function makeViewProj(seed: number): Float32Array {
  const m = new Matrix4();
  Matrix4.perspective(Math.PI / 3, 16 / 9, 0.1, 100.0, m);
  m.data[12] = seed * 0.25;
  m.data[13] = -seed * 0.125;
  return Float32Array.from(m.data);
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
  createBuffer: ReturnType<typeof vi.fn>;
  createTexture: ReturnType<typeof vi.fn>;
} {
  const writes: UniformWrite[] = [];
  let bufferSeq = 0;
  let textureSeq = 0;
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
    createTexture,
    createBindGroup: vi.fn((desc: unknown) => ({ desc })),
    queue: {
      writeBuffer: vi.fn((buffer: MockBuffer, offset: number, data: Float32Array): void => {
        writes.push({ buffer, offset, data: Float32Array.from(data) });
      }),
      writeTexture: vi.fn(),
    },
    beginRenderPass: vi.fn(() => renderPassMocks),
  } as unknown as GPUDevice;
  return {
    device,
    writes,
    createBuffer,
    createTexture,
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

/**
 * Builds the single-argument `PostEffectPassContext` the pass now consumes (previously a 12-arg
 * execute call), mirroring what the renderer hands the VF pass: no color texture, a dummy color
 * view, the scenario's depth view / camera, and an empty light list unless explicitly provided.
 */
function buildPassCtx(
  renderer: WebGPURenderer,
  ce: GPUCommandEncoder,
  depthView: GPUTextureView,
  element: VolumetricFogElement,
  vp: Float32Array,
  fogVolumes: FogVolume[] = [],
  dirLight?: DirectionalLight,
): PostEffectPassContext {
  return {
    renderer,
    ce,
    element,
    colorTexture: undefined,
    colorView: {} as GPUTextureView,
    depthView,
    width: 320,
    height: 200,
    vp,
    vMat: undefined,
    camPos: new Vector3D(0, 0, 0),
    near: 0.1,
    far: 100.0,
    projMatrix: undefined,
    lights: { dLight: dirLight, pLights: [], sLights: [] } as unknown as LightDataInterface,
    fogVolumes,
  };
}

/** Advances frameInfo exactly like SmallWorldMachine.step() does, then runs one full pass execute. */
function stepFrame(
  scenario: PassScenario,
  writes: UniformWrite[],
  viewProj: Float32Array,
): FrameTrace {
  scenario.frameInfo.frameIndex += 1;
  scenario.frameInfo.time += STEP_FIXED_DT;

  const ce = {
    beginComputePass: vi.fn((): ComputePassMocks => makeComputePassMocks()),
    beginRenderPass: vi.fn(() => ({
      setPipeline: vi.fn(),
      setBindGroup: vi.fn(),
      draw: vi.fn(),
      end: vi.fn(),
    })),
  };

  scenario.pass.execute(
    buildPassCtx(
      scenario.renderer,
      ce as unknown as GPUCommandEncoder,
      scenario.depthView,
      scenario.element,
      viewProj,
    ),
  );

  const repro = lastReprojectWrite(writes);

  return {
    frameIndex: scenario.frameInfo.frameIndex,
    weight: repro[WEIGHT_INDEX] ?? 0,
    prevViewProj: Float32Array.from(repro.slice(PREV_VIEW_PROJ_INDEX, PREV_VIEW_PROJ_INDEX + 16)),
  };
}

describe("VolumetricFogPassGPU temporal history warm-up", () => {
  it("renders the first frame unwarmed (weight 0, no prior view-projection) and only then engages history", () => {
    const { scenario, writes } = createScenario();
    const vp1 = makeViewProj(1);

    const t1 = stepFrame(scenario, writes, vp1);

    expect(t1.frameIndex).toBe(1);
    expect(t1.weight).toBe(0);
    // No history exists yet, so the reproject uniform falls back to this frame's own matrix.
    expect(t1.prevViewProj).toEqual(vp1);

    // On the next frame, history is engaged using frame 1's view-projection.
    const t2 = stepFrame(scenario, writes, makeViewProj(2));
    expect(t2.weight).toBe(HISTORY_WEIGHT);
    expect(t2.prevViewProj).toEqual(vp1);
  });

  it("uses history weight 0.9 from the second frame on, blending against the exact previous frame matrix", () => {
    const { scenario, writes } = createScenario();
    const vp1 = makeViewProj(1);
    const vp2 = makeViewProj(2);
    const vp3 = makeViewProj(3);

    stepFrame(scenario, writes, vp1);
    const t2 = stepFrame(scenario, writes, vp2);

    expect(t2.frameIndex).toBe(2);
    expect(t2.weight).toBe(HISTORY_WEIGHT);
    expect(t2.prevViewProj).toEqual(vp1);

    const t3 = stepFrame(scenario, writes, vp3);
    expect(t3.weight).toBe(HISTORY_WEIGHT);
    expect(t3.prevViewProj).toEqual(vp2);
  });

  it("keeps the history weight at 0 when jitter is disabled, even after warm-up", () => {
    const { scenario, writes } = createScenario(0);
    stepFrame(scenario, writes, makeViewProj(1));
    const t2 = stepFrame(scenario, writes, makeViewProj(2));

    expect(t2.weight).toBe(0);
    // The bookkeeping still advances -- only the EMA coefficient is gated on jitter.
    expect(t2.prevViewProj).toEqual(makeViewProj(1));
  });

  it("destroys and resets the history bookkeeping so the next pass is unwarmed again", () => {
    const { scenario, writes } = createScenario();
    stepFrame(scenario, writes, makeViewProj(1));
    const t2 = stepFrame(scenario, writes, makeViewProj(2));
    expect(t2.weight).toBe(HISTORY_WEIGHT);

    expect(() => scenario.pass.destroy()).not.toThrow();

    const vp3 = makeViewProj(3);
    const t3 = stepFrame(scenario, writes, vp3);
    expect(t3.weight).toBe(0);
    expect(t3.prevViewProj).toEqual(vp3);
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
}

function makeMaskFrameContext(): MaskFrameContext {
  const { device, writes, createTexture } = makeDeviceMocks();
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
    buildPassCtx(
      ctx.renderer,
      ce as unknown as GPUCommandEncoder,
      ctx.depthView,
      element,
      makeViewProj(1),
      fogVolumes,
      dirLight,
    ),
  );
}

// Every engine Color is sRGB-authored; the passes upload its linear value (ADR 0049).
const lin = (c: number): number => Math.pow(c, 2.2);

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

// ---- Uniform layout parity: the CPU payload must land on the offsets the real WGSL structs declare ----

interface WgslLayout {
  /** Float offset of every field. */
  offsets: Map<string, number>;
  /** Total struct size in floats (padded to the struct alignment). */
  floats: number;
}

const WGSL_SCALARS: Record<string, [size: number, align: number]> = {
  f32: [4, 4],
  u32: [4, 4],
  i32: [4, 4],
  vec2f: [8, 8],
  vec3f: [12, 16],
  vec4f: [16, 16],
  mat4x4f: [64, 16],
};

/** Parses `struct <name> { ... }` out of real WGSL and lays it out with uniform-buffer rules. */
function parseWgslStruct(
  source: string,
  name: string,
  structs: Map<string, number> = new Map(),
): WgslLayout {
  const match = new RegExp(`struct\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(source);
  if (!match) throw new Error(`struct ${name} not found in WGSL`);
  const offsets = new Map<string, number>();
  let byteOffset = 0;
  let maxAlign = 4;
  for (const raw of match[1]!.split("\n")) {
    const line = raw.replace(/\/\/.*$/, "").trim();
    if (!line) continue;
    const field = /^(\w+)\s*:\s*(.+?),?$/.exec(line);
    if (!field) throw new Error(`unparsable WGSL field: ${line}`);
    const [, fieldName, type] = field as unknown as [string, string, string];
    let size: number;
    let align: number;
    const arr = /^array<(\w+),\s*(\d+)>$/.exec(type);
    if (arr) {
      const elem = arr[1]!;
      const elemLayout = WGSL_SCALARS[elem] ?? [structs.get(elem) ?? -1, 16];
      if (elemLayout[0] < 0) throw new Error(`unknown WGSL element type ${elem}`);
      align = elemLayout[1];
      size = Math.ceil(elemLayout[0] / align) * align * Number(arr[2]);
    } else if (WGSL_SCALARS[type]) {
      [size, align] = WGSL_SCALARS[type]!;
    } else if (structs.has(type)) {
      size = structs.get(type)!;
      align = 16;
    } else {
      throw new Error(`unknown WGSL type ${type}`);
    }
    byteOffset = Math.ceil(byteOffset / align) * align;
    offsets.set(fieldName, byteOffset / 4);
    byteOffset += size;
    maxAlign = Math.max(maxAlign, align);
  }
  return { offsets, floats: Math.ceil(byteOffset / maxAlign) * (maxAlign / 4) };
}

function offsetOf(layout: WgslLayout, field: string): number {
  const o = layout.offsets.get(field);
  if (o === undefined) throw new Error(`field ${field} missing`);
  return o;
}

describe("VolumetricFogPassGPU uniform layout parity with the real WGSL", () => {
  const fogVolume = parseWgslStruct(injectWGSL, "FogVolumeData");
  const injectLayout = parseWgslStruct(
    injectWGSL,
    "FroxelUniforms",
    new Map([["FogVolumeData", fogVolume.floats * 4]]),
  );
  const reprojectLayout = parseWgslStruct(reprojectWGSL, "FroxelReprojectSettings");
  const integrateLayout = parseWgslStruct(integrateWGSL, "FroxelIntegrationSettings");

  it("allocates uniform buffers exactly as large as the WGSL structs", () => {
    const { device, createBuffer } = makeDeviceMocks();
    new VolumetricFogPassGPU(device);
    const sizes = (createBuffer.mock.results as { value: MockBuffer }[]).map((r) => r.value.size);
    expect(sizes).toContain(injectLayout.floats * 4);
    expect(sizes).toContain(reprojectLayout.floats * 4);
    expect(sizes).toContain(integrateLayout.floats * 4);
  });

  it("writes the injection payload at the WGSL field offsets", () => {
    const ctx = makeMaskFrameContext();
    const element = initElement(new Color(0.9, 0.6, 0.3), 0.5);
    element.densityMask = makeMask(2, 2, 2);
    element.maskPosition.set(10, 20, 30);
    element.maskSize.set(5, 6, 7);
    element.density = 0.37;
    element.asymmetry = 0.42;
    runMaskFrame(ctx, element);
    const inj = injectUniforms(ctx);
    expect(inj.length).toBe(injectLayout.floats);
    expect(inj[offsetOf(injectLayout, "params")]).toBeCloseTo(0.37, 6);
    expect(inj[offsetOf(injectLayout, "phase")]).toBeCloseTo(0.42, 6);
    expect(inj[offsetOf(injectLayout, "nearFar")]).toBeCloseTo(0.1, 6);
    expect(inj[offsetOf(injectLayout, "nearFar") + 2]).toBe(8); // slice count
    expect(inj[offsetOf(injectLayout, "scatterTint")]).toBeCloseTo(lin(0.9), 6);
    expect(inj[offsetOf(injectLayout, "elementMaskPosition") + 2]).toBe(30);
    expect(inj[offsetOf(injectLayout, "elementMaskSize") + 1]).toBe(6);
  });

  it("writes the integration payload at the WGSL field offsets", () => {
    const ctx = makeMaskFrameContext();
    const element = initElement(new Color(0.9, 0.6, 0.3), 0.5);
    element.densityMask = makeMask(2, 2, 2);
    element.maskPosition.set(10, 20, 30);
    element.maskSize.set(5, 6, 7);
    const sun = new DirectionalLight({ intensity: 2 });
    runMaskFrame(ctx, element, [], sun);
    const intg = integrateUniforms(ctx);
    expect(intg.length).toBe(integrateLayout.floats);
    expect(intg[offsetOf(integrateLayout, "nearFar")]).toBeCloseTo(0.1, 6);
    expect(intg[offsetOf(integrateLayout, "sunColorIntensity")]).toBeCloseTo(lin(0.9) * 2, 5);
    expect(intg[offsetOf(integrateLayout, "sunColorIntensity") + 3]).toBe(1);
    expect(intg[offsetOf(integrateLayout, "elementMaskPosition")]).toBe(10);
    expect(intg[offsetOf(integrateLayout, "elementMaskSize") + 2]).toBe(7);
    // cascadeMatrices0 starts right after shadowInfo; the ZO-corrected matrix is non-trivial.
    expect(offsetOf(integrateLayout, "cascadeMatrices0")).toBe(
      offsetOf(integrateLayout, "shadowInfo") + 4,
    );
  });

  it("writes the reprojection payload at the WGSL field offsets", () => {
    const { scenario, writes } = createScenario();
    stepFrame(scenario, writes, makeViewProj(1));
    stepFrame(scenario, writes, makeViewProj(2));
    const rep = lastReprojectWrite(writes);
    expect(rep.length).toBe(reprojectLayout.floats);
    expect(offsetOf(reprojectLayout, "reprojectParams")).toBe(WEIGHT_INDEX);
    expect(offsetOf(reprojectLayout, "prevViewProj")).toBe(PREV_VIEW_PROJ_INDEX);
    expect(rep[offsetOf(reprojectLayout, "nearFar") + 1]).toBeCloseTo(100, 4);
  });
});

describe("VolumetricFogPassGPU robustness and resource lifetime", () => {
  function frame(
    ctx: MaskFrameContext,
    el: VolumetricFogElement,
    vp: Float32Array,
    near = 0.1,
    far = 100,
  ): GPUTextureView | null {
    ctx.frameInfo.frameIndex += 1;
    const ce = {
      beginComputePass: vi.fn((): ComputePassMocks => makeComputePassMocks()),
      beginRenderPass: vi.fn(() => ({
        setPipeline: vi.fn(),
        setBindGroup: vi.fn(),
        draw: vi.fn(),
        end: vi.fn(),
      })),
    };
    const c = buildPassCtx(ctx.renderer, ce as unknown as GPUCommandEncoder, ctx.depthView, el, vp);
    c.near = near;
    c.far = far;
    return ctx.pass.execute(c);
  }
  it("skips the frame (null, history dropped) on a singular view-projection instead of using garbage", () => {
    const ctx = makeMaskFrameContext();
    const el = initElement();
    el.jitter = 0.25;
    expect(frame(ctx, el, makeViewProj(1))).not.toBeNull();
    expect(frame(ctx, el, makeViewProj(2))).not.toBeNull();
    expect(lastReprojectWrite(ctx.writes)[WEIGHT_INDEX]).toBe(HISTORY_WEIGHT);

    expect(frame(ctx, el, new Float32Array(16))).toBeNull();

    expect(frame(ctx, el, makeViewProj(3))).not.toBeNull();
    expect(lastReprojectWrite(ctx.writes)[WEIGHT_INDEX]).toBe(0);
  });

  it("drops the history across a disabled gap so the re-enabled frame is unwarmed", () => {
    const ctx = makeMaskFrameContext();
    const el = initElement();
    el.jitter = 0.25;
    frame(ctx, el, makeViewProj(1));
    frame(ctx, el, makeViewProj(2));
    el.enabled = false;
    expect(frame(ctx, el, makeViewProj(3))).toBeNull();
    el.enabled = true;
    frame(ctx, el, makeViewProj(4));
    expect(lastReprojectWrite(ctx.writes)[WEIGHT_INDEX]).toBe(0);
  });

  it("drops the history when the shadow view is missing for a frame", () => {
    const ctx = makeMaskFrameContext();
    const el = initElement();
    el.jitter = 0.25;
    frame(ctx, el, makeViewProj(1));
    frame(ctx, el, makeViewProj(2));
    expect(lastReprojectWrite(ctx.writes)[WEIGHT_INDEX]).toBe(HISTORY_WEIGHT);

    (
      ctx.renderer as unknown as { defaultDirShadowTextureView: unknown }
    ).defaultDirShadowTextureView = undefined;
    expect(frame(ctx, el, makeViewProj(3))).toBeNull();

    (
      ctx.renderer as unknown as { defaultDirShadowTextureView: unknown }
    ).defaultDirShadowTextureView = {};
    expect(frame(ctx, el, makeViewProj(4))).not.toBeNull();
    expect(lastReprojectWrite(ctx.writes)[WEIGHT_INDEX]).toBe(0);
  });

  it("invalidates the history when near/far change (the log slicing moves)", () => {
    const ctx = makeMaskFrameContext();
    const el = initElement();
    el.jitter = 0.25;
    frame(ctx, el, makeViewProj(1));
    frame(ctx, el, makeViewProj(2));
    frame(ctx, el, makeViewProj(3), 0.1, 200);
    expect(lastReprojectWrite(ctx.writes)[WEIGHT_INDEX]).toBe(0);
    frame(ctx, el, makeViewProj(4), 0.1, 200);
    expect(lastReprojectWrite(ctx.writes)[WEIGHT_INDEX]).toBe(HISTORY_WEIGHT);
  });

  it("uses a tinted directional light colour for the sun shafts", () => {
    const ctx = makeMaskFrameContext();
    const el = initElement(new Color(1, 1, 1), 1);
    const sun = new DirectionalLight({ intensity: 1, color: new Color(1.0, 0.2, 0.1) });
    runMaskFrame(ctx, el, [], sun);
    const intg = integrateUniforms(ctx);
    expect(intg[SUN_COLOUR_INDEX]).toBeCloseTo(lin(1.0), 5);
    expect(intg[SUN_COLOUR_INDEX + 1]).toBeCloseTo(lin(0.2), 5);
    expect(intg[SUN_COLOUR_INDEX + 2]).toBeCloseTo(lin(0.1), 5);
  });

  it("builds its own froxel grid when the cluster grid is degenerate (clusteredLighting disabled)", () => {
    const ctx = makeMaskFrameContext();
    (ctx.renderer as unknown as { clusterDims: unknown }).clusterDims = { x: 1, y: 1, z: 1 };
    const el = initElement();
    frame(ctx, el, makeViewProj(1));
    const sizes = (ctx.createTexture.mock.calls as [{ size: number[]; dimension?: string }][])
      .map((c) => c[0])
      .filter(
        (d) => d.dimension === "3d" && d.size.length === 3 && d.size[0]! > 1 && d.size[2]! > 1,
      );
    expect(sizes.length).toBeGreaterThan(0);
    // 320x200 canvas, 16 px tiles, 24 slices.
    expect(sizes[0]!.size).toEqual([20, 13, 24]);
  });

  it("inherits a fine-enough cluster grid unchanged", () => {
    const ctx = makeMaskFrameContext();
    frame(ctx, initElement(), makeViewProj(1));
    const three = (ctx.createTexture.mock.calls as [{ size: number[]; dimension?: string }][])
      .map((c) => c[0])
      .filter((d) => d.dimension === "3d" && d.size[2]! > 1 && d.size[0]! > 2);
    expect(three[0]!.size).toEqual([16, 16, 8]);
  });

  it("evicts GPU textures of masks that are no longer bound", () => {
    const ctx = makeMaskFrameContext();
    const el = initElement();
    el.densityMask = makeMask(2, 2, 2);
    runMaskFrame(ctx, el);
    const results = ctx.createTexture.mock.results as {
      value: { destroy: ReturnType<typeof vi.fn>; id: number };
    }[];
    const maskTex = results.find(
      (r) =>
        r.value.id !== 0 &&
        (ctx.createTexture.mock.calls[r.value.id]![0] as { size: number[] }).size[0] === 2,
    )!;
    expect(maskTex.value.destroy).not.toHaveBeenCalled();
    el.densityMask = undefined;
    runMaskFrame(ctx, el);
    expect(maskTex.value.destroy).toHaveBeenCalled();
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

  it("releaseTargets frees the volumes and the next frame rebuilds them unwarmed", () => {
    const ctx = makeMaskFrameContext();
    const el = initElement();
    el.jitter = 0.25;
    frame(ctx, el, makeViewProj(1));
    frame(ctx, el, makeViewProj(2));
    expect(lastReprojectWrite(ctx.writes)[WEIGHT_INDEX]).toBe(HISTORY_WEIGHT);

    const before = ctx.createTexture.mock.calls.length;
    ctx.pass.releaseTargets();
    expect(frame(ctx, el, makeViewProj(3))).not.toBeNull();
    expect(ctx.createTexture.mock.calls.length).toBeGreaterThan(before);
    expect(lastReprojectWrite(ctx.writes)[WEIGHT_INDEX]).toBe(0);
  });

  it("declares @workgroup_size(8, 8, 1) on injectFog in WGSL", () => {
    expect(injectWGSL).toMatch(/@workgroup_size\(8, 8, 1\)\s*\nfn injectFog/);
  });
});
