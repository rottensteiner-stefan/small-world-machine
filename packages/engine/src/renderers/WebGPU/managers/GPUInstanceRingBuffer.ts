import type { Object3D } from "../../../core/Object3D.js";

/** Bytes of one instance matrix (mat4x4f), the stride of vertex slot 6. */
const MATRIX_BYTES = 64;
const DEFAULT_CAPACITY = 1024;

/**
 * Per-frame vertex buffer for automatic instancing (ADR 0046): every run of objects the renderer
 * draws as one instanced draw gets its world matrices appended here, and the draw binds slot 6
 * at that run's byte offset. Mirrors `GPUObjectRingBuffer`: reset in `beginFrame()`, grows
 * mid-frame by swapping in a bigger buffer (draws already recorded keep the old one, destroyed
 * after submit in `endFrame()`), sized from last frame's usage so growth stays rare.
 */
export class GPUInstanceRingBuffer {
  private readonly _device: GPUDevice;
  private _buffer!: GPUBuffer;
  private _capacity = 0;
  private _used = 0;
  private _lastFrameUsed = 0;
  private readonly _pendingDestroy: GPUBuffer[] = [];
  /** CPU staging for one run, grown on demand and reused. */
  private _staging = new Float32Array(DEFAULT_CAPACITY * 16);

  constructor(device: GPUDevice) {
    this._device = device;
    this._ensureCapacity(DEFAULT_CAPACITY);
  }

  public get buffer(): GPUBuffer {
    return this._buffer;
  }

  /** Call once per frame before encoding any draw. */
  public beginFrame(): void {
    this._used = 0;
    this._ensureCapacity(Math.max(DEFAULT_CAPACITY, Math.ceil(this._lastFrameUsed * 1.5)));
  }

  /** Call once per frame right after `queue.submit()`. */
  public endFrame(): void {
    this._lastFrameUsed = this._used;
    for (const b of this._pendingDestroy) b.destroy();
    this._pendingDestroy.length = 0;
  }

  /**
   * Uploads the world matrices of `objects[start..end)` and returns the byte offset to bind at
   * slot 6. Read `buffer` after this call: a growth swaps it.
   */
  public writeRun(objects: readonly Object3D[], start: number, end: number): number {
    const count = end - start;
    if (this._used + count > this._capacity) this._ensureCapacity(this._used + count);
    if (this._staging.length < count * 16) this._staging = new Float32Array(count * 16 * 2);

    const staging = this._staging;
    for (let i = 0; i < count; i++) staging.set(objects[start + i]!.worldMatrix.data, i * 16);

    const offset = this._used * MATRIX_BYTES;
    this._device.queue.writeBuffer(this._buffer, offset, staging, 0, count * 16);
    this._used += count;
    return offset;
  }

  public destroy(): void {
    this._buffer.destroy();
    for (const b of this._pendingDestroy) b.destroy();
    this._pendingDestroy.length = 0;
  }

  private _ensureCapacity(needed: number): void {
    if (this._buffer && this._capacity >= needed) return;
    const capacity = Math.max(needed, this._capacity * 2);
    if (this._buffer) this._pendingDestroy.push(this._buffer);
    this._buffer = this._device.createBuffer({
      size: capacity * MATRIX_BYTES,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this._capacity = capacity;
  }
}
