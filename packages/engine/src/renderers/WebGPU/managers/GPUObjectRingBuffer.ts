/**
 * Shared ring buffer holding every object's `ObjectUniforms` slot for the current frame, bound
 * once via `hasDynamicOffset` instead of one `GPUBuffer`+`GPUBindGroup` per object -- plus the
 * per-frame slot dedup (same object+material reused across multiple draws, e.g. a shadow caster
 * drawn across 4 CSM cascades, gets one slot instead of a fresh one each time) and the
 * grows-only capacity management that avoids resizing mid-encode.
 *
 * Extracted from `WebGPURenderer` -- see .agents/collaborate/god-objects-refactoring.md Phase 4.
 * No behavior change. Deliberately does NOT know how to pack a `RenderManifest`/`Object3D` into
 * `ObjectUniforms` bytes -- that's `WebGPURenderer._packObjectUniforms()`'s job (real business
 * logic tied to shaders/materials/skinning, not generic ring-buffer bookkeeping). `acquireSlot()`
 * only decides WHICH offset a (possibly deduped) draw gets and whether the caller still needs to
 * pack+`write()` into it.
 */
const DEFAULT_CAPACITY = 4096;

interface ObjectSlotRecord {
  frame: number;
  epoch: number;
  offset: number;
}

export class GPUObjectRingBuffer {
  private readonly _device: GPUDevice;
  private readonly _objectBGL: GPUBindGroupLayout;
  private readonly _stride: number;

  private _buffer!: GPUBuffer;
  private _bindGroup!: GPUBindGroup;
  private _capacity = 0;
  /** Frame-local: `` `${obj.uuid}:${matUuid}` `` -> byte offset already written this frame. */
  private _slotMap = new Map<string, number>();
  /** Frame-local slot counter; becomes `_lastFrameSlotCount` for next frame's capacity guess. */
  private _slotCount = 0;
  private _lastFrameSlotCount = 0;
  /** Buffers replaced by `ensureCapacity()`; destroyed in `endFrame()` once every draw that
   * referenced their slots has actually been recorded and submitted. A list, because a frame can
   * grow more than once. */
  private _pendingDestroy: GPUBuffer[] = [];
  /**
   * Allocation-free per-(object, material) dedup used by the draw loop: persistent records
   * validated by a frame stamp instead of a per-frame `Map<string,...>` fed with freshly
   * concatenated `uuid:matUuid` keys. A record is live only if both the frame and the buffer
   * epoch (bumped when a mid-frame growth invalidates handed-out offsets) match.
   */
  private _objectSlots = new WeakMap<object, Map<string, ObjectSlotRecord>>();
  private _frameId = 0;
  private _epoch = 0;
  /** Whether the last `acquireObjectSlot()` returned an already-written slot (no result object). */
  public lastAcquireCached = false;

  constructor(
    device: GPUDevice,
    objectBGL: GPUBindGroupLayout,
    initialCapacity: number = DEFAULT_CAPACITY,
  ) {
    this._device = device;
    this._objectBGL = objectBGL;
    // Slot stride must respect the device's dynamic-offset alignment (commonly 256, but not
    // guaranteed) -- 512 is the payload size (`ObjectUniforms` packs into <= 512 bytes, see
    // docs/adr/0027-object-uniforms-512-byte-expansion.md).
    const alignment = device.limits.minUniformBufferOffsetAlignment;
    this._stride = Math.ceil(512 / alignment) * alignment;
    this.ensureCapacity(initialCapacity);
  }

  public get bindGroup(): GPUBindGroup {
    return this._bindGroup;
  }
  public get buffer(): GPUBuffer {
    return this._buffer;
  }
  public get capacity(): number {
    return this._capacity;
  }
  public get stride(): number {
    return this._stride;
  }
  public get pendingDestroy(): readonly GPUBuffer[] {
    return this._pendingDestroy;
  }

  /** Grows the ring buffer (+ its single dynamic-offset bind group) to hold at least
   * `neededSlots`. Never shrinks. Called at construction, once per frame in `beginFrame()` based
   * on the previous frame's usage, and from `acquireSlot()` as the rare mid-frame spike fallback.
   * Mid-frame growth is safe because draws already recorded keep the old bind group (and thus the
   * old buffer, destroyed only after submit), while every later draw reads `bindGroup` afresh. */
  public ensureCapacity(neededSlots: number): void {
    if (this._buffer && this._capacity >= neededSlots) return;

    const newCapacity = Math.max(neededSlots, this._capacity * 2, 1);
    const newBuffer = this._device.createBuffer({
      size: newCapacity * this._stride,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const newBindGroup = this._device.createBindGroup({
      layout: this._objectBGL,
      entries: [{ binding: 0, resource: { buffer: newBuffer, offset: 0, size: this._stride } }],
    });

    // Destroying immediately after this frame's queue.submit() is spec-safe (the driver keeps the
    // underlying resource alive, ref-counted, until in-flight GPU work finishes) -- but growth
    // happens *before* this frame's draws are recorded, so the old buffer is still what those
    // draws' already-taken slot offsets refer to until we submit. Deferred to `endFrame()`'s
    // post-submit cleanup instead of destroying it here.
    if (this._buffer) this._pendingDestroy.push(this._buffer);
    this._buffer = newBuffer;
    this._bindGroup = newBindGroup;
    this._capacity = newCapacity;
  }

  /** Resets per-frame dedup/slot state and grows capacity from last frame's actual usage (with
   * 50% headroom) so growth is the rare case, not the norm. Call once per frame, before encoding
   * any draws. */
  public beginFrame(): void {
    this._slotMap.clear();
    this._slotCount = 0;
    this._frameId++;
    this.ensureCapacity(Math.max(DEFAULT_CAPACITY, Math.ceil(this._lastFrameSlotCount * 1.5)));
  }

  /** Remembers this frame's usage for next frame's capacity guess, and destroys a buffer replaced
   * by a mid-init `ensureCapacity()` growth call. Call once per frame, right after
   * `queue.submit()`, once nothing can still reference the old buffer. */
  public endFrame(): void {
    this._lastFrameSlotCount = this._slotCount;
    for (const buffer of this._pendingDestroy) buffer.destroy();
    this._pendingDestroy.length = 0;
  }

  /**
   * Looks up or allocates a slot for `key` (`undefined` for draws that must never dedupe, e.g.
   * sprites -- their model matrix is billboarded towards the active view matrix, which differs
   * per pass). Returns the byte offset and whether this was a cache hit; the caller should
   * (re)pack + `write()` data only when `cached` is false.
   */
  public acquireSlot(key: string | undefined): { offset: number; cached: boolean } {
    if (key !== undefined) {
      const cached = this._slotMap.get(key);
      if (cached !== undefined) return { offset: cached, cached: true };
    }

    if (this._slotCount >= this._capacity) {
      // Rare spike beyond last frame's prediction. Slots already handed out live in the old
      // buffer, so the dedup map must not hand them out again for the new one.
      this.ensureCapacity(this._slotCount + 1);
      this._slotMap.clear();
      this._epoch++;
    }
    const slot = this._slotCount++;

    const offset = slot * this._stride;
    if (key !== undefined) this._slotMap.set(key, offset);
    return { offset, cached: false };
  }

  /**
   * Allocation-free variant of `acquireSlot()` for the per-draw path: dedups on the (object,
   * `matUuid`) pair without building a key string. `obj === undefined` never dedupes (sprites).
   * Returns the byte offset; `lastAcquireCached` tells whether data must still be written.
   */
  public acquireObjectSlot(obj: object | undefined, matUuid: string): number {
    let record: ObjectSlotRecord | undefined;
    if (obj !== undefined) {
      let byMat = this._objectSlots.get(obj);
      if (!byMat) {
        byMat = new Map();
        this._objectSlots.set(obj, byMat);
      }
      record = byMat.get(matUuid);
      if (!record) {
        record = { frame: -1, epoch: -1, offset: 0 };
        byMat.set(matUuid, record);
      }
      if (record.frame === this._frameId && record.epoch === this._epoch) {
        this.lastAcquireCached = true;
        return record.offset;
      }
    }

    if (this._slotCount >= this._capacity) {
      this.ensureCapacity(this._slotCount + 1);
      this._slotMap.clear();
      this._epoch++;
    }
    const offset = this._slotCount++ * this._stride;
    if (record) {
      record.frame = this._frameId;
      record.epoch = this._epoch;
      record.offset = offset;
    }
    this.lastAcquireCached = false;
    return offset;
  }

  public write(offset: number, data: Float32Array): void {
    this._device.queue.writeBuffer(this._buffer, offset, data);
  }

  public dispose(): void {
    this._buffer?.destroy();
    for (const buffer of this._pendingDestroy) buffer.destroy();
    this._pendingDestroy.length = 0;
  }
}
