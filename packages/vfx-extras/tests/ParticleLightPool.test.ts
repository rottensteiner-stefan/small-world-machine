/**
 * C2 (T8) — ParticleLightPool verification (LIGHTPOOL-BUDGET-BOUND + LIGHTPOOL-FADE-ENVELOPE),
 * Charlie. Implemented against Dave's landed WIP `packages/vfx-extras/src/ParticleLightPool.ts`.
 *
 * @invariant LIGHTPOOL-BUDGET-BOUND: lit pool lights <= min(maxActive, MAX_POOL_LIGHTS) <= 8.
 * @invariant LIGHTPOOL-FADE-ENVELOPE: per-slot fade stays in [0,1], monotone toward its target,
 *   and `update` performs zero heap allocation (C1 harness).
 */
import { describe, expect, it } from "vitest";
import { Object3D, PointLight, Vector3D } from "@small-world-machine/engine";
import { ParticleSystem } from "../src/ParticleSystem.js";
import { ParticleLightPool } from "../src/ParticleLightPool.js";
import { countAllocations } from "./helpers/AllocationHarness.js";

const MAX_POOL_LIGHTS = 8 as const;

function hotSystem(capacity: number, hotCount: number): ParticleSystem {
  const system = new ParticleSystem({ capacity });
  const pos = new Vector3D();
  for (let i = 0; i < hotCount; i++) {
    pos.set(i * 0.3, 1 + i * 0.1, -i * 0.2);
    system.emit({ position: pos, heat: 1, alpha: 1, maxLife: 1e9 });
  }
  return system;
}

function poolLights(root: Object3D): PointLight[] {
  return root.children.filter((child): child is PointLight => child instanceof PointLight);
}

describe("C2 ParticleLightPool (LIGHTPOOL-BUDGET-BOUND)", () => {
  it("never lights more than 8 pool lights regardless of hot particle count", () => {
    const root = new Object3D("root");
    const system = hotSystem(128, 64); // far more hot particles than pool slots
    const pool = new ParticleLightPool(system, root, { maxActive: 8, fadeTime: 0.05 });
    try {
      // Enough frames to fully fade in every claimed slot.
      for (let f = 0; f < 40; f++) pool.update(0.016);
      expect(pool.activeCount).toBeGreaterThan(0);
      expect(pool.activeCount).toBeLessThanOrEqual(MAX_POOL_LIGHTS);
      // The scene graph must never grow beyond the preallocated pool either.
      expect(poolLights(root).length).toBe(MAX_POOL_LIGHTS);
    } finally {
      pool.dispose();
    }
  });

  it("honors a smaller maxActive budget (activeCount <= maxActive)", () => {
    const root = new Object3D("root");
    const system = hotSystem(128, 32);
    const pool = new ParticleLightPool(system, root, { maxActive: 3, fadeTime: 0.05 });
    try {
      for (let f = 0; f < 40; f++) pool.update(0.016);
      expect(pool.activeCount).toBeGreaterThan(0);
      expect(pool.activeCount).toBeLessThanOrEqual(3);
      expect(poolLights(root).length).toBe(MAX_POOL_LIGHTS); // pool stays 8, only 3 lit
    } finally {
      pool.dispose();
    }
  });

  it("fades every claimed light out when all particles die (budget releases)", () => {
    const root = new Object3D("root");
    const system = hotSystem(64, 8);
    const pool = new ParticleLightPool(system, root, { maxActive: 8, fadeTime: 0.05 });
    try {
      for (let f = 0; f < 40; f++) pool.update(0.016);
      expect(pool.activeCount).toBeGreaterThan(0);

      system.clear(); // every target is gone -> all slots must fade out
      for (let f = 0; f < 40; f++) pool.update(0.016);
      expect(pool.activeCount).toBe(0);
      for (const light of poolLights(root)) {
        expect(light.intensity).toBe(0);
        expect(light.isVisible).toBe(false);
      }
    } finally {
      pool.dispose();
    }
  });
});

describe("C2 ParticleLightPool (LIGHTPOOL-FADE-ENVELOPE)", () => {
  it("fades intensity in monotonically within [0, intensityScale] and never overshoots", () => {
    const root = new Object3D("root");
    const system = hotSystem(64, 1);
    const pool = new ParticleLightPool(system, root, {
      maxActive: 1,
      fadeTime: 0.1,
      intensityScale: 1,
    });
    try {
      const light = poolLights(root)[0]!;
      let prev = 0;
      for (let f = 0; f < 30; f++) {
        pool.update(0.016);
        const current = light.intensity;
        expect(current).toBeGreaterThanOrEqual(prev - 1e-9); // monotone non-decreasing
        expect(current).toBeGreaterThanOrEqual(0);
        expect(current).toBeLessThanOrEqual(1); // envelope [0, intensityScale] with scale 1
        prev = current;
      }
      expect(prev).toBeCloseTo(1, 5); // converges to full envelope, no asymptotic shortfall
    } finally {
      pool.dispose();
    }
  });

  it("fades intensity out monotonically to 0 after the target dies (no overshoot, no negative)", () => {
    const root = new Object3D("root");
    const system = hotSystem(64, 1);
    const pool = new ParticleLightPool(system, root, {
      maxActive: 1,
      fadeTime: 0.1,
      intensityScale: 1,
    });
    try {
      const light = poolLights(root)[0]!;
      for (let f = 0; f < 30; f++) pool.update(0.016);
      expect(light.intensity).toBeCloseTo(1, 5);

      system.clear();
      let prev = light.intensity;
      for (let f = 0; f < 40; f++) {
        pool.update(0.016);
        const current = light.intensity;
        expect(current).toBeLessThanOrEqual(prev + 1e-9); // monotone non-increasing
        expect(current).toBeGreaterThanOrEqual(0);
        prev = current;
      }
      expect(prev).toBe(0); // fully faded out
    } finally {
      pool.dispose();
    }
  });

  it("allocates zero typed arrays during steady-state update (C1 gate for the light lane)", () => {
    const root = new Object3D("root");
    const system = hotSystem(128, 16);
    const pool = new ParticleLightPool(system, root, { maxActive: 8, fadeTime: 0.1 });

    // Warm up: full fade/rank cycles happen inside the first frames; the measured region must be
    // allocation-free.
    for (let f = 0; f < 20; f++) pool.update(0.016);
    for (let f = 0; f < 10; f++) {
      for (let f2 = 0; f2 < 20; f2++) pool.update(0.016);
    }

    let allocs: ReturnType<typeof countAllocations> | undefined;
    try {
      allocs = countAllocations(() => {
        for (let f = 0; f < 100; f++) pool.update(0.016);
      });
    } finally {
      pool.dispose();
    }
    expect(allocs!.total).toBe(0);
  });
});
