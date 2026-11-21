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

  it("reuses freed slots immediately before growing high-water _size", () => {
    const ps = new ParticleSystem({ capacity: 10 });
    const p0 = ps.emit({ maxLife: 0.5 });
    ps.emit({ maxLife: 10.0 });
    expect(ps.activeCount).toBe(2);

    ps.update(0.6); // p0 dies and enters free list
    expect(ps.isAlive(p0)).toBe(false);

    const reused = ps.emit({ maxLife: 5.0 });
    expect(reused).toBe(p0);
    expect(ps.activeCount).toBe(2);
  });

  it("supports re-entrant emit() from onParticleDied at full capacity without breaking in-place respawn", () => {
    let emittedInCallback = -1;
    const psFull = new ParticleSystem({
      capacity: 1,
      onParticleDied: (): void => {
        emittedInCallback = psFull.emit({ maxLife: 5.0 });
      },
    });
    const first = psFull.emit({ maxLife: 0.2 });
    psFull.update(0.5);
    expect(emittedInCallback).toBe(first);
    expect(psFull.isAlive(first)).toBe(true);
    // Slot must not be double-pushed to free list: another emit at full capacity returns -1.
    expect(psFull.emit({ maxLife: 1.0 })).toBe(-1);

    // In-place respawn (like AccretionDisk) must keep its resurrected slot untouched.
    let extraEmitResult = 0;
    const psInPlace = new ParticleSystem({
      capacity: 1,
      onParticleDied: (idx): void => {
        psInPlace.arrays.aliveFlags[idx] = 1;
        psInPlace.arrays.lives[idx] = 0;
        psInPlace.arrays.maxLives[idx] = 10;
        extraEmitResult = psInPlace.emit({ maxLife: 1.0 });
      },
    });
    const slot = psInPlace.emit({ maxLife: 0.2 });
    psInPlace.update(0.5);
    expect(extraEmitResult).toBe(-1);
    expect(psInPlace.isAlive(slot)).toBe(true);
    expect(psInPlace.arrays.maxLives[slot]).toBe(10);
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
