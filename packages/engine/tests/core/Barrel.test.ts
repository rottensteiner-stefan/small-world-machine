import { describe, it, expect } from "vitest";
import { Barrel } from "../../src/geometry/Barrel.js";

describe("Barrel Geometry (Fass)", () => {
  it("should calculate exact mathematical properties according to Kepler's barrel formula", () => {
    const R = 2; // middle radius (belly)
    const r = 1; // end radius (top and bottom)
    const h = 6; // height

    const barrel = new Barrel({ radiusMiddle: R, radiusEnds: r, height: h });

    // Kepler's barrel volume formula: V = (PI * h / 3) * (2 * R^2 + r^2)
    // V = (PI * 6 / 3) * (2 * 4 + 1) = 2 * PI * 9 = 18 * PI
    const expectedVolume = 18 * Math.PI;
    expect(barrel.getVolume()).toBeCloseTo(expectedVolume);

    // Space diagonal d = sqrt(h^2 + (2r)^2) = sqrt(36 + 4) = sqrt(40) ≈ 6.324555
    const expectedDiagonal = Math.sqrt(h ** 2 + 4 * r ** 2);
    expect(barrel.getDiagonal()).toBeCloseTo(expectedDiagonal);

    // Profile radius check at equator (y = 0) -> R = 2
    expect(barrel.getRadiusAt(0)).toBeCloseTo(2);
    // Profile radius check at top (y = 3) -> r = 1
    expect(barrel.getRadiusAt(3)).toBeCloseTo(1);
    // Profile radius check at bottom (y = -3) -> r = 1
    expect(barrel.getRadiusAt(-3)).toBeCloseTo(1);
    // Profile radius check at mid-height (y = 1.5, t = 0.5) -> R - (R - r) * 0.25 = 2 - 0.25 = 1.75
    expect(barrel.getRadiusAt(1.5)).toBeCloseTo(1.75);
  });

  it("should support asymmetric top and bottom radii", () => {
    const barrel = new Barrel({
      radiusMiddle: 2.0,
      radiusTop: 1.5,
      radiusBottom: 1.0,
      height: 4,
    });

    expect(barrel.getRadiusAt(2)).toBeCloseTo(1.5);
    expect(barrel.getRadiusAt(-2)).toBeCloseTo(1.0);
    expect(barrel.getRadiusAt(0)).toBeCloseTo(2.0);
    expect(barrel.radiusEnds).toBeCloseTo(1.25);
  });

  it("should generate valid geometry buffers and unit normals", () => {
    const radialSegments = 16;
    const heightSegments = 8;
    const barrel = new Barrel({
      radiusMiddle: 1.5,
      radiusEnds: 1.0,
      height: 3,
      radialSegments,
      heightSegments,
    });

    const data = barrel.getGeometryData();
    expect(data.vertices).toBeDefined();
    expect(data.indices).toBeDefined();
    expect(data.normals).toBeDefined();
    expect(data.uvs).toBeDefined();

    // Check all vertex components are finite numbers
    for (let i = 0; i < data.vertices.length; i++) {
      expect(Number.isFinite(data.vertices[i])).toBe(true);
      expect(Number.isNaN(data.vertices[i])).toBe(false);
    }

    // Check all normal vectors have unit length (magnitude ≈ 1.0)
    for (let i = 0; i < data.normals!.length; i += 3) {
      const nx = data.normals![i]!;
      const ny = data.normals![i + 1]!;
      const nz = data.normals![i + 2]!;
      const len = Math.hypot(nx, ny, nz);
      expect(len).toBeCloseTo(1.0, 3);
    }
  });

  it("should support partial sector barrel shapes and open-ended barrels", () => {
    const halfBarrel = new Barrel({
      radiusMiddle: 2.0,
      radiusEnds: 1.0,
      height: 4,
      thetaStart: 0,
      thetaLength: Math.PI,
      openEnded: false,
    });

    const fullVolume = new Barrel({ radiusMiddle: 2.0, radiusEnds: 1.0, height: 4 }).getVolume();
    expect(halfBarrel.getVolume()).toBeCloseTo(fullVolume / 2);

    const data = halfBarrel.getGeometryData();
    expect(data.vertices.length).toBeGreaterThan(0);
    expect(data.indices!.length).toBeGreaterThan(0);

    const openBarrel = new Barrel({
      radiusMiddle: 2.0,
      radiusEnds: 1.0,
      height: 4,
      openEnded: true,
    });
    const openData = openBarrel.getGeometryData();
    // Open barrel should have fewer vertices than closed barrel (no cap vertices)
    expect(openData.vertices.length).toBeLessThan(data.vertices.length);
  });
});
