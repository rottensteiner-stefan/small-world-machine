import { describe, expect, it } from "vitest";
import { Vector3D, Color } from "@small-world-machine/engine";
import { ParticleSystem } from "../src/ParticleSystem.js";
import type { ParticleAffector } from "../src/ParticleAffector.js";
import {
  PointAttractorAffector,
  VortexAffector,
  PlanarSpringAffector,
  ThermalCoolingAffector,
  FadeOutZoneAffector,
  TurbulenceAffector,
  DragAffector,
  ColorOverLifeAffector,
  SizeOverLifeAffector,
  BouncePlaneAffector,
} from "../src/affectors/index.js";
import {
  createArrays,
  cloneArrays,
  setState,
  readState,
  expectStateEqual,
  seededState,
  type ParticleState,
} from "./helpers/soa.js";

/* Deterministic PRNG (mulberry32) for seeded particle sets; the engine keeps mulberry32 internal
   to packages/engine/src/utils/SeededRandom.ts, so tests use a local copy. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The acceptance core for the hot-path contract: with a fresh affector instance, a seeded particle
 * slot set is fed to applyBatch() and, independently, to per-slot apply(); every field must then be
 * bit-identical (===). `make` is called once per variant so axis/interpolation configs are covered.
 */
function runBatchBitIdentity(
  variants: Array<{
    make: () => ParticleAffector;
    dt: number;
    states: (rng: () => number) => ParticleState[];
  }>,
): void {
  for (const variant of variants) {
    const rngState = mulberry32(0xc0ffee);
    const dt = variant.dt;
    const template = variant.states(rngState);
    const count = template.length;
    const batchArrays = createArrays(count);
    for (let i = 0; i < count; i++) {
      setState(batchArrays, i, template[i]!);
    }
    const applyArrays = cloneArrays(batchArrays, count);

    const affector = variant.make();
    expect(affector.applyBatch).toBeDefined();
    affector.beginFrame?.(dt);

    affector.applyBatch!(batchArrays, count, dt);

    // Reference: per-live-slot apply in exactly the legacy fallback (reverse-index) order.
    for (let i = count - 1; i >= 0; i--) {
      if (applyArrays.aliveFlags[i] === 0) {
        continue;
      }
      affector.apply(applyArrays, i, dt);
    }

    for (let i = 0; i < count; i++) {
      expectStateEqual(readState(batchArrays, i), readState(applyArrays, i));
    }
  }
}

describe("ParticleAffector batch API", () => {
  it("Drag: applyBatch is bit-identical to apply and skips dead slots", () => {
    runBatchBitIdentity([
      {
        dt: 0.016,
        make: (): ParticleAffector => new DragAffector({ drag: 2.0, quadraticDrag: 0.1 }),
        states: (rng: () => number): ParticleState[] => [
          ...Array.from({ length: 10 }, () => seededState(rng)),
          // Forced dead slot (must stay untouched).
          {
            pos: [1, 0, 0],
            vel: [0.2, -0.1, 0.4],
            acc: [0, 0, 0],
            col: [1, 1, 1, 1],
            size: 1,
            alpha: 1,
            mass: 1,
            life: 0,
            maxLife: Infinity,
            heat: 0,
            alive: false,
          },
          // Zero-velocity slot (still live; drag must be a no-op on it).
          {
            pos: [-2, 3, 1],
            vel: [0, 0, 0],
            acc: [0, 0, 0],
            col: [1, 1, 1, 1],
            size: 1,
            alpha: 1,
            mass: 1,
            life: 0,
            maxLife: Infinity,
            heat: 0,
            alive: true,
          },
        ],
      },
    ]);
    // A brand-new dead particle deep in the middle of a typical velocity range must stay untouched.
    const arrays = createArrays(1);
    setState(arrays, 0, { vel: [10, -5, 2], alive: false });
    const before = readState(arrays, 0);
    new DragAffector({ drag: 2.0, quadraticDrag: 0.1 }).applyBatch!(arrays, 1, 0.016);
    expectStateEqual(readState(arrays, 0), before);
  });

  it("ColorOverLife: applyBatch is bit-identical to apply (interpolateAlpha on and off)", () => {
    runBatchBitIdentity([
      {
        dt: 0.016,
        make: (): ParticleAffector =>
          new ColorOverLifeAffector({
            startColor: new Color(1, 0, 0, 1),
            endColor: new Color(0, 0, 1, 0),
            interpolateAlpha: true,
          }),
        states: (rng: () => number): ParticleState[] => {
          const set = Array.from({ length: 8 }, (_, i) => {
            const s = seededState(rng);
            s.life = i / 7; // 0 .. 1
            s.maxLife = 1;
            return s;
          });
          set.push({
            pos: [0, 0, 0],
            vel: [0, 0, 0],
            acc: [0, 0, 0],
            col: [1, 1, 1, 1],
            size: 1,
            alpha: 1,
            mass: 1,
            life: 0,
            maxLife: 1,
            heat: 0,
            alive: true,
          });
          set.push({
            pos: [0, 0, 0],
            vel: [0, 0, 0],
            acc: [0, 0, 0],
            col: [1, 1, 1, 1],
            size: 1,
            alpha: 1,
            mass: 1,
            life: 1,
            maxLife: 1,
            heat: 0,
            alive: true,
          });
          return set;
        },
      },
      {
        dt: 0.016,
        make: (): ParticleAffector =>
          new ColorOverLifeAffector({
            startColor: new Color(0.2, 0.5, 0.8, 0),
            endColor: new Color(0.9, 0.1, 0.3, 0.5),
            interpolateAlpha: false,
          }),
        states: (rng: () => number): ParticleState[] =>
          Array.from({ length: 6 }, () => seededState(rng)),
      },
    ]);
  });

  it("SizeOverLife: applyBatch is bit-identical to apply (including infinite max-life)", () => {
    runBatchBitIdentity([
      {
        dt: 0.016,
        make: (): ParticleAffector => new SizeOverLifeAffector({ startScale: 1.0, endScale: 0.2 }),
        states: (rng: () => number): ParticleState[] => {
          const set = Array.from({ length: 8 }, (_, i) => {
            const s = seededState(rng);
            s.life = i / 7;
            s.maxLife = 1;
            return s;
          });
          // maxLife=Infinity is the documented no-op branch.
          const inf = seededState(rng);
          inf.life = 0.5;
          inf.maxLife = Infinity;
          set.push(inf);
          return set;
        },
      },
    ]);
  });

  it("PointAttractor: applyBatch is bit-identical to apply (Plummer and Newtonian)", () => {
    runBatchBitIdentity([
      {
        dt: 0.016,
        make: (): ParticleAffector =>
          new PointAttractorAffector({
            center: new Vector3D(0, 0, 0),
            strength: 100,
            softening: 0.5,
            plummer: true,
          }),
        states: (rng: () => number): ParticleState[] => {
          const set = Array.from({ length: 10 }, () => seededState(rng));
          // Near-singularity particle exercising the softening denominator.
          const near = seededState(rng);
          near.pos = [1e-4, -2e-4, 3e-4];
          near.mass = 1;
          set.push(near);
          return set;
        },
      },
      {
        dt: 0.016,
        make: (): ParticleAffector =>
          new PointAttractorAffector({
            center: new Vector3D(3, -2, 5),
            strength: 40,
            softening: 0.25,
            plummer: false,
          }),
        states: (rng: () => number): ParticleState[] =>
          Array.from({ length: 8 }, () => seededState(rng)),
      },
    ]);
  });

  it("Vortex: applyBatch is bit-identical to apply for all three axes", () => {
    runBatchBitIdentity(
      (["x", "y", "z"] as const).map((axis) => ({
        dt: 0.016,
        make: (): ParticleAffector =>
          new VortexAffector({
            axis,
            strength: 5.0,
            inwardSuction: 1.5,
            center: new Vector3D(0, 0, 0),
          }),
        states: (rng: () => number): ParticleState[] => {
          if (axis === "y") {
            return Array.from({ length: 10 }, () => seededState(rng));
          }
          // Force radial positions around the axis so every tangential branch is hit.
          return Array.from({ length: 10 }, (_, i) => {
            const s = seededState(rng);
            if (axis === "x") {
              s.pos = [0, Math.cos(i) * 3, Math.sin(i) * 3];
            } else {
              s.pos = [Math.cos(i) * 3, Math.sin(i) * 3, 0];
            }
            return s;
          });
        },
      })),
    );
  });

  it("PlanarSpring: applyBatch is bit-identical to apply for all three axes", () => {
    runBatchBitIdentity(
      (["x", "y", "z"] as const).map((axis) => ({
        dt: 0.016,
        make: (): ParticleAffector =>
          new PlanarSpringAffector({ axis, planePosition: 0, stiffness: 10, damping: 2 }),
        states: (rng: () => number): ParticleState[] => {
          const set = Array.from({ length: 6 }, () => seededState(rng));
          // Large displacement on the spring axis + non-zero velocity on the damping term.
          const p = seededState(rng);
          if (axis === "x") p.pos = [4, p.pos[1], p.pos[2]];
          if (axis === "y") p.pos = [p.pos[0], 4, p.pos[2]];
          if (axis === "z") p.pos = [p.pos[0], p.pos[1], 4];
          p.vel = [1, 1, 1];
          set.push(p);
          return set;
        },
      })),
    );
  });

  it("BouncePlane: applyBatch is bit-identical to apply for all three axes", () => {
    runBatchBitIdentity(
      (["x", "y", "z"] as const).map((axis) => ({
        dt: 0.016,
        make: (): ParticleAffector =>
          new BouncePlaneAffector({ axis, planePosition: 0, restitution: 0.6, friction: 0.8 }),
        states: (rng: () => number): ParticleState[] => {
          const set = Array.from({ length: 4 }, () => seededState(rng));
          // Below the plane with a normal-velocity sign that triggers the bounce branch.
          for (let i = 0; i < 4; i++) {
            const p = seededState(rng);
            if (axis === "x") {
              p.pos = [-1, p.pos[1], p.pos[2]];
              p.vel = [-5, 2, -3];
            } else if (axis === "y") {
              p.pos = [p.pos[0], -1, p.pos[2]];
              p.vel = [2, -5, -3];
            } else {
              p.pos = [p.pos[0], p.pos[1], -1];
              p.vel = [2, -3, -5];
            }
            set.push(p);
          }
          // Above the plane: no-op branch must stay bit-identical too.
          const above = seededState(rng);
          if (axis === "x") above.pos = [2, above.pos[1], above.pos[2]];
          if (axis === "y") above.pos = [above.pos[0], 2, above.pos[2]];
          if (axis === "z") above.pos = [above.pos[0], above.pos[1], 2];
          above.vel = [0, 1, 0];
          set.push(above);
          return set;
        },
      })),
    );
  });

  it("ThermalCooling: applyBatch is bit-identical to apply (compression zone, cooling, color on/off)", () => {
    runBatchBitIdentity([
      {
        dt: 0.1,
        make: (): ParticleAffector =>
          new ThermalCoolingAffector({
            heatCenter: new Vector3D(0, 0, 0),
            compressionRadius: 1.0,
            compressionHeatingRate: 20,
            coolingRate: 1.0,
            maxHeat: 10,
            updateColor: true,
          }),
        states: (rng: () => number): ParticleState[] => {
          const set = Array.from({ length: 8 }, () => seededState(rng));
          const inside = seededState(rng);
          inside.pos = [0.2, 0, 0]; // inside zone + clamp
          inside.heat = 9.9;
          set.push(inside);
          const far = seededState(rng);
          far.pos = [5, 5, 5]; // far away, cooling only
          far.heat = 3;
          set.push(far);
          const hot = seededState(rng);
          hot.pos = [0.05, 0, 0]; // inside zone, blackbody
          hot.heat = 0;
          set.push(hot);
          return set;
        },
      },
      {
        dt: 0.1,
        make: (): ParticleAffector =>
          new ThermalCoolingAffector({
            heatCenter: new Vector3D(0, 0, 0),
            compressionRadius: 1.0,
            compressionHeatingRate: 20,
            coolingRate: 1.5,
            maxHeat: 5,
            updateColor: false,
          }),
        states: (rng: () => number): ParticleState[] =>
          Array.from({ length: 6 }, () => seededState(rng)),
      },
    ]);
  });

  it("FadeOutZone: applyBatch is bit-identical to apply (outer, mid, absorbed)", () => {
    runBatchBitIdentity([
      {
        dt: 0.016,
        make: (): ParticleAffector =>
          new FadeOutZoneAffector({
            center: new Vector3D(0, 0, 0),
            fadeStartRadius: 1.0,
            fadeEndRadius: 0.5,
            shrinkSize: true,
          }),
        states: (rng: () => number): ParticleState[] => {
          const set = Array.from({ length: 4 }, () => seededState(rng));
          const outside = seededState(rng);
          outside.pos = [2, 0, 0]; // outside zone
          outside.alpha = 1;
          set.push(outside);
          const mid = seededState(rng);
          mid.pos = [0.75, 0, 0]; // mid fade
          mid.alpha = 1;
          set.push(mid);
          const absorbed = seededState(rng);
          absorbed.pos = [0.4, 0, 0]; // absorbed -> dead
          absorbed.alpha = 1;
          set.push(absorbed);
          return set;
        },
      },
    ]);
  });

  it("Turbulence: applyBatch is bit-identical to apply (same frame time)", () => {
    runBatchBitIdentity([
      {
        dt: 0.016,
        make: (): ParticleAffector =>
          new TurbulenceAffector({ strength: 5.0, frequency: 0.7, evolutionSpeed: 1.0 }),
        states: (rng: () => number): ParticleState[] => {
          // beginFrame() must be the only time dependency; the shared instance keeps `_time` constant
          // across both evaluation paths inside runBatchBitIdentity.
          return Array.from({ length: 8 }, () => seededState(rng));
        },
      },
    ]);
  });

  it("applyBatch is used by ParticleSystem.update and its result matches the legacy per-particle path", () => {
    const rngA = mulberry32(0xfeed);
    const rngB = mulberry32(0xfeed);
    const make = (rng: () => number): ParticleSystem => {
      const system = new ParticleSystem({ capacity: 16 });
      system.addAffector(new VortexAffector({ axis: "y", strength: 3.0, inwardSuction: 0.5 }));
      system.addAffector(new DragAffector({ drag: 0.5 }));
      for (let i = 0; i < 16; i++) {
        system.emit({
          position: new Vector3D(rng() * 4 - 2, rng() * 4 - 2, rng() * 4 - 2),
          velocity: new Vector3D(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1),
        });
      }
      return system;
    };
    const batchSystem = make(rngA);
    const legacySystem = make(rngB);
    // Force the fallback path on the second system by stripping applyBatch from every affector.
    for (const aff of legacySystem.affectors) {
      delete (aff as unknown as { applyBatch?: unknown }).applyBatch;
    }
    for (let frame = 0; frame < 60; frame++) {
      batchSystem.update(0.016);
      legacySystem.update(0.016);
      for (let i = 0; i < batchSystem.activeCount; i++) {
        expectStateEqual(readState(batchSystem.arrays, i), readState(legacySystem.arrays, i));
      }
    }
  });

  it("keeps working with third-party affectors that only implement apply (fallback path)", () => {
    const system = new ParticleSystem({ capacity: 4 });
    const fallback: ParticleAffector = {
      apply: (arrays, index): void => {
        arrays.accelerations[index * 3 + 1]! += 9.81;
      },
    };
    expect(fallback.applyBatch).toBeUndefined();
    system.addAffector(fallback);
    const index = system.emit({ position: new Vector3D(0, 0, 0) });
    system.update(1.0);
    expect(system.isAlive(index)).toBe(true);
    expect(system.arrays.velocities[index * 3 + 1]).toBeCloseTo(9.81);
  });

  it("update() reuses its internal arrays and buffers (zero per-frame allocation)", () => {
    const system = new ParticleSystem({ capacity: 64 });
    system.addAffector(new DragAffector({ drag: 0.5 }));
    system.addAffector(new VortexAffector({ axis: "y", strength: 3.0 }));
    const rng = mulberry32(0xabc123);
    for (let i = 0; i < 64; i++) {
      system.emit({
        position: new Vector3D(rng() * 10 - 5, rng() * 10 - 5, rng() * 10 - 5),
        velocity: new Vector3D(rng() * 4 - 2, rng() * 4 - 2, rng() * 4 - 2),
        maxLife: Infinity,
        size: 0.5,
      });
    }
    system.update(1 / 60);

    const internal = system as unknown as {
      readonly _frameFlags: Uint8Array;
      readonly _freeIndices: number[];
    };
    const arraysRef = system.arrays;
    const positionsRef = system.arrays.positions;
    const flagsRef = internal._frameFlags;
    const freeRef = internal._freeIndices;

    for (let frame = 0; frame < 5000; frame++) {
      system.update(1 / 60);
    }

    expect(system.arrays).toBe(arraysRef);
    expect(system.arrays.positions).toBe(positionsRef);
    expect(system.activeCount).toBe(64);
    expect(internal._frameFlags).toBe(flagsRef);
    expect(internal._freeIndices).toBe(freeRef);
  });
});
