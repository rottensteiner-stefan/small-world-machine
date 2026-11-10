// Recording-mock-device tests for `InstanceFieldSystem` (ADR 0059 step 1). They pin the bugs the
// first real-device run (Apple Metal, showcase 51 `?mode=field`) exposed and that the inert
// (host: null) tests could not see: u32 param words never uploaded, page overflow, missing
// `setPipeline`, wrong uv vertex slot, probe re-mapping while pending, per-frame bind groups.
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { InstanceFieldRenderHost } from "../../src/renderers/WebGPU/managers/InstanceFieldSystem.js";
import { InstanceFieldSystem } from "../../src/renderers/WebGPU/managers/InstanceFieldSystem.js";
import {
  LOD_TRANSITION_MODES,
  MAX_LOD_BUCKETS,
  packInstancePose,
} from "../../src/core/InstanceField.js";
import type { LodTransitionMode, PrototypeDescriptor } from "../../src/core/InstanceField.js";
import type { GeometryDataInterface } from "../../src/interfaces/index.js";

const PARAM_BLOCK_BYTES = 256;
const SEGMENT_BASE_WORD = 112 / 4;
const HZB_ENABLED_WORD = 104 / 4;
const CULL_MODE_WORD = 116 / 4;
const FIELD_INFO_SIZE = 128;
const INFO_WIND_HEIGHT_FLOAT = 48 / 4;
const INFO_WIND_FLOAT = 64 / 4;
const INFO_LOD_DITHER_MODE_WORD = 52 / 4;
// P2 DECISIVE MODE SWITCH pad words in the per-view CULL param block (f32, bytes 124/128).
const CULL_LOD_CROSSFADE_BAND_WORD = 124 / 4;
const CULL_LOD_HYSTERESIS_WORD = 128 / 4;

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
      writeBuffer: (
        buffer: MockBuffer,
        offset: number,
        data: ArrayBufferView | ArrayBuffer,
        dataOffset = 0,
        size?: number,
      ): void => {
        // Copy: the system reuses its scratch block, the test inspects every upload later. The
        // real API also accepts a raw `ArrayBuffer` + byte range (record feed), mirror it.
        let bytes: Uint8Array;
        if (data instanceof ArrayBuffer) {
          const len = size ?? data.byteLength - dataOffset;
          bytes = new Uint8Array(data.slice(dataOffset, dataOffset + len));
        } else {
          bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice();
        }
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
  lodDitherMode?: "crossfade" | "hard";
  lodTransitionMode?: LodTransitionMode;
  lodCrossfadeBand?: number;
  lodHysteresis?: number;
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
    options: {
      maxInstances: instances,
      cellSize: 10,
      cullPixelSize: 2,
      maxViews: 4,
      ...(extras.lodCrossfadeBand !== undefined
        ? { lodCrossfadeBand: extras.lodCrossfadeBand }
        : {}),
      ...(extras.lodHysteresis !== undefined ? { lodHysteresis: extras.lodHysteresis } : {}),
    },
    backlight: extras.backlight,
    windHeight: extras.windHeight,
    windUniforms: extras.windUniforms,
    lodDitherMode: extras.lodDitherMode,
    lodTransitionMode: extras.lodTransitionMode,
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

  it("sizes each segment page for the two-bucket worst case (2x population)", () => {
    const n = 5000;
    const { rec } = makeSetup(n);
    // `FieldInfo` is the last 128 B buffer the system creates; word 0 = pageCapacity.
    const fieldInfo = rec.buffers.filter((b) => b.size === FIELD_INFO_SIZE).at(-1);
    const info = rec.writes.find((w) => w.buffer === fieldInfo && w.offset === 0);
    expect(info).toBeDefined();
    const words = new Uint32Array((info!.data as Uint8Array).slice().buffer);
    // Pages cover the audited compaction worst case: a LOD crossfade band emits into the adjacent
    // {coarse, fine} pair, so 2x maxInstances is the per-segment capacity bound (WP-A1 2).
    expect(words[0]).toBe(2 * n); // pageCapacity
    // Pages only for the addressable segments: views [0,4) x 1 bucket -> highest bv = 3*8.
    const visible = rec.buffers.find((b) => b.size === (3 * MAX_LOD_BUCKETS + 1) * 2 * n * 4);
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

  it("live-toggles wind off/on via setWind (height word patched, per-frame uploads gated)", () => {
    const wind = new Float32Array(16);
    const { system, rec } = makeSetup(4, { windHeight: 9.5, windUniforms: wind });
    const fieldInfo = rec.buffers.filter((b) => b.size === FIELD_INFO_SIZE).at(-1)!;
    const windOffsetWrites = (): typeof rec.writes =>
      rec.writes.filter((w) => w.buffer === fieldInfo && w.offset === INFO_WIND_FLOAT * 4);
    const heightPatchBytes = (from: number): Float32Array => {
      const patch = rec.writes
        .slice(from)
        .find((w) => w.buffer === fieldInfo && w.offset === INFO_WIND_HEIGHT_FLOAT * 4);
      expect(patch).toBeDefined();
      return new Float32Array((patch!.data as Uint8Array).slice().buffer);
    };
    // Baseline (wind on): one per-frame wind upload.
    system.prepareMainView(VP, { x: 0, y: 0, z: 0 }, 720, 1);
    expect(windOffsetWrites()).toHaveLength(1);
    // Live OFF: height word patched to 0 THIS frame; no further wind uploads.
    const beforeOff = rec.writes.length;
    system.setWind(undefined, 0);
    expect(heightPatchBytes(beforeOff)[0]).toBe(0);
    system.prepareMainView(VP, { x: 0, y: 0, z: 0 }, 720, 1);
    expect(windOffsetWrites()).toHaveLength(1);
    // Live ON again: height word patched back; per-frame uploads resume.
    const beforeOn = rec.writes.length;
    system.setWind(wind, 9.5);
    expect(heightPatchBytes(beforeOn)[0]).toBe(9.5);
    system.prepareMainView(VP, { x: 0, y: 0, z: 0 }, 720, 1);
    expect(windOffsetWrites()).toHaveLength(2);
  });

  it("rejects a live-swapped wind height without a 16-float block (fail fast)", () => {
    const { system } = makeSetup(4);
    expect(() => system.setWind(undefined, 5)).toThrow(/windUniforms/);
    expect(() => system.setWind(new Float32Array(8), 5)).toThrow(/windUniforms/);
    // Valid no-op swap keeps the lane consistent.
    expect(() => system.setWind(undefined, 0)).not.toThrow();
  });

  it("writes the DECIDED default LOD dither mode (hard, gate 1) into FieldInfo — zero-config default is hysteresis", () => {
    // The engine zero-config default (ADR 0059 step 2, decision 2026-11-10) is `hysteresis`,
    // whose preset uses the HARD gate (1): no fragment crossfade pattern by default.
    const { rec } = makeSetup(4);
    const fieldInfo = rec.buffers.filter((b) => b.size === FIELD_INFO_SIZE).at(-1);
    const info = rec.writes.find((w) => w.buffer === fieldInfo && w.offset === 0);
    const words = new Uint32Array((info!.data as Uint8Array).slice().buffer);
    expect(words[INFO_LOD_DITHER_MODE_WORD]).toBe(1);
  });

  it("writes lodDitherMode 'hard' (candidate C) into FieldInfo and fails fast on bad modes", () => {
    const { rec } = makeSetup(4, { lodDitherMode: "hard" });
    const fieldInfo = rec.buffers.filter((b) => b.size === FIELD_INFO_SIZE).at(-1);
    const info = rec.writes.find((w) => w.buffer === fieldInfo && w.offset === 0);
    const words = new Uint32Array((info!.data as Uint8Array).slice().buffer);
    expect(words[INFO_LOD_DITHER_MODE_WORD]).toBe(1);
    expect(() => makeSetup(4, { lodDitherMode: "bogus" as never })).toThrow(/lodDitherMode/);
  });

  it("live-toggles the LOD dither mode via setLodDitherMode (FieldInfo word patched this frame)", () => {
    const { system, rec } = makeSetup(4);
    const fieldInfo = rec.buffers.filter((b) => b.size === FIELD_INFO_SIZE).at(-1)!;
    const patch = (from: number, expectValue: number): void => {
      const hit = rec.writes
        .slice(from)
        .find((w) => w.buffer === fieldInfo && w.offset === INFO_LOD_DITHER_MODE_WORD * 4);
      expect(hit).toBeDefined();
      expect(new Uint32Array((hit!.data as Uint8Array).slice().buffer)[0]).toBe(expectValue);
    };
    const fromHard = rec.writes.length;
    system.setLodDitherMode("hard");
    patch(fromHard, 1);
    const fromCross = rec.writes.length;
    system.setLodDitherMode("crossfade");
    patch(fromCross, 0);
  });

  it("creates the P2 LOD-blend pages at page capacity with NO CPU zero-fill (spec zero-init)", () => {
    const n = 4;
    const { rec } = makeSetup(n);
    // P2 blend pages allocate at the page-capacity bound (2x maxInstances, WP-A1 2) exactly like
    // the visible indices. The fail-closed inert invariant ("unwritten slot 0 = keep
    // unconditionally") is guaranteed by the WebGPU spec's zero-initialization of `createBuffer`
    // without `mappedAtCreation`; the explicit `writeBuffer(new Uint8Array(visibleBytes))` was
    // removed (it parked up to 64 MB on the JS heap per rebuild), so no full-page CPU write may
    // exist -- only the two buffers themselves are allocated at the page size.
    const visibleBytes = (3 * MAX_LOD_BUCKETS + 1) * 2 * n * 4;
    expect(rec.buffers.filter((b) => b.size === visibleBytes)).toHaveLength(2); // indices + blend
    expect(rec.writes.some((w) => w.data.byteLength === visibleBytes)).toBe(false);
  });

  it("lives-uploads replaced record bytes into the preallocated buffer (no regrow, count mirrored)", () => {
    const { system, rec } = makeSetup(4);
    // With maxInstances 4 the records buffer is the only 64-B buffer the system owns.
    const recordsBuffer = rec.buffers.find((b) => b.size === 4 * 16)!;
    expect(recordsBuffer).toBeDefined();

    const fresh = new Float32Array(3 * 4);
    const pose = new Uint32Array(1);
    pose[0] = packInstancePose(0, 1);
    const poseF = new Float32Array(pose.buffer)[0]!;
    for (let i = 0; i < 3; i++) {
      fresh[i * 4] = 10 + i;
      fresh[i * 4 + 1] = 2 + i;
      fresh[i * 4 + 2] = 3;
      fresh[i * 4 + 3] = poseF;
    }

    const buffersBefore = rec.buffers.length;
    system.setPopulationData(fresh);
    system.uploadRecords();

    // No allocation/regrow on the live path: buffer set is untouched.
    expect(rec.buffers.length).toBe(buffersBefore);
    expect(rec.buffers).toContain(recordsBuffer);

    // The new record bytes reached the (same) GPU buffer.
    const recordWrites = rec.writes.filter((w) => w.buffer === recordsBuffer && w.offset === 0);
    const last = recordWrites[recordWrites.length - 1]!;
    expect(last.data.byteLength).toBe(3 * 16);
    const floats = new Float32Array((last.data as Uint8Array).slice().buffer);
    expect(Array.from(floats.subarray(0, 12))).toEqual([
      10,
      2,
      3,
      poseF,
      11,
      3,
      3,
      poseF,
      12,
      4,
      3,
      poseF,
    ]);

    // The instance-count mirror followed the swap (FieldInfo word 2, offset 8).
    const fieldInfo = rec.buffers.filter((b) => b.size === FIELD_INFO_SIZE).at(-1)!;
    const infoWrites = rec.writes.filter((w) => w.buffer === fieldInfo && w.offset === 0);
    const infoWords = new Uint32Array(
      (infoWrites[infoWrites.length - 1]!.data as Uint8Array).slice().buffer,
    );
    expect(infoWords[8 / 4]).toBe(3);
  });

  // ---------------------------------------------------------------------------
  // P2 DECISIVE MODE SWITCH (moderator decision 2026-11-10): ONE declarative `LodTransitionMode`
  // derives the raw knobs end-to-end. The pins below freeze BOTH the preset table (against the
  // engine table) and the end-to-end application (FieldInfo gate word + cull param block).
  // Retune a preset only via the §6 protocol, then update `LOD_TRANSITION_MODES` + these pins.
  // ---------------------------------------------------------------------------

  /** Reinterprets the last uploaded main-view param block as f32 (band/hyst pad words). */
  function lastParamFloats(rec: Recorded): Float32Array {
    const block = lastParamBlock(rec, 0);
    return new Float32Array(block.buffer, block.byteOffset, block.length);
  }

  /** Reads the FieldInfo dither-gate word (52) of the initial upload. */
  function fieldInfoGateWord(rec: Recorded): number {
    const fieldInfo = rec.buffers.filter((b) => b.size === FIELD_INFO_SIZE).at(-1)!;
    const info = rec.writes.find((w) => w.buffer === fieldInfo && w.offset === 0);
    expect(info).toBeDefined();
    return new Uint32Array((info!.data as Uint8Array).slice().buffer)[INFO_LOD_DITHER_MODE_WORD]!;
  }

  /** Frozen end-to-end literal pins (2026-11-10) — MUST match `LOD_TRANSITION_MODES`. */
  const PINNED_APPLIED: Readonly<
    Record<LodTransitionMode, Readonly<{ band: number; hyst: number; gate: number }>>
  > = {
    off: { band: 0, hyst: 0, gate: 1 },
    hysteresis: { band: 0, hyst: 0.02, gate: 1 },
    dither: { band: 0.25, hyst: 0, gate: 0 },
    "dither-hysteresis": { band: 0.25, hyst: 0.02, gate: 0 },
  };

  it("applies a setup LodTransitionMode end-to-end (gate word + cull band/hysteresis derive from the preset)", () => {
    for (const mode of Object.keys(PINNED_APPLIED) as LodTransitionMode[]) {
      const { system, rec } = makeSetup(4, { lodTransitionMode: mode });
      expect(system.lodTransitionMode).toBe(mode);
      system.prepareMainView(VP, { x: 0, y: 0, z: 0 }, 720, 1);
      expect(fieldInfoGateWord(rec)).toBe(PINNED_APPLIED[mode].gate);
      const floats = lastParamFloats(rec);
      expect(floats[CULL_LOD_CROSSFADE_BAND_WORD]).toBeCloseTo(PINNED_APPLIED[mode].band, 6);
      expect(floats[CULL_LOD_HYSTERESIS_WORD]).toBeCloseTo(PINNED_APPLIED[mode].hyst, 6);
    }
  });

  it("the applied knobs always equal the engine preset table (no frozen-literal drift)", () => {
    for (const mode of Object.keys(PINNED_APPLIED) as LodTransitionMode[]) {
      const preset = LOD_TRANSITION_MODES[mode];
      expect(PINNED_APPLIED[mode]).toEqual({
        band: preset.crossfadeBand,
        hyst: preset.hysteresis,
        gate: preset.ditherGate,
      });
    }
  });

  it("defaults to the DECIDED engine default `hysteresis` (band 0, hyst 0.02, hard gate)", () => {
    // Engine-zero-config default (ADR 0059 step 2, decision 2026-11-10): rate-limited hard
    // switching, no dither pattern. `off` = explicit opt-in, no longer the default.
    const { system, rec } = makeSetup(4);
    expect(system.lodTransitionMode).toBe("hysteresis");
    system.prepareMainView(VP, { x: 0, y: 0, z: 0 }, 720, 1);
    const floats = lastParamFloats(rec);
    expect(floats[CULL_LOD_CROSSFADE_BAND_WORD]).toBe(0);
    expect(floats[CULL_LOD_HYSTERESIS_WORD]).toBeCloseTo(0.02, 6);
    // Hysteresis uses the HARD gate word (1): no crossfade pattern in fragments.
    expect(fieldInfoGateWord(rec)).toBe(1);
  });

  it("authored raw transition knobs stay on the legacy raw path (the engine default does NOT override them)", () => {
    // Documented contract: a mode "when present takes precedence" — so ABSENT mode honors
    // authored raw band/hysteresis knobs instead of applying the zero-config hysteresis default.
    // This preserves the fine-tuning escape hatch (no silent clobber of explicit author intent).
    const { system, rec } = makeSetup(4, { lodCrossfadeBand: 0.3, lodHysteresis: 0.1 });
    system.prepareMainView(VP, { x: 0, y: 0, z: 0 }, 720, 1);
    const floats = lastParamFloats(rec);
    expect(floats[CULL_LOD_CROSSFADE_BAND_WORD]).toBeCloseTo(0.3, 6);
    expect(floats[CULL_LOD_HYSTERESIS_WORD]).toBeCloseTo(0.1, 6);
  });

  it("fails fast on an unknown LodTransitionMode (engine default applies until a valid mode is set)", () => {
    expect(() => makeSetup(4, { lodTransitionMode: "geomorph" as never })).toThrow(
      /lodTransitionMode/,
    );
    // Absent mode (engine zero-config default hysteresis) is valid and builds cleanly.
    expect(() => makeSetup(4, {})).not.toThrow();
    expect(() => makeSetup(4, {}).system.setLodTransitionMode("bogus" as never)).toThrow(
      /lodTransitionMode/,
    );
  });

  it("live-swaps modes: the dither gate patches THIS frame, the cull knobs on the next frame", () => {
    const { system, rec } = makeSetup(4);
    const fieldInfo = rec.buffers.filter((b) => b.size === FIELD_INFO_SIZE).at(-1)!;
    const gatePatch = (from: number, value: number): void => {
      const hit = rec.writes
        .slice(from)
        .find((w) => w.buffer === fieldInfo && w.offset === INFO_LOD_DITHER_MODE_WORD * 4);
      expect(hit).toBeDefined();
      expect(new Uint32Array((hit!.data as Uint8Array).slice().buffer)[0]).toBe(value);
    };
    // Crossfade modes arm the gate (word 0); hard presets disarm it (word 1) — immediately.
    const fromDither = rec.writes.length;
    system.setLodTransitionMode("dither");
    gatePatch(fromDither, 0);
    expect(system.lodTransitionMode).toBe("dither");
    const fromOff = rec.writes.length;
    system.setLodTransitionMode("off");
    gatePatch(fromOff, 1);
    expect(system.lodTransitionMode).toBe("off");
    // The next cull frame carries the OFF knobs (band 0, hyst 0).
    system.prepareMainView(VP, { x: 0, y: 0, z: 0 }, 720, 1);
    const floats = lastParamFloats(rec);
    expect(floats[CULL_LOD_CROSSFADE_BAND_WORD]).toBe(0);
    expect(floats[CULL_LOD_HYSTERESIS_WORD]).toBe(0);
  });

  it("raw-knob setters do not change the applied mode (each surface is last-call-wins)", () => {
    const { system } = makeSetup(4);
    expect(system.lodTransitionMode).toBe("hysteresis");
    // A raw retune without a preset leaves the mode mirror at the engine default base.
    system.setLodTransition({ crossfadeBand: 0.5, hysteresis: 0.5, biasPx: -3 });
    expect(system.lodTransitionMode).toBe("hysteresis");
    system.setLodTransitionMode("hysteresis");
    expect(system.lodTransitionMode).toBe("hysteresis");
    // Later raw retunes keep the last applied mode (knobs are the derived escape hatch).
    system.setLodTransition({ crossfadeBand: 0.3 });
    expect(system.lodTransitionMode).toBe("hysteresis");
  });
});
