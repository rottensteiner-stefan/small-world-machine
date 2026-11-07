import "../../src/index.js";
import { describe, expect, it, vi } from "vitest";
import { GPUObjectRingBuffer } from "../../src/renderers/WebGPU/managers/GPUObjectRingBuffer.js";

// Node/vitest has no WebGPU global; @webgpu/types only provides ambient TS types,
// not a runtime value. Stub the bit-flag constants this class actually reads.
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

function makeMockDevice(): GPUDevice {
  let bufferId = 0;
  return {
    createBuffer: vi.fn(() => ({
      id: bufferId++,
      destroy: vi.fn(),
    })),
    createBindGroup: vi.fn((desc: unknown) => ({ desc })),
    queue: { writeBuffer: vi.fn() },
    limits: { minUniformBufferOffsetAlignment: 256 },
  } as unknown as GPUDevice;
}

describe("GPUObjectRingBuffer", () => {
  it("allocates a fresh slot at offset 0 for the first key", () => {
    const device = makeMockDevice();
    const ring = new GPUObjectRingBuffer(device, {
      mock: "objectBGL",
    } as unknown as GPUBindGroupLayout);

    const { offset, cached } = ring.acquireSlot("A:matA");

    expect(offset).toBe(0);
    expect(cached).toBe(false);
  });

  it("dedupes the same key across multiple calls in one frame (e.g. CSM cascades sharing one DepthMaterial)", () => {
    const device = makeMockDevice();
    const ring = new GPUObjectRingBuffer(device, {
      mock: "objectBGL",
    } as unknown as GPUBindGroupLayout);

    const first = ring.acquireSlot("Caster:depthMatUuid");
    const second = ring.acquireSlot("Caster:depthMatUuid");
    const third = ring.acquireSlot("Caster:depthMatUuid");

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(third.cached).toBe(true);
    expect(second.offset).toBe(first.offset);
    expect(third.offset).toBe(first.offset);
  });

  it("does NOT dedupe different keys (e.g. main pass vs. shadow pass material for the same object)", () => {
    const device = makeMockDevice();
    const ring = new GPUObjectRingBuffer(device, {
      mock: "objectBGL",
    } as unknown as GPUBindGroupLayout);

    const shadow = ring.acquireSlot("Caster:depthMatUuid");
    const main = ring.acquireSlot("Caster:standardMatUuid");

    expect(main.offset).not.toBe(shadow.offset);
    expect(main.cached).toBe(false);
  });

  it("never dedupes an undefined key (sprites: model matrix is billboarded per-pass view matrix)", () => {
    const device = makeMockDevice();
    const ring = new GPUObjectRingBuffer(device, {
      mock: "objectBGL",
    } as unknown as GPUBindGroupLayout);

    const cam = ring.acquireSlot(undefined);
    const light = ring.acquireSlot(undefined);

    expect(cam.offset).not.toBe(light.offset);
    expect(cam.cached).toBe(false);
    expect(light.cached).toBe(false);
  });

  it("returns offsets aligned to the object uniform stride", () => {
    const device = makeMockDevice();
    const ring = new GPUObjectRingBuffer(device, {
      mock: "objectBGL",
    } as unknown as GPUBindGroupLayout);

    const offsets = [0, 1, 2].map((i) => ring.acquireSlot(`key${i}`).offset);

    for (const offset of offsets) {
      expect(offset % ring.stride).toBe(0);
    }
    expect(new Set(offsets).size).toBe(3);
  });

  it("grows the ring buffer (new GPUBuffer + bind group) instead of shrinking or reusing capacity", () => {
    const device = makeMockDevice();
    const ring = new GPUObjectRingBuffer(device, {
      mock: "objectBGL",
    } as unknown as GPUBindGroupLayout);
    expect(ring.capacity).toBe(4096);

    const bufferBefore = ring.buffer;
    ring.ensureCapacity(8192);

    expect(ring.capacity).toBeGreaterThanOrEqual(8192);
    expect(ring.buffer).not.toBe(bufferBefore);
    expect(device.createBuffer).toHaveBeenCalledTimes(2);
    // Old buffer is kept alive (not destroyed) until the frame that grew it finishes submitting.
    expect(bufferBefore.destroy).not.toHaveBeenCalled();
    expect(ring.pendingDestroy).toEqual([bufferBefore]);
  });

  it("destroys a growth-replaced buffer only once endFrame() drains it", () => {
    const device = makeMockDevice();
    const ring = new GPUObjectRingBuffer(device, {
      mock: "objectBGL",
    } as unknown as GPUBindGroupLayout);
    const bufferBefore = ring.buffer;
    ring.ensureCapacity(8192);

    expect(bufferBefore.destroy).not.toHaveBeenCalled();
    ring.endFrame();
    expect(bufferBefore.destroy).toHaveBeenCalledTimes(1);
    expect(ring.pendingDestroy).toEqual([]);
  });

  it("grows mid-frame on overflow instead of reusing a slot, keeping every draw on a unique offset", () => {
    const device = makeMockDevice();
    const ring = new GPUObjectRingBuffer(
      device,
      { mock: "objectBGL" } as unknown as GPUBindGroupLayout,
      2,
    );
    const oldBuffer = ring.buffer;

    const offsets = ["A", "B", "C", "D"].map((k) => ring.acquireSlot(k).offset);

    expect(new Set(offsets).size).toBe(4);
    expect(ring.capacity).toBeGreaterThanOrEqual(4);
    expect(ring.buffer).not.toBe(oldBuffer);
    expect(oldBuffer.destroy).not.toHaveBeenCalled();
  });

  it("does not hand out pre-growth cached offsets for the new buffer", () => {
    const device = makeMockDevice();
    const ring = new GPUObjectRingBuffer(
      device,
      { mock: "objectBGL" } as unknown as GPUBindGroupLayout,
      1,
    );
    ring.acquireSlot("A");
    ring.acquireSlot("B"); // grows
    const again = ring.acquireSlot("A");

    expect(again.cached).toBe(false);
  });

  it("destroys every buffer replaced by repeated growth in one frame (no leak)", () => {
    const device = makeMockDevice();
    const ring = new GPUObjectRingBuffer(device, {
      mock: "objectBGL",
    } as unknown as GPUBindGroupLayout);
    const first = ring.buffer;
    ring.ensureCapacity(8192);
    const second = ring.buffer;
    ring.ensureCapacity(100000);

    expect(ring.pendingDestroy).toEqual([first, second]);
    ring.endFrame();
    expect(first.destroy).toHaveBeenCalledTimes(1);
    expect(second.destroy).toHaveBeenCalledTimes(1);
  });

  it("beginFrame() resets dedup state and sizes capacity from last frame's usage", () => {
    const device = makeMockDevice();
    const ring = new GPUObjectRingBuffer(
      device,
      { mock: "objectBGL" } as unknown as GPUBindGroupLayout,
      2,
    );

    ring.acquireSlot("A");
    ring.acquireSlot("B");
    ring.acquireSlot("C");
    ring.endFrame();

    ring.beginFrame();
    const again = ring.acquireSlot("A");
    expect(again.cached).toBe(false);
    expect(ring.capacity).toBeGreaterThanOrEqual(4096);
  });

  it("write() forwards to device.queue.writeBuffer with the ring's current buffer", () => {
    const device = makeMockDevice();
    const ring = new GPUObjectRingBuffer(device, {
      mock: "objectBGL",
    } as unknown as GPUBindGroupLayout);
    const data = new Float32Array([1, 2, 3]);

    ring.write(256, data);

    expect(device.queue.writeBuffer).toHaveBeenCalledWith(ring.buffer, 256, data);
  });
});
