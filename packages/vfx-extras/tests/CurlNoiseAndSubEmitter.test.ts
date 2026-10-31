import { describe, expect, it } from "vitest";
import { Vector3D } from "@small-world-machine/engine";
import { mulberry32 } from "@small-world-machine/engine/utils/SeededRandom.js";
import { ParticleSystem } from "../src/ParticleSystem.js";
import { CurlNoiseAffector } from "../src/affectors/CurlNoiseAffector.js";
import { SdfColliderAffector } from "../src/affectors/SdfColliderAffector.js";
import { SubEmitter } from "../src/spawners/SubEmitter.js";

describe("CurlNoiseAffector (T5 & T6 — CURL-DIVERGENCE-FREE)", () => {
  it("produces a divergence-free velocity field (div(v) ≈ 0) both in free space and inside an SDF obstacle ramp", () => {
    const collider = new SdfColliderAffector({
      primitives: [{ type: "sphere", center: new Vector3D(0, 0, 0), radius: 1.0 }],
    });
    const curl = new CurlNoiseAffector({
      frequency: 1.2,
      strength: 3.0,
      scrollSpeed: 0.4,
      seed: 99,
      collider,
      rampWidth: 0.6,
    });
    curl.beginFrame(0.5);

    const rng = mulberry32(777);
    const h = 1e-4;
    const fPlus = new Float64Array(3);
    const fMinus = new Float64Array(3);

    for (let i = 0; i < 80; i++) {
      // Sample radii spanning inside the ramp (1.05..1.55) and free stream (1.6..3.0)
      const r = 1.05 + rng() * 2.0;
      const theta = rng() * Math.PI * 2;
      const z = rng() * 2 - 1;
      const s = Math.sqrt(Math.max(0, 1 - z * z));
      const px = r * s * Math.cos(theta);
      const py = r * z;
      const pz = r * s * Math.sin(theta);

      curl.sampleFieldInto(px + h, py, pz, fPlus);
      curl.sampleFieldInto(px - h, py, pz, fMinus);
      const dvx_dx = (fPlus[0]! - fMinus[0]!) / (2 * h);

      curl.sampleFieldInto(px, py + h, pz, fPlus);
      curl.sampleFieldInto(px, py - h, pz, fMinus);
      const dvy_dy = (fPlus[1]! - fMinus[1]!) / (2 * h);

      curl.sampleFieldInto(px, py, pz + h, fPlus);
      curl.sampleFieldInto(px, py, pz - h, fMinus);
      const dvz_dz = (fPlus[2]! - fMinus[2]!) / (2 * h);

      const divergence = dvx_dx + dvy_dy + dvz_dz;
      expect(Math.abs(divergence)).toBeLessThan(1e-3);
    }

    // At or inside the obstacle surface (phi <= 0), the ramped curl field vanishes completely
    curl.sampleFieldInto(0, 1.0, 0, fPlus);
    expect(fPlus[0]).toBe(0);
    expect(fPlus[1]).toBe(0);
    expect(fPlus[2]).toBe(0);
  });

  it("matches apply and applyBatch bit-for-bit", () => {
    const makeSys = (): ParticleSystem => {
      const s = new ParticleSystem({ capacity: 6 });
      for (let i = 0; i < 6; i++) {
        s.emit({ position: new Vector3D(i * 0.4 + 0.1, i * -0.25, i * 0.3) });
      }
      return s;
    };

    const sysA = makeSys();
    const sysB = makeSys();
    const curlA = new CurlNoiseAffector({ seed: 42, frequency: 1.5, strength: 2.5 });
    const curlB = new CurlNoiseAffector({ seed: 42, frequency: 1.5, strength: 2.5 });

    curlA.beginFrame(0.1);
    curlB.beginFrame(0.1);

    for (let i = 0; i < 6; i++) {
      curlA.apply(sysA.arrays, i, 0.016);
    }
    curlB.applyBatch(sysB.arrays, 6, 0.016);

    expect(Array.from(sysA.arrays.accelerations)).toEqual(Array.from(sysB.arrays.accelerations));
  });
});

describe("SubEmitter (T5 & T6 — Zero-Allocation Death & Collision Bursts)", () => {
  it("spawns secondary bursts on parent particle death and preserves dying position even when parent slot is reused", () => {
    const primary = new ParticleSystem({ capacity: 1 });
    const secondary = new ParticleSystem({ capacity: 16 });
    const sub = new SubEmitter({
      source: primary,
      target: secondary,
      trigger: "death",
      burstCount: 4,
      speedRange: [2, 2],
      lifeRange: [1, 1],
      seed: 123,
    });

    // Emit 1 parent particle that expires after 1 tick (dt = 0.1 >= maxLife = 0.05)
    primary.emit({
      position: new Vector3D(10, 20, 30),
      velocity: new Vector3D(0, 5, 0),
      life: 0,
      maxLife: 0.05,
    });

    primary.update(0.1);
    expect(primary.isAlive(0)).toBe(false);
    expect(sub.queuedEventCount).toBe(1);

    // Immediately reuse slot 0 in primary BEFORE flushing sub-emitter!
    const reusedSlot = primary.emit({
      position: new Vector3D(-99, -99, -99),
      velocity: new Vector3D(0, -1, 0),
      life: 0,
      maxLife: 10,
    });
    expect(reusedSlot).toBe(0);

    const spawned = sub.flush();
    expect(spawned).toBe(4);
    expect(secondary.activeCount).toBe(4);
    expect(sub.queuedEventCount).toBe(0);

    // Every child particle must spawn at the dying parent's integrated position (10, 20.5, 30), NOT (-99, -99, -99)
    for (let i = 0; i < 4; i++) {
      expect(secondary.arrays.positions[i * 3]).toBeCloseTo(10, 4);
      expect(secondary.arrays.positions[i * 3 + 1]).toBeCloseTo(20.5, 4);
      expect(secondary.arrays.positions[i * 3 + 2]).toBeCloseTo(30, 4);
    }
  });

  it("spawns secondary splash bursts on SDF collision and allocates zero TypedArrays during steady-state flush", () => {
    const collider = new SdfColliderAffector({
      primitives: [{ type: "plane", normal: new Vector3D(0, 1, 0), offset: 0 }],
      restitution: 0.5,
    });
    const primary = new ParticleSystem({ capacity: 8, affectors: [collider] });
    const secondary = new ParticleSystem({ capacity: 64 });
    const sub = new SubEmitter({
      source: primary,
      target: secondary,
      trigger: "collision",
      collider,
      burstCount: 3,
      coneHalfAngle: 0.4,
      minImpactSpeed: 1.0,
      seed: 456,
    });

    // High-speed impact (vy = -5 -> impactSpeed = 5 >= 1.0)
    primary.emit({
      position: new Vector3D(2, 0.02, -3),
      velocity: new Vector3D(0, -5, 0),
      maxLife: 10,
    });
    // Low-speed grazing contact (vy = -0.1 -> impactSpeed = 0.1 < 1.0, ignored)
    primary.emit({
      position: new Vector3D(-4, 0.001, 1),
      velocity: new Vector3D(0, -0.1, 0),
      maxLife: 10,
    });

    const origF32 = globalThis.Float32Array;
    let f32Allocs = 0;
    globalThis.Float32Array = new Proxy(origF32, {
      construct(target, args, newTarget): Float32Array {
        f32Allocs++;
        return Reflect.construct(target, args, newTarget) as Float32Array;
      },
    });

    let spawned: number;
    try {
      primary.update(0.01);
      expect(sub.queuedEventCount).toBe(1);
      spawned = sub.flush();
    } finally {
      globalThis.Float32Array = origF32;
    }

    expect(f32Allocs).toBe(0);
    expect(spawned).toBe(3);
    expect(secondary.activeCount).toBe(3);
    for (let i = 0; i < 3; i++) {
      // Child velocity points upward along the plane normal (+Y)
      expect(secondary.arrays.velocities[i * 3 + 1]!).toBeGreaterThan(0);
    }
  });
});
