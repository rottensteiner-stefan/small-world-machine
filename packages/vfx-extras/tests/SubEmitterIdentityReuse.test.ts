/**
 * C2 (T8) — SubEmitter ring-buffer identity-reuse verification, Charlie.
 *
 * Contract under test (committed T5/T6 code, `packages/vfx-extras/src/spawners/SubEmitter.ts`):
 * the death/collision event queue is a single pre-allocated `Float32Array` ring buffer
 * (`_eventBuffer`, `maxEventsPerFrame * EVENT_STRIDE`) that is NEVER reallocated after
 * construction, is capped (overflow drops, no growth), and is fully drained+reset by `flush()`
 * so stale events never leak into the next cycle. This is the "identity-reuse" property the C1
 * harness keys on for the whole event bridge (frames 2..1000 zero alloc).
 *
 * These are the base C2 rows of the verification matrix; trail/lightpool/smoke/GPU/heightfield
 * rows live in their own files (it.todo until Dave/Bob land).
 */
import { describe, expect, it } from "vitest";
import { Vector3D } from "@small-world-machine/engine";
import { ParticleSystem } from "../src/ParticleSystem.js";
import { SubEmitter } from "../src/spawners/SubEmitter.js";
import {
  assertZeroAllocationFrames,
  countAllocations,
  type AllocationCounts,
} from "./helpers/AllocationHarness.js";

/** Parent expires on the very next `update(0.016)` call (maxLife < dt). */
const DIE_DT = 0.016;
const PARENT_MAX_LIFE = 0.001;

function dieOnce(primary: ParticleSystem, pos: Vector3D, vel: Vector3D): void {
  pos.x = pos.x + 1;
  primary.emit({ position: pos, velocity: vel, maxLife: PARENT_MAX_LIFE });
  primary.update(DIE_DT);
}

describe("C2 SubEmitter ring-buffer identity-reuse (zero-GC event bridge)", () => {
  it("reuses the SAME preallocated event buffer across 1000 death cycles (frames 2..1000 zero typed-array alloc)", () => {
    const primary = new ParticleSystem({ capacity: 16 });
    const secondary = new ParticleSystem({ capacity: 1100 });
    const sub = new SubEmitter({
      source: primary,
      target: secondary,
      trigger: "death",
      burstCount: 1,
      speedRange: [1, 1],
      lifeRange: [1, 1],
      seed: 7,
    });
    const pos = new Vector3D(0, 0, 0);
    const vel = new Vector3D(0, 2, 0);

    // Steady state: every frame one parent dies and is flushed; the buffer must be reused, not
    // reallocated, so zero typed arrays may appear on frames 2..1000.
    assertZeroAllocationFrames(
      "SubEmitter death->flush steady state",
      (frame) => {
        dieOnce(primary, pos, vel);
        expect(sub.queuedEventCount).toBe(1);
        const spawned = sub.flush();
        expect(spawned).toBe(1);
        expect(sub.queuedEventCount).toBe(0);
        expect(secondary.activeCount).toBe(frame + 1); // 1 child per cycle, monotonically growing
      },
      { totalFrames: 1000 },
    );
  });

  it("preserves the Float32Array buffer object identity across many cycles (no instance churn)", () => {
    const primary = new ParticleSystem({ capacity: 16 });
    const secondary = new ParticleSystem({ capacity: 1100 });
    const sub = new SubEmitter({
      source: primary,
      target: secondary,
      trigger: "death",
      burstCount: 1,
      speedRange: [1, 1],
      lifeRange: [1, 1],
      seed: 11,
    });
    const pos = new Vector3D(0, 0, 0);
    const vel = new Vector3D(0, 2, 0);

    // Warm up one cycle OUTSIDE the capture window (absorbs per-subscriber lazy init).
    dieOnce(primary, pos, vel);
    sub.flush();

    const captured: object[] = [];
    const origF32 = globalThis.Float32Array;
    globalThis.Float32Array = new Proxy(origF32, {
      construct(target, args, newTarget): Float32Array {
        const instance = Reflect.construct(target, args, newTarget) as Float32Array;
        captured.push(instance);
        return instance;
      },
    });
    try {
      for (let cycle = 0; cycle < 200; cycle++) {
        dieOnce(primary, pos, vel);
        expect(sub.flush()).toBe(1);
      }
    } finally {
      globalThis.Float32Array = origF32;
    }

    // Zero new Float32Array instances during steady-state operation => the exact same buffer
    // object (identity) is reused every cycle.
    expect(captured).toEqual([]);
    expect(sub.queuedEventCount).toBe(0);
  });

  it("fully drains and resets the ring on flush: stale events are never re-emitted", () => {
    const primary = new ParticleSystem({ capacity: 16 });
    const secondary = new ParticleSystem({ capacity: 64 });
    const sub = new SubEmitter({
      source: primary,
      target: secondary,
      trigger: "death",
      burstCount: 2,
      speedRange: [1, 1],
      lifeRange: [1, 1],
      seed: 3,
    });
    const pos = new Vector3D(10, 20, 30);
    const vel = new Vector3D(0, 5, 0);

    dieOnce(primary, pos, vel);
    expect(sub.queuedEventCount).toBe(1);
    expect(sub.flush()).toBe(2);
    expect(secondary.activeCount).toBe(2);

    // No new events were recorded: a repeat flush must be a no-op (buffer reset, no re-play).
    expect(sub.queuedEventCount).toBe(0);
    expect(sub.flush()).toBe(0);
    expect(secondary.activeCount).toBe(2);
    for (let c = 0; c < secondary.activeCount; c++) {
      expect(secondary.arrays.alphas[c]).toBeGreaterThan(0);
    }
  });

  it("caps overflow at maxEventsPerFrame (drop, never grows) and recycles the same slots next frame", () => {
    const primary = new ParticleSystem({ capacity: 32 });
    const secondary = new ParticleSystem({ capacity: 64 });
    const sub = new SubEmitter({
      source: primary,
      target: secondary,
      trigger: "death",
      maxEventsPerFrame: 4,
      burstCount: 2,
      speedRange: [1, 1],
      lifeRange: [1, 1],
      seed: 5,
    });

    // 20 parents die in ONE frame -> only maxEventsPerFrame (4) may be queued; the rest drop.
    const pos = new Vector3D(0, 0, 0);
    for (let i = 0; i < 20; i++) {
      pos.set(i * 0.1, 1, -i * 0.1);
      primary.emit({ position: pos, velocity: new Vector3D(0, 3, 0), maxLife: PARENT_MAX_LIFE });
    }

    let allocs: AllocationCounts | undefined;
    try {
      allocs = countAllocations(() => {
        primary.update(DIE_DT);
        expect(sub.queuedEventCount).toBe(4); // hard cap, no growth despite 20 deaths
      });
    } finally {
      // noop
    }
    // update() itself must not allocate either (buffer identity + ring cap are allocation-free).
    expect(allocs!.total).toBe(0);

    const spawned = sub.flush();
    expect(spawned).toBe(8); // 4 events * burstCount 2
    expect(sub.queuedEventCount).toBe(0);

    // Next frame the same preallocated slots are reused for NEW events (no leak from the cap).
    const fresh = new Vector3D(99, 99, 99);
    primary.emit({ position: fresh, velocity: new Vector3D(0, 0, 0), maxLife: PARENT_MAX_LIFE });
    primary.update(DIE_DT);
    expect(sub.queuedEventCount).toBe(1);
    const childrenBefore = secondary.activeCount; // 8 from the overflow flush
    const next = sub.flush();
    expect(next).toBe(2);
    expect(secondary.activeCount).toBe(childrenBefore + 2);
    for (let i = 0; i < next; i++) {
      // Children spawn from the NEW death position (99, 99, 99 — zero velocity, so the parent
      // never integrates away from it), not stale overflow data. The new children occupy the
      // slots AFTER the overflow burst (childrenBefore + i).
      const base = (childrenBefore + i) * 3;
      expect(secondary.arrays.positions[base]).toBeCloseTo(99, 4);
      expect(secondary.arrays.positions[base + 1]).toBeCloseTo(99, 4);
      expect(secondary.arrays.positions[base + 2]).toBeCloseTo(99, 4);
    }
  });
});
