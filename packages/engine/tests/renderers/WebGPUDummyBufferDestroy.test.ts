import "../../src/index.js";
import { describe, expect, it, vi } from "vitest";
import { GPUFallbackResources } from "../../src/renderers/WebGPU/managers/GPUFallbackResources.js";

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
(globalThis as unknown as { GPUTextureUsage: Record<string, number> }).GPUTextureUsage ??= {
  COPY_SRC: 0x01,
  COPY_DST: 0x02,
  TEXTURE_BINDING: 0x04,
  STORAGE_BINDING: 0x08,
  RENDER_ATTACHMENT: 0x10,
};

function makeMockDevice(): GPUDevice {
  return {
    createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
    createTexture: vi.fn(() => ({ createView: vi.fn(() => ({})) })),
    createSampler: vi.fn(() => ({})),
    queue: { writeBuffer: vi.fn(), writeTexture: vi.fn() },
  } as unknown as GPUDevice;
}

describe("GPUFallbackResources dummy vertex buffer growth defers destruction past the current frame", () => {
  // The constructor already calls `ensureDummyBufferSize(1000)` once (see its own doc comment),
  // so every test below starts from that already-allocated baseline, not a blank slate.

  it("a call that doesn't need to grow queues nothing and doesn't throw", () => {
    const fallback = new GPUFallbackResources(makeMockDevice());
    expect(() => fallback.ensureDummyBufferSize(10)).not.toThrow();
  });

  it("growth queues the old buffers for deferred destroy instead of destroying immediately", () => {
    const fallback = new GPUFallbackResources(makeMockDevice());
    const firstNormalBuffer = fallback.dummyNormalBuffer;
    const firstUvBuffer = fallback.dummyUvBuffer;
    const firstTangentBuffer = fallback.dummyTangentBuffer;
    const firstJointsBuffer = fallback.dummyJointsBuffer;
    const firstWeightsBuffer = fallback.dummyWeightsBuffer;

    fallback.ensureDummyBufferSize(10000); // forces growth

    expect(firstNormalBuffer.destroy).not.toHaveBeenCalled();
    expect(firstUvBuffer.destroy).not.toHaveBeenCalled();
    expect(firstTangentBuffer.destroy).not.toHaveBeenCalled();
    expect(firstJointsBuffer.destroy).not.toHaveBeenCalled();
    expect(firstWeightsBuffer.destroy).not.toHaveBeenCalled();
    // The instance must keep using the NEW buffers going forward.
    expect(fallback.dummyNormalBuffer).not.toBe(firstNormalBuffer);
  });

  it("the pending buffers are only destroyed once drained (simulating render()'s post-submit cleanup)", () => {
    const fallback = new GPUFallbackResources(makeMockDevice());
    const firstNormalBuffer = fallback.dummyNormalBuffer;
    fallback.ensureDummyBufferSize(10000);

    expect(firstNormalBuffer.destroy).not.toHaveBeenCalled();
    fallback.drainPendingDestroy();
    expect(firstNormalBuffer.destroy).toHaveBeenCalledTimes(1);

    // Draining twice in a row must not re-destroy an already-empty queue.
    expect(() => fallback.drainPendingDestroy()).not.toThrow();
    expect(firstNormalBuffer.destroy).toHaveBeenCalledTimes(1);
  });
});
