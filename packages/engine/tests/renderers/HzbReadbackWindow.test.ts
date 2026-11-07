import "../../src/index.js";
import { describe, expect, it, vi } from "vitest";
import { HzbOcclusionSystem } from "../../src/renderers/WebGPU/managers/HzbOcclusionSystem.js";
import type { GPUFallbackResources } from "../../src/renderers/WebGPU/managers/GPUFallbackResources.js";
import { Object3D } from "../../src/core/Object3D.js";
import { BoundingSphere } from "../../src/physix/index.js";
import { Vector3D } from "../../src/math/index.js";

/**
 * @invariant HZB-READBACK-WINDOW: Occlusion-Culling ist nach unten konservativ und zeitlich
 *   begrenzt: Ein Objekt wird erst nach genau `HZB_OCCLUDED_FRAMES_TO_CULL` aufeinanderfolgenden
 *   "occluded"-Readbacks gecullt (Hysterese), und ein einzelnes "visible"-Readback unculled sofort
 *   in DERSELBEN Apply-Runde. Nach einem Teleport (dokumentierte Readback-Latenz 1–3 Frames)
 *   darf ein Stale-"occluded"-Readback aus der Vor-Cut-Zeit das Objekt nicht wieder in
 *   `occlusionCulled` drücken — der Streak ist `resetOcclusionStreak()`-gezinnt.
 */

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
  return new HzbOcclusionSystem(
    _device as unknown as GPUDevice,
    {} as unknown as GPUFallbackResources,
    "testShaderCode",
    {} as unknown as GPUBindGroupLayout,
    () => 4,
  ) as Internals;
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

describe("HZB-READBACK-WINDOW (bounded conservative occlusion decision)", () => {
  it("culls only after exactly two consecutive occluded readbacks (hysteresis keeps the window bounded)", () => {
    const system = makeSystem();
    const obj = makeObject(0, 0, 0, 1);

    // 1 readback: drawn (streak 1 < threshold).
    feed(system, [obj], [0]);
    expect(obj.occlusionCulled).toBe(false);
    expect(system._occludedStreak.get(obj)).toBe(1);

    // 2nd consecutive readback: culled (window reached).
    feed(system, [obj], [0]);
    expect(obj.occlusionCulled).toBe(true);
  });

  it("a single visible readback un-culls immediately in the same apply round (bounded max hidden frames)", () => {
    const system = makeSystem();
    const obj = makeObject(0, 0, 0, 1);

    feed(system, [obj], [0]);
    feed(system, [obj], [0]);
    expect(obj.occlusionCulled).toBe(true);

    // One fresh "visible" readback un-culls at once -- an object never stays culled after a
    // genuinely visible result reaches the CPU. The object is therefore drawn within at most
    // (READBACK_LATENCY + HZB_OCCLUDED_FRAMES_TO_CULL) frames after true visibility.
    feed(system, [obj], [1]);
    expect(obj.occlusionCulled).toBe(false);
  });

  // Parametrizes the documented readback latency window (1-3 frames): after a camera cut/teleport
  // the stale "occluded" readbacks that can still arrive are bounded by the LATENCY, but the
  // DECISION window is an engine constant (HZB_OCCLUDED_FRAMES_TO_CULL = 2). The re-cull, if any,
  // therefore happens EXACTLY at streak 2 and never earlier -- independent of the latency value.
  // This pins the bounded window: an object is never culled by a single stale readback and never
  // delayed beyond the hysteresis constant.
  it.each([1, 2, 3])(
    "teleport + %s stale occluded readback(s): re-cull bound is the constant hysteresis (2), not the latency",
    (latency) => {
      const system = makeSystem();
      const obj = makeObject(0, 0, 0, 1);

      // Pre-cut: object was genuinely occluded for the old camera; teleport must wipe the streak.
      feed(system, [obj], [0]);
      system.resetOcclusionStreak();
      expect(system._occludedStreak.get(obj)).toBeUndefined();

      // Latency-stale "occluded" readbacks arrive. The decision window is constant: culling can
      // only start at the 2nd consecutive occluded readback (hysteresis), regardless of latency.
      let culledAt: number | null = null;
      for (let s = 0; s < latency; s++) {
        feed(system, [obj], [0]);
        if (culledAt === null && obj.occlusionCulled) culledAt = s + 1;
        // Never earlier than the 2nd consecutive readback (single stale readback can't re-cull).
        if (s === 0) expect(obj.occlusionCulled).toBe(false);
      }
      if (latency < 2) {
        expect(culledAt).toBeNull();
      } else {
        // Bounded: exactly at the hysteresis constant, and it holds from there on.
        expect(culledAt).toBe(2);
      }

      // A single current "visible" readback un-culls at once -- worst case the object is culled
      // for at most (HZB_OCCLUDED_FRAMES_TO_CULL + remaining latency) applied frames.
      feed(system, [obj], [1]);
      expect(obj.occlusionCulled).toBe(false);
    },
  );

  it("culling still works after a teleport reset (window is bounded from BELOW, not disabled)", () => {
    const system = makeSystem();
    const obj = makeObject(0, 0, 0, 1);
    system.resetOcclusionStreak();

    // Fresh streak: AFTER the reset, occlusion still accumulates and culls.
    feed(system, [obj], [0]);
    expect(obj.occlusionCulled).toBe(false);
    feed(system, [obj], [0]);
    expect(obj.occlusionCulled).toBe(true);
  });
});
