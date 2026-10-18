import { describe, it, expect } from "vitest";
import { ParticleSystem } from "../src/ParticleSystem.js";
import type { ParticleAffector } from "../src/ParticleAffector.js";
import { Vector3D } from "@small-world-machine/engine";

describe("ParticleSystem", () => {
  it("emits and updates particles with integration", () => {
    const ps = new ParticleSystem({ capacity: 10 });
    const index = ps.emit({
      position: new Vector3D(0, 0, 0),
      velocity: new Vector3D(10, 0, 0),
    });

    expect(index).toBe(0);
    expect(ps.activeCount).toBe(1);

    ps.update(0.1);

    expect(ps.arrays.positions[0]).toBeCloseTo(1.0);
    expect(ps.arrays.positions[1]).toBe(0);
    expect(ps.arrays.positions[2]).toBe(0);
  });

  it("handles life and dead particle recycling", () => {
    let diedCount = 0;
    const ps = new ParticleSystem({
      capacity: 2,
      onParticleDied: (): void => {
        diedCount++;
      },
    });

    const p1 = ps.emit({ maxLife: 0.5 });
    ps.emit({ maxLife: 10.0 });

    expect(ps.activeCount).toBe(2);

    ps.update(0.6); // p1 exceeds maxLife

    expect(ps.isAlive(p1)).toBe(false);
    expect(diedCount).toBe(1);

    // Emitting when at capacity should recycle dead particle p1
    const p3 = ps.emit({ maxLife: 5.0 });
    expect(p3).toBe(p1);
    expect(ps.isAlive(p3)).toBe(true);
  });

  it("adds, executes, and removes affectors", () => {
    const ps = new ParticleSystem();
    const index = ps.emit({ position: new Vector3D(0, 0, 0) });

    const dummyAffector: ParticleAffector = {
      apply: (arrays, particleIndex): void => {
        arrays.accelerations[particleIndex * 3 + 1]! += 9.81;
      },
    };

    ps.addAffector(dummyAffector);
    ps.update(1.0);

    expect(ps.arrays.velocities[index * 3 + 1]).toBeCloseTo(9.81);

    ps.removeAffector(dummyAffector);
    ps.arrays.velocities[index * 3 + 1] = 0;
    ps.update(1.0);

    expect(ps.arrays.velocities[index * 3 + 1]).toBe(0);
  });
});
