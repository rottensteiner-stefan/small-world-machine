// Recording-mock-device tests for `InstanceFieldSystem` (ADR 0059 step 1). They pin the bugs the
// first real-device run (Apple Metal, showcase 51 `?mode=field`) exposed and that the inert
// (host: null) tests could not see: u32 param words never uploaded, page overflow, missing
// `setPipeline`, wrong uv vertex slot, probe re-mapping while pending, per-frame bind groups.
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { InstanceFieldRenderHost } from "../../src/renderers/WebGPU/managers/InstanceFieldSystem.js";
import { InstanceFieldSystem } from "../../src/renderers/WebGPU/managers/InstanceFieldSystem.js";
import { MAX_LOD_BUCKETS, packInstancePose } from "../../src/core/InstanceField.js";
import type { PrototypeDescriptor } from "../../src/core/InstanceField.js";
import type { GeometryDataInterface } from "../../src/interfaces/index.js";

const PARAM_BLOCK_BYTES = 256;
const SEGMENT_BASE_WORD = 112 / 4;
const HZB_ENABLED_WORD = 104 / 4;
const CULL_MODE_WORD = 116 / 4;
const FIELD_INFO_SIZE = 128;
const INFO_WIND_HEIGHT_FLOAT = 48 / 4;
const INFO_WIND_FLOAT = 64 / 4;

interface MockBuffer {
  size: number;
  label?: string | undefined;
  mapState: "unmapped" | "pending" | "mapped";
  mapAsync: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

interface Recorded {
  writes: { buffer: MockBuffer; offset: number; data: ArrayBufferView }[];
  bindGroups: number;
  buffers: MockBuffer[];
}

beforeAll(() => {
  const g = globalThis as Record<string, unknown>;
  g["GPUBufferUsage"] ??= {
    MAP_READ: 1,
    MAP_WRITE: 2,
    COPY_SRC: 4,
    COPY_DST: 8,
    INDEX: 16,
    VERTEX: 32,
    UNIFORM: 64,
    STORAGE: 128,
    INDIRECT: 256,
    QUERY_RESOLVE: 512,
  };
  g["GPUShaderStage"] ??= { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
  g["GPUMapMode"] ??= { READ: 1, WRITE: 2 };
});

function makeDevice(rec: Recorded): GPUDevice {
  const device = {
    createBuffer: (desc: GPUBufferDescriptor): MockBuffer => {
      const b: MockBuffer = {
        size: desc.size,
        label: desc.label,
        mapState: "unmapped",
        mapAsync: vi.fn(function (this: void): Promise<void> {
          b.mapState = "pending";
          return Promise.resolve();
        }),
        destroy: vi.fn(),
      };
      rec.buffers.push(b);
      return b;
    },
    createBindGroupLayout: (): object => ({}),
    createBindGroup: (): object => {
      rec.bindGroups++;
      return {};
    },
    createPipelineLayout: (): object => ({}),
    createShaderModule: (): object => ({}),
    createComputePipeline: (): object => ({}),
    createRenderPipeline: (): object => ({}),
    createSampler: (): object => ({}),
    queue: {
      writeBuffer: (buffer: MockBuffer, offset: number, data: ArrayBufferView): void => {
        // Copy: the system reuses its scratch block, the test inspects every upload later.
        const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice();
        rec.writes.push({ buffer, offset, data: bytes });
      },
    },
  };
  return device as unknown as GPUDevice;
}

interface SetupExtras {
  colors?: Float32Array;
  backlight?: readonly [number, number, number];
  windHeight?: number;
  windUniforms?: Float32Array;
}

function makeSetup(
  instances: number,
  extras: SetupExtras = {},
): {
  system: InstanceFieldSystem;
  rec: Recorded;
  geoEntry: {
    vb: object;
    uvb: object;
    ib: object;
    indexCount: number;
    vertexCount: number;
    format: string;
  };
} {
  const rec: Recorded = { writes: [], bindGroups: 0, buffers: [] };
  const geoEntry = {
    vb: { id: "vb" },
    uvb: { id: "uvb" },
    ib: { id: "ib" },
    indexCount: 36,
    vertexCount: 3,
    format: "uint32",
  };
  const hzbViews = [{ id: "hzbA" }, { id: "hzbB" }];
  let frame = 0;
  const host = {
    gpuDevice: makeDevice(rec),
    globalBGL: {},
    globalBindGroup: {},
    globalUniformBuffer: { id: "global" },
    viewBGL: {},
    viewBindGroup: {},
    currentColorTargetFormat: "bgra8unorm",
    fieldCullModuleSource: "",
    fieldPullModuleSource: "",
    whiteTextureView: {},
    getPreviousFrameHzb: () => ({
      available: true,
      frameIndex: frame,
      readHandle: { view: hzbViews[frame++ % 2], mipLevelCount: 8 },
    }),
    getTextureView: () => ({}),
    acquireFieldGeometry: () => geoEntry,
    releaseFieldGeometry: () => {},
  } as unknown as InstanceFieldRenderHost;

  const geometry = {
    vertices: new Float32Array(9),
    indices: new Uint32Array(3),
    uvs: new Float32Array(6),
    colors: extras.colors,
  } as unknown as GeometryDataInterface;
  const prototype: PrototypeDescriptor = {
    id: "tree",
    boundingRadius: 2,
    lodBuckets: [
      { name: "L0", lodIndex: 0, minProjectedSize: 3, maxProjectedSize: 1e6, geometrySlot: 0 },
    ],
    materialSlot: 0,
    maxInstances: instances,
  };
  const records = new Float32Array(instances * 4);
  const pose = new Uint32Array(1);
  const poseF = new Float32Array(pose.buffer);
  for (let i = 0; i < instances; i++) {
    records[i * 4] = i;
    pose[0] = packInstancePose(0, 1);
    records[i * 4 + 3] = poseF[0]!;
  }
  const system = new InstanceFieldSystem(null, {
    instanceRecords: records,
    prototypes: [prototype],
    geometryTable: [[geometry]],
    options: { maxInstances: instances, cellSize: 10, cullPixelSize: 2, maxViews: 4 },
    backlight: extras.backlight,
    windHeight: extras.windHeight,
    windUniforms: extras.windUniforms,
  } as never);
  system.attachHost(host);
  return { system, rec, geoEntry };
}

function lastParamBlock(rec: Recorded, offset: number): Uint32Array {
  const hit = [...rec.writes]
    .reverse()
    .find((w) => w.offset === offset && w.data.byteLength === PARAM_BLOCK_BYTES);
  expect(hit, `param block upload at ${offset}`).toBeDefined();
  const bytes = hit!.data as Uint8Array;
  return new Uint32Array(bytes.buffer, bytes.byteOffset, PARAM_BLOCK_BYTES / 4);
}

const VP = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, -1, -1, 0, 0, -1, 0]);

describe("InstanceFieldSystem on a recording device", () => {
  it("uploads the u32 words of every view's param block (segment base, cull mode, HZB flag)", () => {
    const { system, rec } = makeSetup(16);
    system.prepareMainView(VP, { x: 0, y: 0, z: 0 }, 720, 1);
    system.prepareShadowView(2, VP);

    const main = lastParamBlock(rec, 0);
    expect(main[SEGMENT_BASE_WORD]).toBe(0);
    expect(main[CULL_MODE_WORD]).toBe(1);
    expect(main[HZB_ENABLED_WORD]).toBe(1);

    const shadow = lastParamBlock(rec, 2 * MAX_LOD_BUCKETS * PARAM_BLOCK_BYTES);
    expect(shadow[SEGMENT_BASE_WORD]).toBe(2 * MAX_LOD_BUCKETS);
    expect(shadow[CULL_MODE_WORD]).toBe(0);
  });

  it("sizes each segment page for the whole population (one view may see every instance)", () => {
    const n = 5000;
    const { rec } = makeSetup(n);
    // `FieldInfo` is the last 128 B buffer the system creates; word 0 = pageCapacity.
    const fieldInfo = rec.buffers.filter((b) => b.size === FIELD_INFO_SIZE).at(-1);
    const info = rec.writes.find((w) => w.buffer === fieldInfo && w.offset === 0);
    expect(info).toBeDefined();
    const words = new Uint32Array((info!.data as Uint8Array).slice().buffer);
    expect(words[0]).toBe(n); // pageCapacity
    // Pages only for the addressable segments: views [0,4) x 1 bucket -> highest bv = 3*8.
    const visible = rec.buffers.find((b) => b.size === (3 * MAX_LOD_BUCKETS + 1) * n * 4);
    expect(visible).toBeDefined();
  });

  it("sets the pipeline and binds all four vertex streams before every indirect draw", () => {
    const { system, geoEntry } = makeSetup(8);
    const calls: string[] = [];
    const rp = {
      setPipeline: vi.fn(() => calls.push("pipeline")),
      setBindGroup: vi.fn(),
      setVertexBuffer: vi.fn(),
      setIndexBuffer: vi.fn(),
      drawIndexedIndirect: vi.fn(() => calls.push("draw")),
    };
    system.recordDraw(rp as unknown as GPURenderPassEncoder, 0, 0, true, "color");
    expect(calls).toEqual(["pipeline", "draw"]);
    expect(rp.setVertexBuffer).toHaveBeenCalledWith(0, geoEntry.vb);
    expect(rp.setVertexBuffer).toHaveBeenCalledWith(2, geoEntry.uvb);
    // Missing normals / colours are completed by the system (slots 1 and 3, own buffers).
    const slots = rp.setVertexBuffer.mock.calls.map((c) => c[0]).sort();
    expect(slots).toEqual([0, 1, 2, 3]);
  });

  it("reuses the cull bind groups of the ping-pong pyramid instead of creating one per frame", () => {
    const { system, rec } = makeSetup(8);
    for (let f = 0; f < 4; f++) system.prepareMainView(VP, { x: 0, y: 0, z: 0 }, 720, 1);
    const afterWarmup = rec.bindGroups;
    for (let f = 0; f < 20; f++) system.prepareMainView(VP, { x: 0, y: 0, z: 0 }, 720, 1);
    expect(rec.bindGroups).toBe(afterWarmup);
  });

  it("maps the probe staging only once while a readback is pending", () => {
    const { system, rec } = makeSetup(8);
    system.installCullProbe({ onCullFrame: () => {} });
    const ce = { copyBufferToBuffer: vi.fn() } as unknown as GPUCommandEncoder;
    system.recordProbeStaging(ce, 1);
    system.kickoffProbeReadback();
    system.kickoffProbeReadback();
    const staging = rec.buffers.filter((b) => b.mapAsync.mock.calls.length > 0);
    expect(staging.length).toBe(2);
    for (const b of staging) expect(b.mapAsync).toHaveBeenCalledTimes(1);
  });

  it("writes the leaf backlight (linear tint + default 0.5 m offset) into FieldInfo", () => {
    const { rec } = makeSetup(4, { backlight: [0.3, 0.5, 0.1] });
    const fieldInfo = rec.buffers.filter((b) => b.size === FIELD_INFO_SIZE).at(-1);
    const info = rec.writes.find((w) => w.buffer === fieldInfo && w.offset === 0);
    const floats = new Float32Array((info!.data as Uint8Array).slice().buffer);
    expect(Array.from(floats.subarray(8, 12)).map((v) => +v.toFixed(3))).toEqual([
      0.3, 0.5, 0.1, 0.5,
    ]);
  });

  it("keeps the backlight off (w = 0) without a tint", () => {
    const { rec } = makeSetup(4);
    const fieldInfo = rec.buffers.filter((b) => b.size === FIELD_INFO_SIZE).at(-1);
    const info = rec.writes.find((w) => w.buffer === fieldInfo && w.offset === 0);
    const floats = new Float32Array((info!.data as Uint8Array).slice().buffer);
    expect(floats[11]).toBe(0);
  });

  it("expands rgb vertex colours to the rgba colour stream with foliage mask 1", () => {
    const rgb = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]);
    const { rec } = makeSetup(4, { colors: rgb });
    const colorWrite = rec.writes.find((w) => w.data.byteLength === 3 * 16);
    expect(colorWrite).toBeDefined();
    const rgba = new Float32Array((colorWrite!.data as Uint8Array).slice().buffer);
    expect(Array.from(rgba).map((v) => +v.toFixed(2))).toEqual([
      0.1, 0.2, 0.3, 1, 0.4, 0.5, 0.6, 1, 0.7, 0.8, 0.9, 1,
    ]);
  });

  it("keeps wind disabled by default (windHeight 0, no per-frame wind upload)", () => {
    const { system, rec } = makeSetup(4);
    system.prepareMainView(VP, { x: 0, y: 0, z: 0 }, 720, 1);
    const fieldInfo = rec.buffers.filter((b) => b.size === FIELD_INFO_SIZE).at(-1);
    const info = rec.writes.find((w) => w.buffer === fieldInfo && w.offset === 0);
    const floats = new Float32Array((info!.data as Uint8Array).slice().buffer);
    expect(floats[INFO_WIND_HEIGHT_FLOAT]).toBe(0);
    expect(floats[INFO_WIND_FLOAT]).toBe(0);
    // No separate 64-B wind write while disabled.
    expect(rec.writes.some((w) => w.buffer === fieldInfo && w.offset === INFO_WIND_FLOAT * 4)).toBe(
      false,
    );
  });

  it("writes the authored wind height into FieldInfo", () => {
    const { rec } = makeSetup(4, { windHeight: 9.5, windUniforms: new Float32Array(16) });
    const fieldInfo = rec.buffers.filter((b) => b.size === FIELD_INFO_SIZE).at(-1);
    const info = rec.writes.find((w) => w.buffer === fieldInfo && w.offset === 0);
    const floats = new Float32Array((info!.data as Uint8Array).slice().buffer);
    expect(floats[INFO_WIND_HEIGHT_FLOAT]).toBe(9.5);
  });

  it("forwards the CURRENT wind block bytes every frame head (borrowed reference, no copy)", () => {
    const wind = new Float32Array(16);
    const { system, rec } = makeSetup(4, { windHeight: 9.5, windUniforms: wind });
    const fieldInfo = rec.buffers.filter((b) => b.size === FIELD_INFO_SIZE).at(-1);
    // Frame 1: producer's initial block.
    system.prepareMainView(VP, { x: 0, y: 0, z: 0 }, 720, 1);
    let windWrite = rec.writes.filter(
      (w) => w.buffer === fieldInfo && w.offset === INFO_WIND_FLOAT * 4,
    );
    expect(windWrite).toHaveLength(1);
    expect([...new Float32Array((windWrite[0]!.data as Uint8Array).slice().buffer)]).toEqual(
      Array.from(wind),
    );
    // Frame 2: producer rewrites the block; the system uploads the new bytes unprompted.
    wind[2] = 7.25;
    wind[15] = 1;
    system.prepareMainView(VP, { x: 0, y: 0, z: 0 }, 720, 1);
    windWrite = rec.writes.filter(
      (w) => w.buffer === fieldInfo && w.offset === INFO_WIND_FLOAT * 4,
    );
    expect(windWrite).toHaveLength(2);
    const last = new Float32Array(
      (windWrite[windWrite.length - 1]!.data as Uint8Array).slice().buffer,
    );
    expect(last[2]).toBe(7.25);
    expect(last[15]).toBe(1);
    expect(Array.from(last)).toEqual(Array.from(wind));
  });

  it("rejects a wind height without a 16-float wind block (fail fast)", () => {
    expect(() => makeSetup(4, { windHeight: 9.5 })).toThrow(/windUniforms/);
    const short = new Float32Array(8);
    expect(() => makeSetup(4, { windHeight: 9.5, windUniforms: short })).toThrow(/windUniforms/);
  });
});
