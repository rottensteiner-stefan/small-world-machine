/**
 * Opt-in per-pass GPU timing via the `timestamp-query` feature (ADR 0059 step 0, DECISION K5 in
 * `WebGPURenderer`). The renderer always *requests* the feature at device creation (and surfaces
 * it via `supportsTimestampQuery`), but creates nothing -- `GpuTimer` only allocates a ring of
 * query sets while `enable()`d, so the stock render path is byte-identical until a consumer opts
 * in. This class owns every GPU object and all async resolve/readback; `WebGPURenderer` only
 * forwards five lifecycle calls and the two guarded `recordPass()` hook points in the passes.
 *
 * Pipeline: passes acquire a reused timestamp-write pair per recorded segment via `recordPass()`;
 * `endFrame()` records `resolveQuerySet` into this frame's encoder (after all pass work, same
 * submission, so the resolved data is final); the next `beginFrame()` kicks `mapAsync` (the
 * previous frame's `queue.submit` ran synchronously in between) and, on the frames after that,
 * polls `buffer.mapState` -- the proven non-stalling pattern of `HzbOcclusionSystem` -- parsing
 * the completed readback into the (reused) snapshot. No CPU waits on the GPU: a ring of
 * `RING_DEPTH` query sets absorbs the latency, a lagging GPU (CPU running more than `RING_DEPTH`
 * frames ahead) simply loses intermediate samples by design instead of stalling or corrupting.
 *
 * Zero-GC discipline: the hot path (`recordPass`, `beginFrame`, `endFrame`) performs no heap
 * allocations -- segment names are recorded into pre-sized slots, the returned timestamp-write
 * pair is a single reused object (consumed synchronously by `beginRenderPass`, so overwriting it
 * between calls is safe), and the snapshot reuses its internal buffers. Only the async readback
 * path (per completed frame: a `BigUint64Array` view + a `mapAsync`/catch promise chain) allocates,
 * matching the established `HzbOcclusionSystem` readback cost.
 */

/**
 * Engine-instrumented named timing slots (`@fixed`: reserved engine identifiers; the generic
 * `GpuTimer.recordPass()` API still accepts arbitrary names for passes wired up later, e.g.
 * shadow or depth pre-pass). Segment ms are reported under exactly these names on `snapshot`.
 * The three `MAIN_COLOR_*` segments together cover the main scene colour pass (their sum is the
 * whole-pass GPU time; `MainRenderPass` opens them as separate render passes, so separate write
 * pairs are required).
 */
export enum GpuTimingSlot {
  /** Opaque + skybox segment of the main scene colour pass. */
  MAIN_COLOR_OPAQUE = "main:opaque",
  /** Decal segment of the main scene colour pass (only while decals exist). */
  MAIN_COLOR_DECAL = "main:decal",
  /** Transparent segment of the main scene colour pass (only while transparents exist). */
  MAIN_COLOR_TRANSPARENT = "main:transparent",
  /** Final compositing blit of the post-processing pass. Note: the pre-uber effect chain
   * (TAA/bloom/HBAO/...) runs inside `PostFxChain`'s per-effect pass registry and is NOT yet
   * instrumented; this slot covers the `PostProcessPass` uber blit only. */
  POST_UBER = "post:uber",
}

/** One recorded segment of a completed frame (`@derived`: computed from raw timestamp deltas). */
export interface GpuTimingSegment {
  /** Slot name passed to `recordPass()`. */
  readonly name: string;
  /** GPU time in milliseconds for this segment, from the device's timestamp period. */
  readonly ms: number;
}

/**
 * Per-frame snapshot of the most recently completed timing frame. `supported`/`enabled` reflect
 * the timer's live state at read time; `frameIndex`/`segments` describe the last frame whose
 * readback has actually arrived. The returned object and its `segments` array are REUSED across
 * frames -- a consumer must copy out any data it intends to keep past the current frame (engine
 * scratch convention). `frameIndex` is a monotonic, timer-local counter (one unit per recorded
 * `render()`), `-1` before the first readback arrives.
 */
export interface GpuTimingSnapshot {
  /** True when the device exposes `timestamp-query` (a prerequisite for recording). */
  readonly supported: boolean;
  /** True while `enable()`d and supported -- the query ring exists only then. */
  readonly enabled: boolean;
  /** Monotonic timer-local frame index of the frame this snapshot describes; `-1` = no data. */
  readonly frameIndex: number;
  /** Per-segment GPU ms for that frame, in record order; empty until data exists. */
  readonly segments: readonly GpuTimingSegment[];
}

/**
 * Final shipped WebGPU timestamp-write shape. `@webgpu/types` is pinned at 0.1.74, which still
 * spells the draft name `beginningOfPassWriteIndex` (renamed in the spec before shipping) and
 * lacks `GPUQueue.getTimestampPeriod()`. Browsers implement the final names, so this file speaks
 * them explicitly; `TimestampWritesFinal` is structurally assignable to the pinned
 * `GPURenderPassTimestampWrites` (the draft-named field is optional in that type, the extra
 * final-named field is allowed), so no type escape hatches are needed.
 */
interface TimestampWritesFinal {
  querySet: GPUQuerySet;
  beginOfPassWriteIndex: number;
  endOfPassWriteIndex: number;
}

/** Ring depth of query sets; the async latency (resolve -> map -> parse) is absorbed here. */
const RING_DEPTH = 8;
/** Per-frame segment capacity; query sets hold `2 * MAX_SEGMENTS_PER_FRAME` entries. */
const MAX_SEGMENTS_PER_FRAME = 16;
/** Byte size of one resolved u64 timestamp. */
const TIMESTAMP_BYTES = 8;

/** One ring slot: its own query set, resolve staging buffer and the frame it recorded. */
interface TimingSlot {
  querySet: GPUQuerySet | undefined;
  /** `resolveQuerySet` destination (`QUERY_RESOLVE | COPY_SRC`). */
  resolveBuffer: GPUBuffer | undefined;
  /** `MAP_READ | COPY_DST` copy target; the only buffer ever mapped (see `endFrame`). */
  stagingBuffer: GPUBuffer | undefined;
  /** Timer-local frame index of the frame this slot last recorded; `-1` while unused. */
  frameIndex: number;
  /** Segment names recorded this cycle; `names[i]` pairs with write indices `2*i, 2*i+1`. */
  names: (string | undefined)[];
  /** Number of segments recorded in the current cycle. */
  segmentCount: number;
  /** True while a `mapAsync()` on `stagingBuffer` is outstanding. */
  pendingMap: boolean;
}

/** Mutable backing shape of the published snapshot segments (stable, reused objects). */
type MutableSegment = {
  name: string;
  ms: number;
};

/** Mutable backing object of the public (readonly-typed) snapshot view. */
interface GpuTimingSnapshotState {
  supported: boolean;
  enabled: boolean;
  frameIndex: number;
  segments: readonly GpuTimingSegment[];
}

/**
 * Reads the device's timestamp period in nanoseconds per counter tick. Not declared by the
 * pinned `@webgpu/types`; probed defensively. All shipping implementations report `1` (values are
 * nanoseconds), so the fallback is both safe and the documented reality today.
 */
function probeTimestampPeriodNs(queue: GPUQueue): number {
  const withPeriod = queue as { getTimestampPeriod?: () => number };
  if (typeof withPeriod.getTimestampPeriod === "function") return withPeriod.getTimestampPeriod();
  return 1;
}

export class GpuTimer {
  private _device: GPUDevice | undefined = undefined;
  /** User intent from `enable()`/`disable()`; actual recording gated on `supported`. */
  private _wanted = false;
  /** True while the query ring exists and frames are recorded. */
  private _enabled = false;
  /** Monotonic timer-local frame counter; increments once per recorded frame. */
  private _order = 0;
  /** Current ring slot index (advanced by `beginFrame`). */
  private _head = 0;
  private readonly _slots: TimingSlot[] = [];
  /** Slot whose resolve was recorded by `endFrame` and whose `mapAsync` is kicked by the next
   * `beginFrame` -- always after the previous `queue.submit` ran. */
  private _pendingKick: TimingSlot | undefined = undefined;
  /** Timestamp period in ns per counter tick; probed once at resource creation. */
  private _timestampPeriodNs = 1;
  /** Stable monomorphic segment objects (never truncated) from which published views are filled. */
  private readonly _segmentPool: MutableSegment[] = [];
  /** Published snapshot view: references into `_segmentPool`, sized to the latest frame's count. */
  private readonly _snapshotSegments: MutableSegment[] = [];
  private readonly _snapshot: GpuTimingSnapshotState = {
    supported: false,
    enabled: false,
    frameIndex: -1,
    segments: this._snapshotSegments,
  };
  /** Reused timestamp-write pair handed to render-pass descriptors (safe: `beginRenderPass`
   * consumes it synchronously, so the next `recordPass()` overwrite is invisible to the opened
   * pass). */
  private readonly _twScratch: TimestampWritesFinal = {
    querySet: undefined as unknown as GPUQuerySet,
    beginOfPassWriteIndex: 0,
    endOfPassWriteIndex: 0,
  };

  constructor() {
    // Pre-size the stable segment-object pool (monomorphic shapes, reused forever). The
    // *published* array stays empty until the first readback arrives; publishing copies only
    // references out of the pool, so the readback path allocates nothing per segment.
    for (let i = 0; i < MAX_SEGMENTS_PER_FRAME; i++) {
      this._segmentPool.push({ name: "", ms: 0 });
    }
  }

  /** True when the current device exposes the `timestamp-query` feature. */
  public get supported(): boolean {
    return this._device?.features.has("timestamp-query") === true;
  }

  /** True while the query ring exists and frames are recorded. */
  public get enabled(): boolean {
    return this._enabled;
  }

  /** Snapshot of the most recently completed timing frame (reused object, see interface). */
  public get snapshot(): GpuTimingSnapshot {
    this._snapshot.supported = this.supported;
    this._snapshot.enabled = this._enabled;
    return this._snapshot;
  }

  /** Opts in. Creates the query ring only when the feature is present (`supported`); without it
   * `enabled` stays `false` and every later call stays a no-op. Idempotent. */
  public enable(): void {
    this._wanted = true;
    if (!this.supported || this._enabled) return;
    this._createResources();
    this._enabled = true;
  }

  /** Opts out and releases every query set/buffer; subsequent calls become no-ops (K5
   * zero-cost path restored). Idempotent. */
  public disable(): void {
    this._wanted = false;
    if (!this._enabled) return;
    this._destroyResources();
    this._enabled = false;
  }

  /** Renderer hook, once after device creation (and after any re-init): rebinds the device and
   * re-syncs `enabled` with the (possibly new) device's feature set. */
  public attachDevice(device: GPUDevice | undefined): void {
    this._device = device;
    if (!this._wanted) return;
    if (this._enabled) this._destroyResources();
    if (this.supported) {
      this._createResources();
      this._enabled = true;
    } else {
      this._enabled = false;
    }
  }

  /** Renderer render-loop hook, once near the top of `render()` (before any pass records).
   * Consumes completed readbacks, kicks the pending `mapAsync`, then advances to the next ring
   * slot for this frame. No-op while disabled. */
  public beginFrame(): void {
    if (!this._enabled) return;
    this._consumeMappedSlots();
    this._kickPendingMap();
    this._head = (this._head + 1) % RING_DEPTH;
    const slot = this._slots[this._head]!;
    slot.frameIndex = ++this._order;
    slot.segmentCount = 0;
  }

  /**
   * Generic named-slot API: reserves the next timestamp-write pair of the current frame under
   * `name` and returns a REUSED `GPURenderPassTimestampWrites` (assign it to the pass descriptor's
   * `timestampWrites` and open the pass with it -- the object is only stable until the next
   * `recordPass()` call, which is safe because `beginRenderPass` consumes it synchronously).
   * Passes for future instrumentation (shadow, depth pre-pass, compute) call this the same way;
   * the public snapshot then carries their segment under the given name without any API change.
   *
   * @returns The write pair for the current frame's query set, or `undefined` when disabled,
   *   unsupported, or the per-frame segment budget (`MAX_SEGMENTS_PER_FRAME`) is exhausted
   *   (later segments of a frame fail closed and are simply not measured).
   */
  public recordPass(name: string): GPURenderPassTimestampWrites | undefined {
    if (!this._enabled) return undefined;
    const slot = this._slots[this._head]!;
    if (slot.segmentCount >= MAX_SEGMENTS_PER_FRAME) return undefined;
    const index = slot.segmentCount;
    slot.names[index] = name;
    slot.segmentCount = index + 1;
    const writes = this._twScratch;
    writes.querySet = slot.querySet!;
    writes.beginOfPassWriteIndex = index * 2;
    writes.endOfPassWriteIndex = index * 2 + 1;
    return writes;
  }

  /** Renderer render-loop hook, once right before `queue.submit()` after every pass has recorded:
   * resolves the current frame's timestamps into its staging buffer (last command of this
   * encoder, so ordering against the pass work is guaranteed), then copies into the `MAP_READ`
   * target for CPU readback. No-op while disabled, or when the frame recorded no segments, or
   * when the staging buffer is still mapped (clean sample skip -- the ring's next cycle resolves
   * fresh data into it). */
  public endFrame(ce: GPUCommandEncoder): void {
    if (!this._enabled) return;
    const slot = this._slots[this._head]!;
    if (slot.segmentCount === 0 || !!slot.pendingMap) return;
    const querySet = slot.querySet;
    const resolveBuffer = slot.resolveBuffer;
    const stagingBuffer = slot.stagingBuffer;
    if (!querySet || !resolveBuffer || !stagingBuffer) return;
    // Two buffers, never one: per spec `MAP_READ` may only be combined with `COPY_DST`, while
    // `resolveQuerySet` destinations require `QUERY_RESOLVE`. The proven in-repo pattern is
    // `HzbOcclusionSystem` (staging readback via `copyBufferToBuffer`) — honored here. A single
    // `COPY_DST|MAP_READ|QUERY_RESOLVE` buffer is rejected by Dawn with a CreateBuffer error.
    ce.resolveQuerySet(querySet, 0, slot.segmentCount * 2, resolveBuffer, 0);
    ce.copyBufferToBuffer(
      resolveBuffer,
      0,
      stagingBuffer,
      0,
      slot.segmentCount * 2 * TIMESTAMP_BYTES,
    );
    this._pendingKick = slot;
  }

  /** Full teardown for renderer `destroy()`. */
  public dispose(): void {
    this._wanted = false;
    this._destroyResources();
    this._enabled = false;
    this._device = undefined;
  }

  private _createResources(): void {
    const device = this._device!;
    const queryCount = MAX_SEGMENTS_PER_FRAME * 2;
    this._slots.length = 0;
    for (let i = 0; i < RING_DEPTH; i++) {
      const names: (string | undefined)[] = [];
      for (let s = 0; s < MAX_SEGMENTS_PER_FRAME; s++) names.push(undefined);
      this._slots.push({
        querySet: device.createQuerySet({ type: "timestamp", count: queryCount }),
        // `resolveQuerySet` destination must carry `QUERY_RESOLVE`; the `MAP_READ` target is a
        // separate buffer because `MAP_READ` may only be combined with `COPY_DST` (spec; Dawn
        // validates both — see `endFrame`). Both found + fixed via headless Dawn lane 2026-11-08.
        resolveBuffer: device.createBuffer({
          size: queryCount * TIMESTAMP_BYTES,
          usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
        }),
        stagingBuffer: device.createBuffer({
          size: queryCount * TIMESTAMP_BYTES,
          usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
        }),
        frameIndex: -1,
        names,
        segmentCount: 0,
        pendingMap: false,
      });
    }
    this._order = 0;
    this._head = 0;
    this._pendingKick = undefined;
    this._snapshot.frameIndex = -1;
    this._snapshotSegments.length = 0;
    this._timestampPeriodNs = probeTimestampPeriodNs(device.queue);
  }

  private _destroyResources(): void {
    for (const slot of this._slots) {
      slot.querySet?.destroy();
      slot.resolveBuffer?.destroy();
      slot.stagingBuffer?.destroy();
    }
    this._slots.length = 0;
    this._pendingKick = undefined;
  }

  /** Parses every slot whose staged `mapAsync` has completed (polled once per `beginFrame`;
   * same non-stalling pattern as `HzbOcclusionSystem.applyOcclusionResults` -- never chained to
   * the map promise, which is only guaranteed to resolve *eventually*). A readback for an older
   * frame arriving after a newer one was already published is discarded (monotonicity guard). */
  private _consumeMappedSlots(): void {
    for (const slot of this._slots) {
      if (!slot.pendingMap) continue;
      const buffer = slot.stagingBuffer;
      if (!buffer || buffer.mapState !== "mapped") continue;
      const mapped = new BigUint64Array(buffer.getMappedRange());
      if (slot.frameIndex > this._snapshot.frameIndex) {
        this._publish(slot, mapped);
      }
      buffer.unmap();
      slot.pendingMap = false;
    }
  }

  private _publish(slot: TimingSlot, mapped: BigUint64Array): void {
    const pool = this._segmentPool;
    const segments = this._snapshotSegments;
    let count = 0;
    for (let i = 0; i < slot.segmentCount; i++) {
      const begin = mapped[i * 2];
      const end = mapped[i * 2 + 1];
      if (begin === undefined || end === undefined || end <= begin) continue;
      const segment = pool[count]!;
      segment.name = slot.names[i] ?? "";
      segment.ms = Number(end - begin) * this._timestampPeriodNs * 1e-6;
      // Copy only the reference; the pool object itself stays stable across frames.
      segments[count] = segment;
      count++;
    }
    segments.length = count;
    this._snapshot.frameIndex = slot.frameIndex;
  }

  private _kickPendingMap(): void {
    const slot = this._pendingKick;
    this._pendingKick = undefined;
    if (!slot || slot.pendingMap) return;
    const buffer = slot.stagingBuffer;
    if (!buffer) return;
    slot.pendingMap = true;
    // Fire-and-forget (mirrors `HzbOcclusionSystem.kickoffMapAsync`): consumption polls
    // `mapState` instead of relying on this promise, so a dropped/late resolution degrades to a
    // skipped sample, never a stuck pipe. `.catch` clears the flag on device loss.
    buffer.mapAsync(GPUMapMode.READ).catch(() => {
      slot.pendingMap = false;
    });
  }
}
