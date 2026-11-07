import { describe, expect, it } from "vitest";
import { Vector3D } from "@small-world-machine/engine";
import type { ParticleArrays } from "../src/Particle.js";
import type { ParticleAffector } from "../src/ParticleAffector.js";
import { ParticleSystem } from "../src/ParticleSystem.js";
import { readState } from "./helpers/soa.js";
describe("ParticleSystem postIntegrate hook", () => {
  it("runs after the integration pass so corrected state is final for the frame", () => {
    let corrected = -1;
    const snapping: ParticleAffector = {
      apply: (_arrays: ParticleArrays, _index: number, _dt: number): void => {
        // no-op: purely a position-correcting post-integration force
      },
      postIntegrate: (arrays: ParticleArrays, count: number, _dt: number): void => {
        for (let i = 0; i < count; i++) {
          if (arrays.aliveFlags[i] === 0) {
            continue;
          }
          arrays.positions[i * 3 + 1] = 0; // snap to floor after integration
          corrected = i;
        }
      },
    };

    const system = new ParticleSystem({ capacity: 2 });
    system.addAffector(snapping);
    system.emit({ position: new Vector3D(0, 5, 0), velocity: new Vector3D(0, -2, 0) });
    system.update(1);

    // Velocity integration moved y to 3; postIntegrate then snapped it to the floor (0).
    const s = readState(system.arrays, 0);
    expect(s.pos[1]).toBe(0);
    expect(s.vel[1]).toBeCloseTo(-2, 6);
    expect(corrected).toBe(0);
    expect(system.isAlive(0)).toBe(true);
  });

  it("skips dead slots in postIntegrate", () => {
    const touches: number[] = [];
    const affector: ParticleAffector = {
      apply: (): void => {},
      postIntegrate: (arrays: ParticleArrays, count: number, _dt: number): void => {
        for (let i = 0; i < count; i++) {
          if (arrays.aliveFlags[i] === 0) {
            continue;
          }
          touches.push(i);
          arrays.positions[i * 3] = -1;
        }
      },
    };
    const system = new ParticleSystem({ capacity: 2 });
    system.addAffector(affector);
    system.emit({ maxLife: 0 }); // alive at emit, dies on first update
    system.emit({});
    system.update(0.016);
    // First slot died this frame (reported + pushed to free list), only slot 1 is corrected.
    expect(touches).toEqual([1]);
    const s0 = readState(system.arrays, 0);
    expect(s0.pos[0]).not.toBe(-1);
    const s1 = readState(system.arrays, 1);
    expect(s1.pos[0]).toBe(-1);
  });

  it("leaves update() unchanged when no affector implements postIntegrate", () => {
    const system = new ParticleSystem({ capacity: 2 });
    system.emit({ position: new Vector3D(1, 2, 3), velocity: new Vector3D(0, 1, 0) });
    system.update(0.5);
    const s = readState(system.arrays, 0);
    expect(s.pos).toEqual([1, 2.5, 3]);
    expect(s.vel[1]).toBeCloseTo(1, 6);
  });
});
