import { describe, it, expect } from "vitest";
import { AccretionDiskEmitter } from "../src/AccretionDiskEmitter.js";

describe("AccretionDiskEmitter", () => {
  it("initializes particles with Keplerian velocities and updates them", () => {
    const disk = new AccretionDiskEmitter({
      particleCount: 50,
      innerRadius: 1.0,
      outerRadius: 5.0,
      mass: 100,
    });

    expect(disk.system.activeCount).toBe(50);

    const arrays = disk.system.arrays;
    const velLen = Math.sqrt(
      arrays.velocities[0]! * arrays.velocities[0]! +
        arrays.velocities[1]! * arrays.velocities[1]! +
        arrays.velocities[2]! * arrays.velocities[2]!,
    );
    expect(velLen).toBeGreaterThan(0);
    expect(arrays.colors).toBeDefined();

    // Step simulation for 5 frames
    for (let i = 0; i < 5; i++) {
      disk.update(0.016);
    }

    const posLen = Math.sqrt(
      arrays.positions[0]! * arrays.positions[0]! +
        arrays.positions[1]! * arrays.positions[1]! +
        arrays.positions[2]! * arrays.positions[2]!,
    );
    expect(posLen).toBeGreaterThan(0);
  });

  it("respawns absorbed particles cleanly at outer radius", () => {
    const disk = new AccretionDiskEmitter({
      particleCount: 10,
      innerRadius: 1.0,
      outerRadius: 4.0,
      eventHorizonRadius: 0.5,
    });

    const arrays = disk.system.arrays;
    // Place particle inside event horizon
    arrays.positions[0] = 0.1;
    arrays.positions[1] = 0;
    arrays.positions[2] = 0;

    disk.update(0.016);

    // Particle should have been swallowed and respawned near outerRadius (4.0)
    expect(disk.system.isAlive(0)).toBe(true);
    const posLen = Math.sqrt(
      arrays.positions[0]! * arrays.positions[0]! +
        arrays.positions[1]! * arrays.positions[1]! +
        arrays.positions[2]! * arrays.positions[2]!,
    );
    expect(posLen).toBeCloseTo(4.0, 1);
  });
});
