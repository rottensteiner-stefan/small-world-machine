import { describe, expect, it } from "vitest";
import { Vector3D, Color } from "@small-world-machine/engine";
import { Particle } from "../src/Particle.js";
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

interface ParticleState {
  pos: [number, number, number];
  vel: [number, number, number];
  acc: [number, number, number];
  col: [number, number, number, number];
  size: number;
  alpha: number;
  mass: number;
  life: number;
  maxLife: number;
  heat: number;
  dead: boolean;
}

function readState(p: Particle): ParticleState {
  return {
    pos: [p.position.x, p.position.y, p.position.z],
    vel: [p.velocity.x, p.velocity.y, p.velocity.z],
    acc: [p.acceleration.x, p.acceleration.y, p.acceleration.z],
    col: [p.color.r, p.color.g, p.color.b, p.color.a],
    size: p.size,
    alpha: p.alpha,
    mass: p.mass,
    life: p.life,
    maxLife: p.maxLife,
    heat: p.heat,
    dead: p.dead,
  };
}

/** Exact (===) field-for-field comparison: applyBatch output must equal per-particle apply output bit for bit. */
function expectStatesEqual(a: ParticleState, b: ParticleState): void {
  for (let k = 0; k < 3; k++) {
    expect(a.pos[k]).toBe(b.pos[k]);
    expect(a.vel[k]).toBe(b.vel[k]);
    expect(a.acc[k]).toBe(b.acc[k]);
  }
  for (let k = 0; k < 4; k++) {
    expect(a.col[k]).toBe(b.col[k]);
  }
  expect(a.size).toBe(b.size);
  expect(a.alpha).toBe(b.alpha);
  expect(a.mass).toBe(b.mass);
  expect(a.life).toBe(b.life);
  expect(a.maxLife).toBe(b.maxLife);
  expect(a.heat).toBe(b.heat);
  expect(a.dead).toBe(b.dead);
}

function cloneParticle(p: Particle): Particle {
  const c = new Particle({
    position: new Vector3D(p.position.x, p.position.y, p.position.z),
    velocity: new Vector3D(p.velocity.x, p.velocity.y, p.velocity.z),
    acceleration: new Vector3D(p.acceleration.x, p.acceleration.y, p.acceleration.z),
    color: new Color(p.color.r, p.color.g, p.color.b, p.color.a),
    size: p.size,
    alpha: p.alpha,
    mass: p.mass,
    life: p.life,
    maxLife: p.maxLife,
    heat: p.heat,
  });
  c.dead = p.dead;
  return c;
}

/** Generic seeded particle with a mostly random state that the mutate hook can override for branch coverage. */
function seededParticle(rng: () => number): Particle {
  return new Particle({
    position: new Vector3D(rng() * 12 - 6, rng() * 12 - 6, rng() * 12 - 6),
    velocity: new Vector3D(rng() * 20 - 10, rng() * 20 - 10, rng() * 20 - 10),
    size: 0.2 + rng(),
    alpha: rng(),
    mass: 2 + rng() * 4,
    life: rng() * 2,
    maxLife: 5,
    heat: rng() * 10,
  });
}

/**
 * The acceptance core for the hot-path contract: with a fresh affector instance, a seeded particle
 * set is fed to applyBatch() and, independently, to per-particle apply(); every field must then be
 * bit-identical (===). `make` is called once per variant so axis/interpolation configs are covered.
 */
function runBatchBitIdentity(
  variants: Array<{
    make: () => ParticleAffector;
    dt: number;
    particles: (rng: () => number) => Particle[];
  }>,
): void {
  for (const variant of variants) {
    const rngState = mulberry32(0xc0ffee);
    const dt = variant.dt;
    const template = variant.particles(rngState);
    const batchClone = template.map(cloneParticle);
    const applyClone = template.map(cloneParticle);

    const affector = variant.make();
    expect(affector.applyBatch).toBeDefined();
    affector.beginFrame?.(dt);

    affector.applyBatch!(batchClone, batchClone.length, dt);

    // Reference: per-particle apply on live particles only (exactly the legacy fallback order).
    for (let i = applyClone.length - 1; i >= 0; i--) {
      const p = applyClone[i]!;
      if (p.dead) {
        continue;
      }
      affector.apply(p, dt, i, applyClone.length);
    }

    for (let i = 0; i < template.length; i++) {
      expectStatesEqual(readState(batchClone[i]!), readState(applyClone[i]!));
    }
  }
}

describe("ParticleAffector batch API", () => {
  it("Drag: applyBatch is bit-identical to apply and skips dead slots", () => {
    runBatchBitIdentity([
      {
        dt: 0.016,
        make: (): ParticleAffector => new DragAffector({ drag: 2.0, quadraticDrag: 0.1 }),
        particles: (rng: () => number): Particle[] => [
          ...Array.from({ length: 10 }, () => seededParticle(rng)),
          // Forced dead and zero-velocity slots.
          new Particle({
            position: new Vector3D(1, 0, 0),
            velocity: new Vector3D(0.2, -0.1, 0.4),
            mass: 1,
          }),
          new Particle({
            position: new Vector3D(-2, 3, 1),
            velocity: new Vector3D(0, 0, 0),
            mass: 1,
          }),
        ],
      },
    ]);
    // A brand-new dead particle deep in the middle of a typical velocity range must stay untouched.
    const dead = new Particle({ velocity: new Vector3D(10, -5, 2) });
    dead.dead = true;
    const before = readState(dead);
    new DragAffector({ drag: 2.0, quadraticDrag: 0.1 }).applyBatch!([dead], 1, 0.016);
    expectStatesEqual(readState(dead), before);
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
        particles: (rng: () => number): Particle[] => {
          const set = Array.from({ length: 8 }, (_, i) => {
            const p = seededParticle(rng);
            p.life = i / 7; // 0 .. 1
            p.maxLife = 1;
            return p;
          });
          set.push(new Particle({ life: 0, maxLife: 1 }));
          set.push(new Particle({ life: 1, maxLife: 1 }));
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
        particles: (rng: () => number): Particle[] =>
          Array.from({ length: 6 }, () => seededParticle(rng)),
      },
    ]);
  });

  it("SizeOverLife: applyBatch is bit-identical to apply (including infinite max-life)", () => {
    runBatchBitIdentity([
      {
        dt: 0.016,
        make: (): ParticleAffector => new SizeOverLifeAffector({ startScale: 1.0, endScale: 0.2 }),
        particles: (rng: () => number): Particle[] => {
          const set = Array.from({ length: 8 }, (_, i) => {
            const p = seededParticle(rng);
            p.life = i / 7;
            p.maxLife = 1;
            return p;
          });
          // maxLife=Infinity is the documented no-op branch.
          set.push(new Particle({ life: 0.5, maxLife: Infinity }));
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
        particles: (rng: () => number): Particle[] => {
          const set = Array.from({ length: 10 }, () => seededParticle(rng));
          // Near-singularity particle exercising the softening denominator.
          set.push(new Particle({ position: new Vector3D(1e-4, -2e-4, 3e-4), mass: 1 }));
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
        particles: (rng: () => number): Particle[] =>
          Array.from({ length: 8 }, () => seededParticle(rng)),
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
        particles: (rng: () => number): Particle[] => {
          if (axis === "y") {
            return Array.from({ length: 10 }, () => seededParticle(rng));
          }
          // Force radial positions around the axis so every tangential branch is hit.
          return Array.from({ length: 10 }, (_, i) => {
            const p = seededParticle(rng);
            if (axis === "x") {
              p.position.set(0, Math.cos(i) * 3, Math.sin(i) * 3);
            } else {
              p.position.set(Math.cos(i) * 3, Math.sin(i) * 3, 0);
            }
            return p;
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
        particles: (rng: () => number): Particle[] => {
          const set = Array.from({ length: 6 }, () => seededParticle(rng));
          // Large displacement on the spring axis + non-zero velocity on the damping term.
          const p = seededParticle(rng);
          if (axis === "x") p.position.x = 4;
          if (axis === "y") p.position.y = 4;
          if (axis === "z") p.position.z = 4;
          p.velocity.set(1, 1, 1);
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
        particles: (rng: () => number): Particle[] => {
          const set = Array.from({ length: 4 }, () => seededParticle(rng));
          // Below the plane with a normal-velocity sign that triggers the bounce branch.
          for (let i = 0; i < 4; i++) {
            const p = seededParticle(rng);
            if (axis === "x") {
              p.position.x = -1;
              p.velocity.set(-5, 2, -3);
            } else if (axis === "y") {
              p.position.y = -1;
              p.velocity.set(2, -5, -3);
            } else {
              p.position.z = -1;
              p.velocity.set(2, -3, -5);
            }
            set.push(p);
          }
          // Above the plane: no-op branch must stay bit-identical too.
          const above = seededParticle(rng);
          if (axis === "x") above.position.x = 2;
          if (axis === "y") above.position.y = 2;
          if (axis === "z") above.position.z = 2;
          above.velocity.set(0, 1, 0);
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
        particles: (rng: () => number): Particle[] => {
          const set = Array.from({ length: 8 }, () => seededParticle(rng));
          set.push(new Particle({ position: new Vector3D(0.2, 0, 0), heat: 9.9 })); // inside zone + clamp
          set.push(new Particle({ position: new Vector3D(5, 5, 5), heat: 3 })); // far away, cooling only
          set.push(new Particle({ position: new Vector3D(0.05, 0, 0), heat: 0 })); // inside zone, blackbody
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
        particles: (rng: () => number): Particle[] =>
          Array.from({ length: 6 }, () => seededParticle(rng)),
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
        particles: (rng: () => number): Particle[] => {
          const set = Array.from({ length: 4 }, () => seededParticle(rng));
          set.push(new Particle({ position: new Vector3D(2, 0, 0), alpha: 1 })); // outside zone
          set.push(new Particle({ position: new Vector3D(0.75, 0, 0), alpha: 1 })); // mid fade
          set.push(new Particle({ position: new Vector3D(0.4, 0, 0), alpha: 1 })); // absorbed -> dead
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
        particles: (rng: () => number): Particle[] => {
          // beginFrame() must be the only time dependency; the shared instance keeps `_time` constant
          // across both evaluation paths inside runBatchBitIdentity.
          return Array.from({ length: 8 }, () => seededParticle(rng));
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
    // Force the legacy path on the second system by stripping applyBatch from every affector.
    for (const aff of legacySystem.affectors) {
      delete (aff as unknown as { applyBatch?: unknown }).applyBatch;
    }
    for (let frame = 0; frame < 60; frame++) {
      batchSystem.update(0.016);
      legacySystem.update(0.016);
      for (let i = 0; i < batchSystem.particles.length; i++) {
        expectStatesEqual(
          readState(batchSystem.particles[i]!),
          readState(legacySystem.particles[i]!),
        );
      }
    }
  });

  it("keeps working with third-party affectors that only implement apply (fallback path)", () => {
    const system = new ParticleSystem({ capacity: 4 });
    const fallback: ParticleAffector = {
      apply: (p: Particle, _dt: number, _index: number, _total: number): void => {
        p.acceleration.y += 9.81;
      },
    };
    expect(fallback.applyBatch).toBeUndefined();
    system.addAffector(fallback);
    const p = system.emit({ position: new Vector3D(0, 0, 0) })!;
    system.update(1.0);
    expect(p.dead).toBe(false);
    expect(p.velocity.y).toBeCloseTo(9.81);
  });

  it("update() reuses its internal arrays and particle instances (zero per-frame allocation)", () => {
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
    const particlesRef = system.particles;
    const slotRef = system.particles[10]!;
    const flagsRef = internal._frameFlags;
    const freeRef = internal._freeIndices;

    for (let frame = 0; frame < 5000; frame++) {
      system.update(1 / 60);
    }

    expect(system.particles).toBe(particlesRef);
    expect(system.particles[10]).toBe(slotRef);
    expect(system.particles.length).toBe(64);
    expect(internal._frameFlags).toBe(flagsRef);
    expect(internal._freeIndices).toBe(freeRef);
  });
});
