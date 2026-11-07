import { describe, expect, it } from "vitest";
import { Vector3D } from "@small-world-machine/engine";
import { mulberry32 } from "@small-world-machine/engine/utils/SeededRandom.js";
import { ParticleSystem } from "../src/ParticleSystem.js";
import { GravityAffector } from "../src/affectors/GravityAffector.js";
import {
  MAX_SDF_PRIMITIVES,
  SdfColliderAffector,
  evaluateSdfPrimitive,
  sdfSmoothMin,
  type SdfPrimitive,
} from "../src/affectors/SdfColliderAffector.js";

describe("SdfColliderAffector (T4 & T6)", () => {
  it("evaluates analytical distance for sphere, box, capsule, plane, and smooth-min accurately", () => {
    const sphere: SdfPrimitive = { type: "sphere", center: new Vector3D(0, 0, 0), radius: 2 };
    expect(evaluateSdfPrimitive(sphere, 0, 5, 0)).toBeCloseTo(3, 6);
    expect(evaluateSdfPrimitive(sphere, 0, 1, 0)).toBeCloseTo(-1, 6);

    const box: SdfPrimitive = {
      type: "box",
      center: new Vector3D(0, 0, 0),
      halfExtents: new Vector3D(1, 2, 3),
      roundRadius: 0.1,
    };
    expect(evaluateSdfPrimitive(box, 2, 0, 0)).toBeCloseTo(0.9, 6);
    expect(evaluateSdfPrimitive(box, 0, 0, 0)).toBeCloseTo(-1.1, 6);

    const capsule: SdfPrimitive = {
      type: "capsule",
      a: new Vector3D(0, -1, 0),
      b: new Vector3D(0, 1, 0),
      radius: 0.5,
    };
    expect(evaluateSdfPrimitive(capsule, 1.5, 0, 0)).toBeCloseTo(1.0, 6);
    expect(evaluateSdfPrimitive(capsule, 0, 2, 0)).toBeCloseTo(0.5, 6);

    const plane: SdfPrimitive = {
      type: "plane",
      normal: new Vector3D(0, 1, 0),
      offset: 0.5,
    };
    expect(evaluateSdfPrimitive(plane, 3, 2.5, -4)).toBeCloseTo(2.0, 6);

    // Smooth-min is strictly less than or equal to sharp min within blend radius
    expect(sdfSmoothMin(0.2, 0.2, 0.4)).toBeLessThan(0.2);
    expect(sdfSmoothMin(0.2, 5.0, 0.4)).toBeCloseTo(0.2, 6);
  });

  it("throws when primitives exceed MAX_SDF_PRIMITIVES (16)", () => {
    const prims: SdfPrimitive[] = Array.from({ length: MAX_SDF_PRIMITIVES + 1 }, () => ({
      type: "sphere",
      center: new Vector3D(),
      radius: 1,
    }));
    expect(() => new SdfColliderAffector({ primitives: prims })).toThrow(/MAX_SDF_PRIMITIVES/);
  });

  it("enforces SDF-NON-PENETRATION across a composite smooth-union obstacle under gravity", () => {
    const collider = new SdfColliderAffector({
      primitives: [
        { type: "plane", normal: new Vector3D(0, 1, 0), offset: 0 },
        { type: "sphere", center: new Vector3D(0, 0.8, 0), radius: 0.8 },
        {
          type: "box",
          center: new Vector3D(0.9, 0.5, 0),
          halfExtents: new Vector3D(0.4, 0.5, 0.4),
        },
        {
          type: "capsule",
          a: new Vector3D(-0.9, 0, 0),
          b: new Vector3D(-0.9, 1.2, 0),
          radius: 0.35,
        },
      ],
      smoothRadius: 0.15,
      restitution: 0.6,
      friction: 0.2,
      particleRadius: 0.05,
    });

    const gravity = new GravityAffector({ acceleration: new Vector3D(0, -9.81, 0) });
    const system = new ParticleSystem({ capacity: 150, affectors: [gravity, collider] });
    const rng = mulberry32(101);

    for (let i = 0; i < 150; i++) {
      system.emit({
        position: new Vector3D((rng() - 0.5) * 2.4, 1.8 + rng() * 1.2, (rng() - 0.5) * 1.2),
        velocity: new Vector3D((rng() - 0.5) * 2.0, -1.0 - rng() * 3.0, (rng() - 0.5) * 2.0),
        size: 0.1,
        maxLife: 10,
      });
    }

    const dt = 1 / 60;
    for (let step = 0; step < 60; step++) {
      system.update(dt);
      const pos = system.arrays.positions;
      const alive = system.arrays.aliveFlags;
      for (let i = 0; i < system.capacity; i++) {
        if (alive[i] === 0) continue;
        const d = collider.evaluate(pos[i * 3]!, pos[i * 3 + 1]!, pos[i * 3 + 2]!);
        expect(d).toBeGreaterThanOrEqual(collider.particleRadius - 1e-4);
      }
    }
  });

  it("never increases kinetic energy on bounce when restitution <= 1 and friction >= 0", () => {
    const collider = new SdfColliderAffector({
      primitives: [{ type: "sphere", center: new Vector3D(0, 0, 0), radius: 1.0 }],
      restitution: 0.75,
      friction: 0.25,
      particleRadius: 0.05,
    });

    const system = new ParticleSystem({ capacity: 1, affectors: [collider] });
    // Place particle slightly inside the outer shell (r = 1.02 < 1.0 + 0.05) moving inward + tangentially
    system.emit({
      position: new Vector3D(0, 1.02, 0),
      velocity: new Vector3D(3.0, -4.0, 0), // pre-impact speed = 5.0
      maxLife: 10,
    });

    const preSpeed = 5.0;
    collider.postIntegrate(system.arrays, 1, 1 / 60);

    const vx = system.arrays.velocities[0]!;
    const vy = system.arrays.velocities[1]!;
    const vz = system.arrays.velocities[2]!;
    const postSpeed = Math.hypot(vx, vy, vz);

    expect(vy).toBeGreaterThan(0); // reflected upward
    expect(postSpeed).toBeLessThanOrEqual(preSpeed + 1e-5);
    expect(vx).toBeCloseTo(3.0 * (1 - 0.25), 4);
    expect(vy).toBeCloseTo(4.0 * 0.75, 4);
  });
});
