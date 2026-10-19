import "../../src/index.js";
import { describe, expect, it, vi } from "vitest";
import { HzbOcclusionPassGPU } from "../../src/renderers/passes/HzbOcclusionPassGPU.js";
import { WebGPURenderer } from "../../src/renderers/WebGPU/WebGPURenderer.js";
import { HzbOcclusionSystem } from "../../src/renderers/WebGPU/managers/HzbOcclusionSystem.js";
import type { GPUFallbackResources } from "../../src/renderers/WebGPU/managers/GPUFallbackResources.js";
import { Object3D } from "../../src/core/Object3D.js";
import { Scene } from "../../src/core/Scene.js";
import { BoundingSphere } from "../../src/physix/index.js";
import { Vector3D } from "../../src/math/index.js";

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
(globalThis as unknown as { GPUMapMode: Record<string, number> }).GPUMapMode ??= {
  READ: 0x1,
  WRITE: 0x2,
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

function makeObjectWithBounds(x: number, y: number, z: number, radius: number): Object3D {
  const obj = new Object3D(`obj_${x}_${y}_${z}`);
  obj.bounds = new BoundingSphere(new Vector3D(x, y, z), radius);
  obj.inFrustum = true;
  return obj;
}

function makeSceneWith(objects: Object3D[]): Scene {
  const scene = new Scene();
  scene.add(...objects);
  return scene;
}

describe("HzbOcclusionPassGPU", () => {
  it("builds the pyramid before dispatching the visibility test", () => {
    const pass = new HzbOcclusionPassGPU();
    const calls: string[] = [];
    const renderer: Internals = {
      _buildHzbPyramid: vi.fn(() => calls.push("build")),
      _dispatchHzbTest: vi.fn(() => calls.push("test")),
    };

    pass.execute(
      renderer,
      new Scene(),
      {} as unknown as GPUCommandEncoder,
      undefined as unknown as GPUTextureView,
      new Float32Array(16),
      Vector3D.ZERO,
      undefined,
    );

    expect(calls).toEqual(["build", "test"]);
  });
});

describe("HzbOcclusionSystem.buildPyramid", () => {
  it("dispatches one copy pass plus one downsample pass per additional mip level", () => {
    const system = makeReadySystem(4);

    const { ce, computePasses } = makeMockCommandEncoder();
    system.buildPyramid(ce as unknown as GPUCommandEncoder, false);

    // 1 copy (mip 0) + 3 downsamples (mips 1, 2, 3) for a 4-level chain.
    expect(computePasses).toHaveLength(4);
    expect(computePasses[0]!.setPipeline).toHaveBeenCalledWith(system._hzbCopyPipeline);
    expect(computePasses[1]!.setPipeline).toHaveBeenCalledWith(system._hzbDownsamplePipeline);
    expect(computePasses[3]!.setPipeline).toHaveBeenCalledWith(system._hzbDownsamplePipeline);
    for (const p of computePasses) expect(p.end).toHaveBeenCalledTimes(1);
  });

  it("reuses the same bind groups across multiple frames instead of recreating them each call", () => {
    const system = makeReadySystem(4);

    const createBindGroup = system._device.createBindGroup;
    createBindGroup.mockClear();

    // Three simulated frames -- no per-frame setSize(), so no further createBindGroup() calls
    // should happen; buildPyramid() must reuse the bind groups resize() built.
    for (let frame = 0; frame < 3; frame++) {
      const { ce } = makeMockCommandEncoder();
      system.buildPyramid(ce as unknown as GPUCommandEncoder, false);
    }

    expect(createBindGroup).not.toHaveBeenCalled();
  });

  it("does nothing for an offscreen render target", () => {
    const system = makeSystem();
    const { ce, computePasses } = makeMockCommandEncoder();
    system.buildPyramid(ce as unknown as GPUCommandEncoder, true);

    expect(computePasses).toHaveLength(0);
  });
});

describe("HzbOcclusionSystem.dispatchTest", () => {
  it("packs bounding-sphere AABBs for objects with bounds and skips those without", () => {
    const system = makeReadySystem(5);
    const noBounds = new Object3D("NoBounds"); // bounds left undefined -- must be skipped, not crash
    noBounds.inFrustum = true;
    const scene = makeSceneWith([
      makeObjectWithBounds(1, 2, 3, 0.5),
      noBounds,
      makeObjectWithBounds(-4, 0, 7, 2.5),
    ]);
    // Populates `scene.lastFrustumVisibleObjects` -- in the real pipeline this is a byproduct of
    // DepthPrePassGPU's own `getVisibleObjectsSorted()` call earlier the same frame; the VP
    // matrix's actual contents don't matter here since `inFrustum` is already set directly by
    // `makeObjectWithBounds`/`noBounds` above.
    scene.getVisibleObjectsSorted(new Float32Array(16), new Vector3D());

    const { ce } = makeMockCommandEncoder();
    system.dispatchTest(
      ce as unknown as GPUCommandEncoder,
      scene,
      { id: "globalBindGroup" },
      false,
    );

    const writeCalls = (system._device as { queue: { writeBuffer: ReturnType<typeof vi.fn> } })
      .queue.writeBuffer.mock.calls;
    const aabbWrite = writeCalls.find((c: unknown[]) => c[0] === system._hzbAabbBuffer);
    expect(aabbWrite).toBeDefined();
    const data = aabbWrite![2] as Float32Array;
    expect(Array.from(data.slice(0, 4))).toEqual([1, 2, 3, 0.5]);
    expect(Array.from(data.slice(4, 8))).toEqual([-4, 0, 7, 2.5]);

    const paramsWrite = writeCalls.find((c: unknown[]) => c[0] === system._hzbTestParamsBuffer);
    expect(paramsWrite).toBeDefined();
    expect((paramsWrite![2] as Uint32Array)[0]).toBe(2); // objectCount: only the 2 with bounds
    expect((paramsWrite![2] as Uint32Array)[1]).toBe(5); // mipCount

    expect(ce.copyBufferToBuffer).toHaveBeenCalledWith(
      system._hzbResultsBuffer,
      0,
      system._hzbStagingBuffers[0],
      0,
      2 * 4,
    );
    expect(system._hzbSlotObjects[0]).toHaveLength(2);
    expect(system._hzbCopyRecordedThisFrame).toBe(true);
  });

  it("reuses the same bind group across multiple frames instead of recreating it each call", () => {
    const system = makeReadySystem();

    const createBindGroup = system._device.createBindGroup;
    createBindGroup.mockClear();

    for (let frame = 0; frame < 3; frame++) {
      system._hzbStagingSlot = 0;
      system._hzbStagingPending = [false, false];
      const scene = makeSceneWith([makeObjectWithBounds(0, 0, 0, 1)]);
      const { ce } = makeMockCommandEncoder();
      system.dispatchTest(
        ce as unknown as GPUCommandEncoder,
        scene,
        { id: "globalBindGroup" },
        false,
      );
    }

    expect(createBindGroup).not.toHaveBeenCalled();
  });

  it("skips entirely when the current staging slot is still pending a previous mapAsync", () => {
    const system = makeReadySystem();
    system._hzbStagingPending = [true, false];
    const scene = makeSceneWith([makeObjectWithBounds(0, 0, 0, 1)]);

    const { ce, computePasses } = makeMockCommandEncoder();
    system.dispatchTest(
      ce as unknown as GPUCommandEncoder,
      scene,
      { id: "globalBindGroup" },
      false,
    );

    expect(computePasses).toHaveLength(0);
    expect(ce.copyBufferToBuffer).not.toHaveBeenCalled();
  });

  it("does nothing when there are no bounded candidates", () => {
    const system = makeReadySystem();
    const noBounds = new Object3D("NoBounds");
    noBounds.inFrustum = true;
    const scene = makeSceneWith([noBounds]);

    const { ce, computePasses } = makeMockCommandEncoder();
    system.dispatchTest(
      ce as unknown as GPUCommandEncoder,
      scene,
      { id: "globalBindGroup" },
      false,
    );

    expect(computePasses).toHaveLength(0);
  });
});

describe("HzbOcclusionSystem.applyOcclusionResults", () => {
  it("zips a mapped staging buffer's u32 flags onto the dispatched objects and unmaps", () => {
    const system = makeSystem();

    const raw = new Uint32Array([1, 0, 1]).buffer;
    const unmap = vi.fn();
    system._hzbStagingBuffers = [
      { mapState: "mapped", getMappedRange: vi.fn(() => raw), unmap },
      { mapState: "unmapped", getMappedRange: vi.fn(), unmap: vi.fn() },
    ];
    const [objA, objB, objC] = [
      makeObjectWithBounds(0, 0, 0, 1),
      makeObjectWithBounds(1, 0, 0, 1),
      makeObjectWithBounds(2, 0, 0, 1),
    ];
    system._hzbSlotObjects = [[objA, objB, objC], []];
    system._hzbStagingPending = [true, false];

    system.applyOcclusionResults();

    expect(objA.occlusionCulled).toBe(false); // 1 = visible
    expect(objB.occlusionCulled).toBe(true); // 0 = occluded
    expect(objC.occlusionCulled).toBe(false);
    expect(unmap).toHaveBeenCalledTimes(1);
    expect(system._hzbStagingPending[0]).toBe(false);
  });

  it("does nothing for a slot that's pending but not yet mapped", () => {
    const system = makeSystem();
    const unmap = vi.fn();
    system._hzbStagingBuffers = [
      { mapState: "pending", getMappedRange: vi.fn(), unmap },
      { mapState: "unmapped", getMappedRange: vi.fn(), unmap: vi.fn() },
    ];
    system._hzbSlotObjects = [[], []];
    system._hzbStagingPending = [true, false];

    expect(() => system.applyOcclusionResults()).not.toThrow();
    expect(unmap).not.toHaveBeenCalled();
    expect(system._hzbStagingPending[0]).toBe(true);
  });
});

describe("WebGPURenderer.applyPendingOcclusionResults delegate", () => {
  it("does nothing when occlusion culling isn't enabled (no HzbOcclusionSystem constructed)", () => {
    const renderer = new WebGPURenderer() as Internals;
    renderer._hzbSystem = undefined;

    expect(() => renderer.applyPendingOcclusionResults(new Scene())).not.toThrow();
  });
});
