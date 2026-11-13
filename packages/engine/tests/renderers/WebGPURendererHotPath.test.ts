import { describe, expect, it, vi } from "vitest";
import { GPUObjectRingBuffer } from "../../src/renderers/WebGPU/managers/GPUObjectRingBuffer.js";

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

describe("GPUObjectRingBuffer.acquireObjectSlot", () => {
  function makeRing(): GPUObjectRingBuffer {
    const device = {
      createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
      createBindGroup: vi.fn(() => ({})),
      queue: { writeBuffer: vi.fn() },
      limits: { minUniformBufferOffsetAlignment: 256 },
    } as unknown as GPUDevice;
    return new GPUObjectRingBuffer(device, {} as GPUBindGroupLayout, 2);
  }

  it("dedupes per (object, material) within a frame without building key strings", () => {
    const ring = makeRing();
    const objA = {};
    const objB = {};
    ring.beginFrame();
    const a1 = ring.acquireObjectSlot(objA, "depth");
    expect(ring.lastAcquireCached).toBe(false);
    expect(ring.acquireObjectSlot(objA, "depth")).toBe(a1);
    expect(ring.lastAcquireCached).toBe(true);
    const aMain = ring.acquireObjectSlot(objA, "main");
    expect(aMain).not.toBe(a1);
    expect(ring.lastAcquireCached).toBe(false);
    expect(ring.acquireObjectSlot(objB, "depth")).not.toBe(a1);
  });

  it("forgets everything on the next frame and never dedupes an undefined object (sprites)", () => {
    const ring = makeRing();
    const obj = {};
    ring.beginFrame();
    ring.acquireObjectSlot(obj, "m");
    ring.acquireObjectSlot(undefined, "m");
    expect(ring.lastAcquireCached).toBe(false);
    ring.acquireObjectSlot(undefined, "m");
    expect(ring.lastAcquireCached).toBe(false);

    ring.endFrame();
    ring.beginFrame();
    ring.acquireObjectSlot(obj, "m");
    expect(ring.lastAcquireCached).toBe(false);
  });

  it("does not hand out offsets of the replaced buffer after a mid-frame growth", () => {
    const ring = makeRing();
    const obj = {};
    ring.beginFrame();
    // capacity is at least the default; force a spike beyond it
    const cap = ring.capacity;
    const first = ring.acquireObjectSlot(obj, "m");
    for (let i = 0; i < cap; i++) ring.acquireObjectSlot({}, "x");
    expect(ring.capacity).toBeGreaterThan(cap);
    const again = ring.acquireObjectSlot(obj, "m");
    expect(ring.lastAcquireCached).toBe(false);
    expect(again).not.toBe(first);
  });
});
