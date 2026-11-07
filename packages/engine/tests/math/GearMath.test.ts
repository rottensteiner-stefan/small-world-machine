import { describe, it, expect } from "vitest";
import { GearMath, Vector3D } from "../../src/math/index.js";

describe("GearMath", () => {
  it("calculates correct pitch radius and center distance", () => {
    const gear1 = GearMath.getGearParams(2, 20);
    const gear2 = GearMath.getGearParams(2, 40);

    expect(gear1.pitchRadius).toBe(20);
    expect(gear2.pitchRadius).toBe(40);
    expect(GearMath.getCenterDistance(2, 20, 40)).toBe(60);
  });

  it("calculates correct driven speed and directional signs", () => {
    // External gears counter-rotate
    expect(GearMath.getDrivenSpeed(10, 20, 40, false)).toBe(-5);
    // Internal gears rotate in the same direction
    expect(GearMath.getDrivenSpeed(10, 20, 40, true)).toBe(5);
  });

  it("produces correct counter-rotational ratio in getMeshingRotation", () => {
    const pos1 = new Vector3D(0, 0, 0);
    const pos2 = new Vector3D(60, 0, 0); // Along X-axis
    const gear1 = GearMath.getGearParams(2, 20);
    const gear2 = GearMath.getGearParams(2, 40); // 1:2 ratio

    const rot1_a = 0;
    const rot2_a = GearMath.getMeshingRotation(pos1, rot1_a, gear1, pos2, gear2);

    // Rotate gear 1 by +0.5 rad (CCW)
    const rot1_b = 0.5;
    const rot2_b = GearMath.getMeshingRotation(pos1, rot1_b, gear1, pos2, gear2);

    // Delta of gear 2 must be NEGATIVE (CW) and exactly half (teeth1 / teeth2 = 20/40 = 0.5)
    const delta2 = rot2_b - rot2_a;
    expect(delta2).toBeCloseTo(-0.25);
  });
});
