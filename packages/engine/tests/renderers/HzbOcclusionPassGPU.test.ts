import { describe, expect, it, vi } from "vitest";
import { HzbOcclusionSystem } from "../../src/renderers/WebGPU/managers/HzbOcclusionSystem.js";
import type { GPUFallbackResources } from "../../src/renderers/WebGPU/managers/GPUFallbackResources.js";

// Node/vitest has no WebGPU global; @webgpu/types only provides ambient TS types, not a runtime
// value. Stub the bit-flag constants the code under test actually reads.
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
(globalThis as unknown as { GPUShaderStage: Record<string, number> }).GPUShaderStage ??= {
  VERTEX: 0x1,
  FRAGMENT: 0x2,
  COMPUTE: 0x4,
};
(globalThis as unknown as { GPUTextureUsage: Record<string, number> }).GPUTextureUsage ??= {
  COPY_SRC: 0x01,
  COPY_DST: 0x02,
  TEXTURE_BINDING: 0x04,
  STORAGE_BINDING: 0x08,
  RENDER_ATTACHMENT: 0x10,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Internals = any;

function makeMockComputePass(): {
  setPipeline: ReturnType<typeof vi.fn>;
  setBindGroup: ReturnType<typeof vi.fn>;
  dispatchWorkgroups: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
} {
  return {
    setPipeline: vi.fn(),
    setBindGroup: vi.fn(),
    dispatchWorkgroups: vi.fn(),
    end: vi.fn(),
  };
}

function makeMockCommandEncoder(): {
  ce: {
    beginComputePass: ReturnType<typeof vi.fn>;
    copyBufferToBuffer: ReturnType<typeof vi.fn>;
  };
  computePasses: ReturnType<typeof makeMockComputePass>[];
} {
  const computePasses: ReturnType<typeof makeMockComputePass>[] = [];
  const ce = {
    beginComputePass: vi.fn(() => {
      const p = makeMockComputePass();
      computePasses.push(p);
      return p;
    }),
    copyBufferToBuffer: vi.fn(),
  };
  return { ce, computePasses };
}

function makeMockDevice(): {
  device: {
    createBindGroupLayout: ReturnType<typeof vi.fn>;
    createPipelineLayout: ReturnType<typeof vi.fn>;
    createComputePipeline: ReturnType<typeof vi.fn>;
    createShaderModule: ReturnType<typeof vi.fn>;
    createBindGroup: ReturnType<typeof vi.fn>;
    createBuffer: ReturnType<typeof vi.fn>;
    createTexture: ReturnType<typeof vi.fn>;
    queue: { writeBuffer: ReturnType<typeof vi.fn> };
  };
} {
  const device = {
    createBindGroupLayout: vi.fn((desc: Record<string, unknown>) => ({ desc })),
    createPipelineLayout: vi.fn((desc: Record<string, unknown>) => ({ desc })),
    createComputePipeline: vi.fn((desc: Record<string, unknown>) => ({
      id: "computePipeline",
      ...desc,
    })),
    createShaderModule: vi.fn((desc: Record<string, unknown>) => ({ module: desc })),
    createBindGroup: vi.fn((desc: Record<string, unknown>) => ({ desc })),
    createBuffer: vi.fn((desc: Record<string, unknown>) => ({ id: "buffer", ...desc })),
    createTexture: vi.fn(() => ({
      createView: vi.fn(() => ({ id: "mipView" })),
      destroy: vi.fn(),
    })),
    queue: { writeBuffer: vi.fn() },
  };
  return { device };
}

/** A fully-constructed system with a mocked device; `mipLevelCount` is injectable so tests can pin
 * the pyramid depth. Reaching into internals mirrors the pre-extraction renderer-internals tests. */
function makeSystem(mipLevelCount = 4): Internals {
  const { device } = makeMockDevice();
  const system = new HzbOcclusionSystem(
    device as unknown as GPUDevice,
    {} as unknown as GPUFallbackResources,
    "testShaderCode",
    {} as unknown as GPUBindGroupLayout,
    () => mipLevelCount,
  ) as Internals;
  return system;
}

/** `makeSystem()` + the resize every real frame path relies on (`setSize()` allocates the pyramid
 * texture and its bind groups before the first render). */
function makeReadySystem(mipLevelCount = 5): Internals {
  const system = makeSystem(mipLevelCount);
  system.resize(64, 64, { id: "depthView" });
  return system;
}

describe("HzbOcclusionSystem.getPreviousFrameHzb — ping-pong inverse (IF-HZB-PREV-SLOT)", () => {
  it("Frame N head serves the slot COMPLETED in Frame N-1, incl. Frame 2 returning Frame 1's pyramid", () => {
    const system = makeReadySystem();
    // No pyramid built yet: fail-closed, never a half-written slot.
    expect(system.getPreviousFrameHzb().available).toBe(false);

    // Frame 1 build -> the NEXT frame head MUST serve Frame 1's pyramid (slot 1), NOT the
    // never-written "other" slot 0 (the old code inverted the ping-pong and stayed unavailable).
    system.buildPyramid(makeMockCommandEncoder().ce as unknown as GPUCommandEncoder, false);
    const head2 = system.getPreviousFrameHzb();
    expect(head2.available).toBe(true);
    expect(head2.frameIndex).toBe(1);
    expect(head2.readHandle.slot).toBe(1);
    expect(head2.readHandle.view).toBe(system._hzbSampledViews[1]);

    // Frame 2 build -> Frame 3 head serves slot 0 (the just-completed Frame 2 build), NOT the
    // Frame-1 slot the CURRENT frame overwrites later in the same encoder (same-encoder hazard).
    system.buildPyramid(makeMockCommandEncoder().ce as unknown as GPUCommandEncoder, false);
    const head3 = system.getPreviousFrameHzb();
    expect(head3.available).toBe(true);
    expect(head3.frameIndex).toBe(2);
    expect(head3.readHandle.slot).toBe(0);
    expect(head3.readHandle.view).toBe(system._hzbSampledViews[0]);

    // Frame 3 build -> Frame 4 head serves slot 1, generation 3.
    system.buildPyramid(makeMockCommandEncoder().ce as unknown as GPUCommandEncoder, false);
    const head4 = system.getPreviousFrameHzb();
    expect(head4.available).toBe(true);
    expect(head4.frameIndex).toBe(3);
    expect(head4.readHandle.slot).toBe(1);
  });
});

describe("HzbOcclusionSystem.invalidatePyramid — post-teleport pre-cut leak (IF-HZB-POST-CUT-NO-LEAK)", () => {
  it("after a camera cut the served slot is always a POST-cut build, never the pre-cut pyramid", () => {
    const system = makeReadySystem();
    // Three builds so BOTH slots carry pre-cut data (slot1@f1, slot0@f2, slot1@f3) -- the leak
    // only manifests when a pre-cut slot would otherwise still look "written since last reset".
    const encoder = (): GPUCommandEncoder =>
      makeMockCommandEncoder().ce as unknown as GPUCommandEncoder;
    system.buildPyramid(encoder(), false);
    system.buildPyramid(encoder(), false);
    system.buildPyramid(encoder(), false);
    const preCut = system.getPreviousFrameHzb();
    expect(preCut.available).toBe(true);
    expect(preCut.frameIndex).toBe(3);

    // Camera cut: the pre-cut pyramid becomes unreachable despite physically written data.
    system.invalidatePyramid();
    expect(system.getPreviousFrameHzb().available, "fail-closed right after the cut").toBe(false);

    // Post-cut Frame 4 build: the served generation MUST be the post-cut build (4) from the
    // just-written slot -- NOT the pre-cut generation 3 of the other slot (the old code leaked
    // it because invalidatePyramid() never reset the per-slot write counts).
    system.buildPyramid(encoder(), false);
    const postCut = system.getPreviousFrameHzb();
    expect(postCut.available).toBe(true);
    expect(postCut.frameIndex, "post-cut generation, never the pre-cut one").toBe(4);
    expect(postCut.readHandle.slot).toBe(system._lastWriteSlot);

    // One more post-cut cycle: slot 1 at generation 5 -- still post-cut data.
    system.buildPyramid(encoder(), false);
    const next = system.getPreviousFrameHzb();
    expect(next.available).toBe(true);
    expect(next.frameIndex).toBe(5);
    expect(next.readHandle.slot).toBe(1);
  });
});
