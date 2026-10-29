import { describe, it, expect } from "vitest";
import type { ParticleArrays } from "../src/Particle.js";
import { SizeGrowthAffector } from "../src/affectors/SizeGrowthAffector.js";

const DT = 1 / 60;

function arraysWithSizes(...sizes: number[]): ParticleArrays {
  return {
    positions: new Float32Array(sizes.length * 3),
    velocities: new Float32Array(sizes.length * 3),
    accelerations: new Float32Array(sizes.length * 3),
    colors: new Float32Array(sizes.length * 4),
    sizes: Float32Array.from(sizes),
    alphas: new Float32Array(sizes.length),
    masses: new Float32Array(sizes.length),
    lives: new Float32Array(sizes.length),
    maxLives: new Float32Array(sizes.length),
    heats: new Float32Array(sizes.length),
    aliveFlags: new Uint8Array([...sizes].fill(1)),
  };
}

describe("SizeGrowthAffector", () => {
  it("grows a size multiplicatively over time", () => {
    const arrays = arraysWithSizes(1);
    const affector = new SizeGrowthAffector({ rate: 1 });
    affector.apply(arrays, 0, 1);
    expect(arrays.sizes[0]).toBeCloseTo(2); // ×2 after one second at rate 1
  });

  it("preserves the ratio between particles (base variety survives growth)", () => {
    const arrays = arraysWithSizes(0.2, 0.5);
    const affector = new SizeGrowthAffector({ rate: 0.6 });
    for (let i = 0; i < 60; i++) affector.apply(arrays, 0, DT);
    for (let i = 0; i < 60; i++) affector.apply(arrays, 1, DT);
    // Multiplicative growth keeps small and large embers proportionally apart.
    expect(arrays.sizes[1]! / arrays.sizes[0]!).toBeCloseTo(0.5 / 0.2, 6);
  });

  it("clamps at the configured maximum", () => {
    const arrays = arraysWithSizes(1);
    const affector = new SizeGrowthAffector({ rate: 2, maxScale: 3 });
    for (let i = 0; i < 300; i++) affector.apply(arrays, 0, DT);
    expect(arrays.sizes[0]).toBe(3);
  });

  it("does nothing at rate 0 or dt 0", () => {
    const arrays = arraysWithSizes(1);
    new SizeGrowthAffector({ rate: 0 }).apply(arrays, 0, 1);
    expect(arrays.sizes[0]).toBe(1);
    new SizeGrowthAffector({ rate: 1 }).apply(arrays, 0, 0);
    expect(arrays.sizes[0]).toBe(1);
  });
});
