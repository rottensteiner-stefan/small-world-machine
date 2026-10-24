import "../../src/index.js";
import { describe, expect, it, vi } from "vitest";
import { HzbOcclusionSystem } from "../../src/renderers/WebGPU/managers/HzbOcclusionSystem.js";
import type { GPUFallbackResources } from "../../src/renderers/WebGPU/managers/GPUFallbackResources.js";
import { Object3D } from "../../src/core/Object3D.js";
import { BoundingSphere } from "../../src/physix/index.js";
import { Vector3D } from "../../src/math/index.js";

// Node/vitest has no WebGPU global -- stub the bit-flag constants the constructor reads (same
// approach as HzbOcclusionPassGPU.test.ts).
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

function makeMockDevice(): Internals {
  const device = {
    createBindGroupLayout: vi.fn((desc: Record<string, unknown>) => ({ desc })),
    createPipelineLayout: vi.fn((desc: Record<string, unknown>) => ({ desc })),
    createComputePipeline: vi.fn((desc: Record<string, unknown>) => ({ id: "p", ...desc })),
    createShaderModule: vi.fn((desc: Record<string, unknown>) => ({ module: desc })),
    createBindGroup: vi.fn((desc: Record<string, unknown>) => ({ desc })),
    createBuffer: vi.fn((desc: Record<string, unknown>) => ({ id: "buffer", ...desc })),
    createTexture: vi.fn(() => ({ createView: vi.fn(() => ({})), destroy: vi.fn() })),
    queue: { writeBuffer: vi.fn() },
  };
  return { createBindGroup: device.createBindGroup, _device: device, device };
}

function makeSystem(): Internals {
  const { _device } = makeMockDevice();
  const system = new HzbOcclusionSystem(
    _device as unknown as GPUDevice,
    {} as unknown as GPUFallbackResources,
    "testShaderCode",
    {} as unknown as GPUBindGroupLayout,
    () => 4,
  ) as Internals;
  return system;
}

function makeObject(x: number, y: number, z: number, radius: number): Object3D {
  const obj = new Object3D(`obj_${x}_${y}_${z}`);
  obj.bounds = new BoundingSphere(new Vector3D(x, y, z), radius);
  return obj;
}

/** Feeds one `applyOcclusionResults()` round-trip with the given per-object flags. */
function feed(system: Internals, objs: Object3D[], flags: number[]): void {
  const raw = new Uint32Array(flags).buffer;
  system._hzbStagingBuffers = [
    { mapState: "mapped", getMappedRange: vi.fn(() => raw), unmap: vi.fn() },
    { mapState: "unmapped", getMappedRange: vi.fn(), unmap: vi.fn() },
  ];
  system._hzbSlotObjects = [objs, []];
  system._hzbStagingPending = [true, false];
  system.applyOcclusionResults();
}

/**
 * S3 DP-4A / E2 (MANDATORY): after a camera teleport the HZB `_occludedStreak` MUST be cleared,
 * otherwise the next `applyOcclusionResults()` re-culls on a stale per-object streak -- the
 * readback latency then flips an object back to `occlusionCulled = true` after as little as ONE
 * more "occluded" readback, i.e. a brand-new camera position snap-culls to the pre-cut one.
 */
describe("HzbOcclusionSystem.resetOcclusionStreak (S3 DP-4A / E2)", () => {
  it("clears the per-object streak so a single pre-cut occluded readback cannot re-cull post-cut", () => {
    const system = makeSystem();
    const obj = makeObject(0, 0, 0, 1);

    // Pre-cut: one occluded readback -> streak 1, still drawn (hysteresis needs 2).
    feed(system, [obj], [0]);
    expect(obj.occlusionCulled).toBe(false);
    expect(system._occludedStreak.get(obj)).toBe(1);

    // Teleport: streak MUST be wiped (the scene-wide occlusionCulled walk is engine-side and not
    // this system's job; note the flag needs no reset here because it was never set).
    system.resetOcclusionStreak();
    expect(system._occludedStreak.get(obj)).toBeUndefined();

    // Post-cut: ONE more occluded readback must NOT re-cull (fresh streak starts at 1 < 2).
    feed(system, [obj], [0]);
    expect(obj.occlusionCulled).toBe(false);
    // And a second one reaches the threshold again -- culling still works after the reset.
    feed(system, [obj], [0]);
    expect(obj.occlusionCulled).toBe(true);
  });

  it("does NOT touch per-object occlusionCulled flags (that is the scene walk's responsibility)", () => {
    const system = makeSystem();
    const obj = makeObject(0, 0, 0, 1);
    obj.occlusionCulled = true;

    system.resetOcclusionStreak();

    // The renderer-side reset only wipes the streak; `Scene.resetOcclusionCulled()` /
    // `SmallWorldMachine.notifyCameraTeleport()` handle the flag walk.
    expect(obj.occlusionCulled).toBe(true);
  });

  it("is idempotent and safe with no prior history", () => {
    const system = makeSystem();
    expect(() => system.resetOcclusionStreak()).not.toThrow();
    expect(() => system.resetOcclusionStreak()).not.toThrow();
  });
});
