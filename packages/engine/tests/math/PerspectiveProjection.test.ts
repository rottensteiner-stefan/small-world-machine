import { describe, expect, it } from "vitest";
import { PerspectiveProjection } from "../../src/index.js";

describe("PerspectiveProjection Integrity", () => {
  it("should create a mathematically correct projection matrix for 90 degree FOV (radians)", () => {
    // 90 degrees in radians is Math.PI / 2
    const proj = new PerspectiveProjection({
      fov: Math.PI / 2,
      aspect: 1.0,
      near: 0.1,
      far: 1000.0,
    });

    const m = proj.getMatrix().data;

    // The scale factor for x and y in a projection matrix is: f = 1.0 / tan(fov / 2)
    // For fov = Math.PI / 2 (90 degrees), fov / 2 = Math.PI / 4 (45 degrees).
    // tan(45 degrees) = 1.0, so the scale factors should be exactly 1.0.
    // m[0] is X-scale, m[5] is Y-scale in column-major format.
    expect(m[0]).toBeCloseTo(1.0);
    expect(m[5]).toBeCloseTo(1.0);
  });

  it("should drastically distort the matrix if degrees are accidentally passed instead of radians", () => {
    // If someone passes 90 instead of Math.PI / 2, assuming degrees,
    // the FOV becomes 90 radians!
    const proj = new PerspectiveProjection({
      fov: 90,
      aspect: 1.0,
      near: 0.1,
      far: 1000.0,
    });

    const m = proj.getMatrix().data;

    // 1 / tan(90 / 2) = 1 / tan(45 radians) = 1 / 1.6197 = 0.617...
    // The scale factor should NOT be 1.0.
    expect(m[0]).not.toBeCloseTo(1.0);
    expect(m[5]).not.toBeCloseTo(1.0);
  });
});
