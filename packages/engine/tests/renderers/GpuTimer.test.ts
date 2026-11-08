import "../../src/index.js";
import { describe, expect, it, vi } from "vitest";
import { GpuTimer, GpuTimingSlot } from "../../src/renderers/WebGPU/managers/GpuTimer.js";
import { MainRenderPass } from "../../src/renderers/passes/MainRenderPass.js";

// Node/vitest has no WebGPU globals; @webgpu/types only provides ambient TS types, not a runtime
// value. Stub the bit-flag constants the code under test reads at call time (mirrors
// HzbOcclusionPassGPU.test.ts). Nothing here requires a real GPU or `navigator.gpu`.
(globalThis as unknown as { GPUBufferUsage: Record<string, number> }).GPUBufferUsage ??= {
  MAP_READ: 0x0001,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  QUERY_RESOLVE: 0x0010,
};
(globalThis as unknown as { GPUMapMode: Record<string, number> }).GPUMapMode ??= {
  READ: 0x1,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Internals = any;

const RING_DEPTH = 8;
const MAX_SEGMENTS = 16;
/** Recreated in tests as the final shipped write shape (see `GpuTimer.ts`'s API note). */
type FinalWrites = {
  querySet: unknown;
  beginOfPassWriteIndex: number;
  endOfPassWriteIndex: number;
};

interface FakeQuerySet {
  destroy: ReturnType<typeof vi.fn>;
}

function makeQuerySet(): FakeQuerySet {
  return { destroy: vi.fn() };
}

/** Staging buffer whose `mapState` the test flips manually to simulate a completed GPU map. */
interface FakeBuffer {
  readonly backing: BigUint64Array;
  mapState: "unmapped" | "pending" | "mapped";
  mapAsync: ReturnType<typeof vi.fn>;
  getMappedRange: ReturnType<typeof vi.fn>;
  unmap: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
}

function makeBuffer(): FakeBuffer {
  const backing = new BigUint64Array(MAX_SEGMENTS * 2);
  const buffer: FakeBuffer = {
    backing,
    mapState: "unmapped",
    mapAsync: vi.fn(() => Promise.resolve()),
    getMappedRange: vi.fn(() => backing.buffer),
    unmap: vi.fn(() => {
      buffer.mapState = "unmapped";
    }),
    destroy: vi.fn(() => {
      buffer.mapState = "unmapped";
    }),
  };
  return buffer;
}

function makeDevice(opts: { feature: boolean; periodNs?: number | null }): {
  device: Internals;
  querySets: FakeQuerySet[];
  /** `MAP_READ|COPY_DST` staging copies (one per ring slot; the only buffers ever mapped). */
  staging: FakeBuffer[];
  /** `QUERY_RESOLVE|COPY_SRC` resolveQuerySet destinations (one per ring slot). */
  resolve: FakeBuffer[];
} {
  const querySets: FakeQuerySet[] = [];
  const staging: FakeBuffer[] = [];
  const resolve: FakeBuffer[] = [];
  const gpuBufferUsage = (globalThis as unknown as { GPUBufferUsage: Record<string, number> })
    .GPUBufferUsage;
  const device = {
    features: { has: vi.fn(() => opts.feature) },
    createQuerySet: vi.fn(() => {
      const qs = makeQuerySet();
      querySets.push(qs);
      return qs;
    }),
    createBuffer: vi.fn((desc: { usage?: number }) => {
      const b = makeBuffer();
      if ((desc.usage ?? 0) & (gpuBufferUsage["MAP_READ"] ?? 0)) staging.push(b);
      else resolve.push(b);
      return b;
    }),
    // `undefined` keeps the historical default `1`; `null` reproduces the Chrome 157 / Metal-3
    // reality where the method exists but returns nothing usable.
    queue: {
      getTimestampPeriod: vi.fn(() => (opts.periodNs === undefined ? 1 : opts.periodNs)),
    },
  } as Internals;
  return { device, querySets, staging, resolve };
}

function makeCe(): { ce: Internals } {
  return {
    ce: { resolveQuerySet: vi.fn(), copyBufferToBuffer: vi.fn() },
  };
}

/** First render-pass descriptor recorded via `ce.beginRenderPass` (mock-call extraction). */
function firstDescriptor(ce: Internals): Internals {
  return (ce.beginRenderPass as ReturnType<typeof vi.fn>).mock.calls[0]![0];
}

function finalWrites(w: ReturnType<GpuTimer["recordPass"]>): FinalWrites {
  return w as unknown as FinalWrites;
}

/** Simulates the GPU completing a map: writes a `deltaNs` begin/end pair for one segment into the
 * staging buffer and marks it readable (`mapState === "mapped"`). */
function completeMap(buffer: FakeBuffer, segmentIndex: number, deltaNs: bigint): void {
  buffer.backing[segmentIndex * 2] = 1_000_000_000n;
  buffer.backing[segmentIndex * 2 + 1] = 1_000_000_000n + deltaNs;
  buffer.mapState = "mapped";
}

describe("GpuTimer", () => {
  describe("state machine (unsupported / disabled / enabled)", () => {
    it("reports supported=false while no device is attached and without the feature", () => {
      const timer = new GpuTimer();
      expect(timer.supported).toBe(false);
      expect(timer.enabled).toBe(false);
      expect(timer.snapshot.supported).toBe(false);
      expect(timer.snapshot.enabled).toBe(false);
      expect(timer.snapshot.frameIndex).toBe(-1);
      expect(timer.snapshot.segments).toHaveLength(0);
    });

    it("is fully inert before enable(): no GPU objects are created and endFrame records nothing", () => {
      const { device, querySets, staging, resolve } = makeDevice({ feature: true });
      const timer = new GpuTimer();
      timer.attachDevice(device as never);

      expect(querySets).toHaveLength(0);
      expect(staging).toHaveLength(0);
      expect(resolve).toHaveLength(0);
      expect(timer.enabled).toBe(false);
      expect(timer.recordPass("x")).toBeUndefined();

      timer.beginFrame();
      const { ce } = makeCe();
      timer.endFrame(ce as never);
      expect(ce.resolveQuerySet).not.toHaveBeenCalled();
    });

    it("stays disabled when the feature is absent, even after enable()", () => {
      const { device } = makeDevice({ feature: false });
      const timer = new GpuTimer();
      timer.attachDevice(device as never);
      timer.enable();

      expect(timer.supported).toBe(false);
      expect(timer.enabled).toBe(false);
      expect(timer.recordPass("x")).toBeUndefined();
      const { ce } = makeCe();
      timer.beginFrame();
      timer.endFrame(ce as never);
      expect(ce.resolveQuerySet).not.toHaveBeenCalled();
    });

    it("enable() on a supported device creates the ring; disable() destroys it and reverts to inert", () => {
      const { device, querySets, staging, resolve } = makeDevice({ feature: true });
      const timer = new GpuTimer();
      timer.attachDevice(device as never);

      timer.enable();
      expect(timer.enabled).toBe(true);
      expect(timer.snapshot.enabled).toBe(true);
      expect(querySets).toHaveLength(RING_DEPTH);
      // Two buffers per slot: the QUERY_RESOLVE destination and the MAP_READ copy target (see
      // `GpuTimer.endFrame` — MAP_READ may only pair with COPY_DST, so they cannot be one buffer).
      expect(staging).toHaveLength(RING_DEPTH);
      expect(resolve).toHaveLength(RING_DEPTH);
      expect(device.createBuffer).toHaveBeenCalledWith(
        expect.objectContaining({ size: MAX_SEGMENTS * 2 * 8 }),
      );

      timer.disable();
      expect(timer.enabled).toBe(false);
      expect(querySets[0]!.destroy).toHaveBeenCalledTimes(1);
      expect(staging[0]!.destroy).toHaveBeenCalledTimes(1);
      expect(resolve[0]!.destroy).toHaveBeenCalledTimes(1);
      expect(timer.recordPass("x")).toBeUndefined();

      // Stale flush: a resolve into the (reused) descriptor must no longer happen.
      const { ce } = makeCe();
      timer.beginFrame();
      timer.endFrame(ce as never);
      expect(ce.resolveQuerySet).not.toHaveBeenCalled();
    });

    it("dispose() detaches the device and reports supported=false afterwards", () => {
      const { device, querySets } = makeDevice({ feature: true });
      const timer = new GpuTimer();
      timer.attachDevice(device as never);
      timer.enable();
      timer.dispose();

      expect(timer.enabled).toBe(false);
      expect(timer.supported).toBe(false);
      expect(querySets[0]!.destroy).toHaveBeenCalledTimes(1);
    });
  });

  describe("recordPass / ring maths", () => {
    it("hands out sequential index pairs on the current frame's query set (zero-GC reused pair)", () => {
      const { device, querySets } = makeDevice({ feature: true });
      const timer = new GpuTimer();
      timer.attachDevice(device as never);
      timer.enable();
      timer.beginFrame();

      // The returned pair is a single REUSED object (consumed synchronously by beginRenderPass),
      // so each read must happen right after its recordPass call -- asserting late would observe
      // the next call's overwrite.
      const a = finalWrites(timer.recordPass("a"));
      expect(a.beginOfPassWriteIndex).toBe(0);
      expect(a.endOfPassWriteIndex).toBe(1);
      const b = finalWrites(timer.recordPass("b"));
      expect(b.beginOfPassWriteIndex).toBe(2);
      expect(b.endOfPassWriteIndex).toBe(3);
      expect(b).toBe(a); // documented reuse contract
      expect(b.querySet).toBe(querySets[1]); // first beginFrame advances head to slot 1
    });

    it("reuses the same query set after a full ring turn and resets the indices", () => {
      const { device, querySets } = makeDevice({ feature: true });
      const timer = new GpuTimer();
      timer.attachDevice(device as never);
      timer.enable();

      const first = ((): FinalWrites => {
        timer.beginFrame();
        return finalWrites(timer.recordPass("first"));
      })();

      // One full ring turn: 8 beginFrames leave head exactly where the first frame recorded
      // (slot 1). Not recording in the last step so the "wrapped" write is the first one there.
      for (let i = 0; i < RING_DEPTH - 1; i++) {
        timer.beginFrame();
        timer.recordPass(`frame-${i}`);
      }
      timer.beginFrame();

      const wrapped = finalWrites(timer.recordPass("wrapped"));
      expect(wrapped.querySet).toBe(first.querySet);
      expect(wrapped.querySet).toBe(querySets[1]);
      expect(wrapped.beginOfPassWriteIndex).toBe(0);
      expect(wrapped.endOfPassWriteIndex).toBe(1);
    });

    it("fails closed when the per-frame segment budget is exhausted", () => {
      const { device } = makeDevice({ feature: true });
      const timer = new GpuTimer();
      timer.attachDevice(device as never);
      timer.enable();
      timer.beginFrame();

      for (let i = 0; i < MAX_SEGMENTS; i++) {
        expect(timer.recordPass(`s${i}`)).toBeDefined();
      }
      expect(timer.recordPass("overflow")).toBeUndefined();
    });
  });

  describe("endFrame resolve recording", () => {
    it("resolves exactly the recorded segment count of the current frame into its staging buffer", () => {
      const { device, querySets, staging, resolve } = makeDevice({ feature: true });
      const timer = new GpuTimer();
      timer.attachDevice(device as never);
      timer.enable();

      timer.beginFrame();
      timer.recordPass("a");
      timer.recordPass("b");
      const { ce } = makeCe();
      timer.endFrame(ce as never);

      expect(ce.resolveQuerySet).toHaveBeenCalledTimes(1);
      expect(ce.resolveQuerySet).toHaveBeenCalledWith(querySets[1], 0, 4, resolve[1], 0);
      expect(ce.copyBufferToBuffer).toHaveBeenCalledTimes(1);
      expect(ce.copyBufferToBuffer).toHaveBeenCalledWith(resolve[1], 0, staging[1], 0, 4 * 8);
    });

    it("records nothing when the frame had no segments", () => {
      const { device } = makeDevice({ feature: true });
      const timer = new GpuTimer();
      timer.attachDevice(device as never);
      timer.enable();
      timer.beginFrame();

      const { ce } = makeCe();
      timer.endFrame(ce as never);
      expect(ce.resolveQuerySet).not.toHaveBeenCalled();
    });

    it("skips resolving while the staging buffer's previous map is still outstanding (clean degradation)", () => {
      const { device } = makeDevice({ feature: true });
      const timer = new GpuTimer();
      timer.attachDevice(device as never);
      timer.enable();

      // Record one full ring turn WITHOUT ever consuming the readbacks: every slot ends the turn
      // with a still-outstanding map, so the wrap-around reuse must not resolve into a mapped
      // buffer (validation error on a real device).
      for (let i = 0; i < RING_DEPTH; i++) {
        timer.beginFrame();
        timer.recordPass(`frame-${i}`);
        const { ce } = makeCe();
        timer.endFrame(ce as never);
      }

      // Ring wrap: slot 1 is reused while its map is still pending -> resolve must be skipped.
      const { ce } = makeCe();
      timer.beginFrame();
      timer.recordPass("wrapped");
      timer.endFrame(ce as never);
      expect(ce.resolveQuerySet).not.toHaveBeenCalled();
    });
  });

  describe("async readback pipeline", () => {
    it("kicks mapAsync once per frame and parses a completed readback into the snapshot", () => {
      const { device, staging } = makeDevice({ feature: true, periodNs: 1 });
      const timer = new GpuTimer();
      timer.attachDevice(device as never);
      timer.enable();

      // Frame 1 records "main:opaque" (head -> slot 1).
      timer.beginFrame();
      timer.recordPass(GpuTimingSlot.MAIN_COLOR_OPAQUE);
      const { ce } = makeCe();
      timer.endFrame(ce as never);

      // Frame 2 kicks the map for slot 1 (previous frame's submit already happened).
      timer.beginFrame();
      timer.recordPass("other");
      const { ce: ce2 } = makeCe();
      timer.endFrame(ce2 as never);
      expect(staging[1]!.mapAsync).toHaveBeenCalledTimes(1);

      // GPU finishes: the staging buffer becomes mapped with a 1s segment.
      completeMap(staging[1]!, 0, 1_000_000_000n);

      // Frame 3 consumes the completed readback.
      timer.beginFrame();
      timer.recordPass("next");
      const { ce: ce3 } = makeCe();
      timer.endFrame(ce3 as never);

      const snap = timer.snapshot;
      expect(snap.frameIndex).toBe(1);
      expect(snap.supported).toBe(true);
      expect(snap.enabled).toBe(true);
      expect(snap.segments).toHaveLength(1);
      expect(snap.segments[0]!.name).toBe(GpuTimingSlot.MAIN_COLOR_OPAQUE);
      expect(snap.segments[0]!.ms).toBeCloseTo(1000, 6);
    });

    it("applies the device timestamp period in the ms conversion", () => {
      const { device, staging } = makeDevice({ feature: true, periodNs: 100 });
      const timer = new GpuTimer();
      timer.attachDevice(device as never);
      timer.enable();

      timer.beginFrame();
      timer.recordPass("a");
      const { ce } = makeCe();
      timer.endFrame(ce as never);

      timer.beginFrame(); // kicks map
      timer.recordPass("b");
      const { ce: ce2 } = makeCe();
      timer.endFrame(ce2 as never);

      completeMap(staging[1]!, 0, 10_000_000n); // 10 ms at period 1, * 100 period = 1000 ms
      timer.beginFrame();
      timer.recordPass("c");
      const { ce: ce3 } = makeCe();
      timer.endFrame(ce3 as never);

      expect(timer.snapshot.frameIndex).toBe(1);
      expect(timer.snapshot.segments[0]!.ms).toBeCloseTo(1000, 6);
    });

    it("drops a segment whose delta is not positive (end <= begin => not measured)", () => {
      const { device, staging } = makeDevice({ feature: true });
      const timer = new GpuTimer();
      timer.attachDevice(device as never);
      timer.enable();

      timer.beginFrame();
      timer.recordPass("zero");
      const { ce } = makeCe();
      timer.endFrame(ce as never);

      timer.beginFrame();
      timer.recordPass("x");
      const { ce: ce2 } = makeCe();
      timer.endFrame(ce2 as never);

      staging[1]!.backing[0] = 1_000_000_000n;
      staging[1]!.backing[1] = 1_000_000_000n; // zero delta
      staging[1]!.mapState = "mapped";
      timer.beginFrame();
      timer.recordPass("y");
      const { ce: ce3 } = makeCe();
      timer.endFrame(ce3 as never);

      expect(timer.snapshot.frameIndex).toBe(1);
      expect(timer.snapshot.segments).toHaveLength(0);
    });

    it("keeps the newest published frame when an older readback arrives late (monotonic guard)", () => {
      const { device, staging } = makeDevice({ feature: true });
      const timer = new GpuTimer();
      timer.attachDevice(device as never);
      timer.enable();

      // Record 4 frames; only slot 3's and slot 1's readbacks will complete, out of order.
      for (let i = 0; i < 4; i++) {
        timer.beginFrame();
        timer.recordPass(`f${i + 1}`);
        const { ce } = makeCe();
        timer.endFrame(ce as never);
      }

      // Frame 5: kicks slot 4's map; slot 3's readback completes with a huge delta first.
      const { ce: ce4 } = makeCe();
      timer.beginFrame();
      timer.recordPass("f5");
      timer.endFrame(ce4 as never);
      completeMap(staging[3]!, 0, 500_000_000n);
      const { ce: ce5 } = makeCe();
      timer.beginFrame();
      timer.recordPass("f6");
      timer.endFrame(ce5 as never);
      expect(timer.snapshot.frameIndex).toBe(3);

      // Now an OLDER readback (slot 1, frame 1) arrives late: it must not regress the snapshot.
      staging[1]!.backing[0] = 1_000_000_000n;
      staging[1]!.backing[1] = 1_500_000_000n;
      staging[1]!.mapState = "mapped";
      const { ce: ce6 } = makeCe();
      timer.beginFrame();
      timer.recordPass("f7");
      timer.endFrame(ce6 as never);

      expect(timer.snapshot.frameIndex).toBe(3);
      expect(timer.snapshot.segments[0]!.ms).toBeCloseTo(500, 6);
    });
  });

  describe("begin=0 adapter quirk (Chrome 157 / Metal-3, 2026-11-08)", () => {
    // The begin-of-pass slot is never written on this target class (stays 0); end-of-pass holds an
    // ABSOLUTE monotonic counter (~7.9e14, ~9 days of uptime in ns). `end - begin` would yield the
    // absolute counter. The fix derives the duration from successive end counters per name across
    // CONTIGUOUS frames; a gap drops the baselines (segment honestly absent, never multi-frame).
    const ABS_1 = 789_932_469_518_336n;
    const ABS_2 = ABS_1 + 8_323_072n; // ~8.3 ms

    it("skips the baseline frame, then derives the per-frame duration from successive end counters", () => {
      const { device, staging } = makeDevice({ feature: true, periodNs: 1 });
      const timer = new GpuTimer();
      timer.attachDevice(device as never);
      timer.enable();

      // Frame 1 (slot 1) records; its map is kicked on frame 2.
      timer.beginFrame();
      timer.recordPass(GpuTimingSlot.MAIN_COLOR_OPAQUE);
      const { ce } = makeCe();
      timer.endFrame(ce as never);
      timer.beginFrame();
      timer.recordPass(GpuTimingSlot.MAIN_COLOR_OPAQUE);
      const { ce: ce2 } = makeCe();
      timer.endFrame(ce2 as never);

      // GPU completes frame 1: begin=0, end=ABS_1 (absolute counter).
      staging[1]!.backing[0] = 0n;
      staging[1]!.backing[1] = ABS_1;
      staging[1]!.mapState = "mapped";

      // Frame 3 consumes it: no baseline yet -> establishes one, contributes no segment.
      timer.beginFrame();
      timer.recordPass("next");
      const { ce: ce3 } = makeCe();
      timer.endFrame(ce3 as never);
      expect(timer.snapshot.frameIndex).toBe(1);
      expect(timer.snapshot.segments).toHaveLength(0);

      // Frame 2 (slot 2) completes: begin=0, end=ABS_2 (> ABS_1).
      staging[2]!.backing[0] = 0n;
      staging[2]!.backing[1] = ABS_2;
      staging[2]!.mapState = "mapped";

      // Frame 4 consumes it (contiguous after frame 1) -> duration = ABS_2 - ABS_1.
      timer.beginFrame();
      timer.recordPass("next2");
      const { ce: ce4 } = makeCe();
      timer.endFrame(ce4 as never);
      expect(timer.snapshot.frameIndex).toBe(2);
      expect(timer.snapshot.segments).toHaveLength(1);
      expect(timer.snapshot.segments[0]!.name).toBe(GpuTimingSlot.MAIN_COLOR_OPAQUE);
      expect(timer.snapshot.segments[0]!.ms).toBeCloseTo(8.323072, 4);
    });

    it("drops baselines across a dropped frame and resumes with a clean delta (no multi-frame span)", () => {
      const { device, staging } = makeDevice({ feature: true, periodNs: 1 });
      const timer = new GpuTimer();
      timer.attachDevice(device as never);
      timer.enable();

      const ABS_3 = ABS_1 + 20_000_000n;
      const ABS_4 = ABS_3 + 8_000_000n;

      // Frame 1 (slot 1): record, map kicked, readback completes -> baseline established only.
      timer.beginFrame();
      timer.recordPass(GpuTimingSlot.MAIN_COLOR_OPAQUE);
      const { ce } = makeCe();
      timer.endFrame(ce as never);
      timer.beginFrame();
      timer.recordPass(GpuTimingSlot.MAIN_COLOR_OPAQUE);
      const { ce: ce2 } = makeCe();
      timer.endFrame(ce2 as never);
      staging[1]!.backing[0] = 0n;
      staging[1]!.backing[1] = ABS_1;
      staging[1]!.mapState = "mapped";
      timer.beginFrame();
      timer.recordPass(GpuTimingSlot.MAIN_COLOR_OPAQUE);
      const { ce: ce3 } = makeCe();
      timer.endFrame(ce3 as never);
      expect(timer.snapshot.frameIndex).toBe(1);
      expect(timer.snapshot.segments).toHaveLength(0);

      // Frame 2 (slot 2) readback NEVER completes (dropped/lost).

      // Frame 3 (slot 3): readback completes -> gap vs frame 1 -> baselines dropped, new baseline.
      timer.beginFrame();
      timer.recordPass(GpuTimingSlot.MAIN_COLOR_OPAQUE);
      const { ce: ce4 } = makeCe();
      timer.endFrame(ce4 as never);
      staging[3]!.backing[0] = 0n;
      staging[3]!.backing[1] = ABS_3;
      staging[3]!.mapState = "mapped";
      timer.beginFrame();
      timer.recordPass(GpuTimingSlot.MAIN_COLOR_OPAQUE);
      const { ce: ce5 } = makeCe();
      timer.endFrame(ce5 as never);
      expect(timer.snapshot.frameIndex).toBe(3);
      expect(timer.snapshot.segments).toHaveLength(0);

      // Frame 4 (slot 4): contiguous after frame 3 -> clean single-frame delta, NOT ABS_4 - ABS_1.
      timer.beginFrame();
      timer.recordPass(GpuTimingSlot.MAIN_COLOR_OPAQUE);
      const { ce: ce6 } = makeCe();
      timer.endFrame(ce6 as never);
      staging[4]!.backing[0] = 0n;
      staging[4]!.backing[1] = ABS_4;
      staging[4]!.mapState = "mapped";
      timer.beginFrame();
      timer.recordPass(GpuTimingSlot.MAIN_COLOR_OPAQUE);
      const { ce: ce7 } = makeCe();
      timer.endFrame(ce7 as never);
      expect(timer.snapshot.frameIndex).toBe(4);
      expect(timer.snapshot.segments).toHaveLength(1);
      expect(timer.snapshot.segments[0]!.ms).toBeCloseTo(8, 4);
    });

    it("falls back to period 1 when getTimestampPeriod exists but returns null (M4-Pro reality)", () => {
      const { device, staging } = makeDevice({ feature: true, periodNs: null });
      const timer = new GpuTimer();
      timer.attachDevice(device as never);
      timer.enable();

      timer.beginFrame();
      timer.recordPass("a");
      const { ce } = makeCe();
      timer.endFrame(ce as never);
      timer.beginFrame();
      timer.recordPass("b");
      const { ce: ce2 } = makeCe();
      timer.endFrame(ce2 as never);
      completeMap(staging[1]!, 0, 10_000_000n); // 10 ms at period 1
      timer.beginFrame();
      timer.recordPass("c");
      const { ce: ce3 } = makeCe();
      timer.endFrame(ce3 as never);
      expect(timer.snapshot.frameIndex).toBe(1);
      expect(timer.snapshot.segments[0]!.ms).toBeCloseTo(10, 6);
    });
  });
});

describe("MainRenderPass gpuTimings hook (K5)", () => {
  function makePassRenderer(recordPass: Internals): Internals {
    return {
      targetClearColor: { r: 0, g: 0, b: 0, a: 1 },
      activeDepthView: { mock: "depthView" },
      gpuTimings: { recordPass },
    };
  }

  it("wires the timestamp pair into the render pass descriptor while recording", () => {
    const writes = {
      querySet: {} as never,
      beginningOfPassWriteIndex: 0,
      endOfPassWriteIndex: 1,
    };
    const recordPass = vi.fn(() => writes);
    const renderer = makePassRenderer(recordPass);
    const rp = { end: vi.fn() };
    const ce = { beginRenderPass: vi.fn(() => rp) };

    (new MainRenderPass() as Internals)._beginPass(
      ce,
      renderer,
      { mock: "target" },
      undefined,
      true,
      GpuTimingSlot.MAIN_COLOR_OPAQUE,
    );

    expect(recordPass).toHaveBeenCalledWith(GpuTimingSlot.MAIN_COLOR_OPAQUE);
    const descriptor = firstDescriptor(ce);
    expect(descriptor.timestampWrites).toBe(writes);
  });

  it("clears a stale timestamp pair once timing turns off (no leak into the next frame)", () => {
    const renderer = makePassRenderer(vi.fn(() => undefined));
    const rp = { end: vi.fn() };
    const ce = { beginRenderPass: vi.fn(() => rp) };

    const pass = new MainRenderPass() as Internals;
    // Prime the reused clear descriptor with a stale pair, as if a previous frame had timing on.
    pass._clearDescriptor.timestampWrites = { querySet: {} as never };

    pass._beginPass(ce, renderer, {}, undefined, true, "main:opaque");
    const descriptor = firstDescriptor(ce);
    expect(descriptor).not.toHaveProperty("timestampWrites");
  });

  it("integrates with the real GpuTimer end-to-end (headless, fake device)", () => {
    const { device, querySets, resolve, staging } = makeDevice({ feature: true });
    const timer = new GpuTimer();
    timer.attachDevice(device as never);
    timer.enable();

    const renderer = makePassRenderer(timer.recordPass.bind(timer));
    const pass = new MainRenderPass() as Internals;
    const rp = { end: vi.fn() };
    const ce = {
      beginRenderPass: vi.fn(() => rp),
      resolveQuerySet: vi.fn(),
      copyBufferToBuffer: vi.fn(),
    };

    timer.beginFrame();
    pass._beginPass(ce, renderer, { mock: "target" }, undefined, true, "main");
    timer.endFrame(ce as never);

    expect(querySets[1]).toBeDefined();
    expect(firstDescriptor(ce).timestampWrites).toBeDefined();
    expect(ce.resolveQuerySet).toHaveBeenCalledWith(querySets[1], 0, 2, resolve[1], 0);
    expect(ce.copyBufferToBuffer).toHaveBeenCalledWith(resolve[1], 0, staging[1], 0, 2 * 8);
  });
});
