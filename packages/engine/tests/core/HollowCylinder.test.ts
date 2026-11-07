import { describe, it, expect } from "vitest";
import { HollowCylinder } from "../../src/geometry/HollowCylinder.js";

describe("HollowCylinder Geometry", () => {
  it("should calculate exact mathematical properties (Volume, LateralArea, SurfaceArea, WallThickness)", () => {
    const r1 = 3; // outer radius
    const r2 = 1; // inner radius
    const h = 5; // height
    const cyl = new HollowCylinder({ radiusOuter: r1, radiusInner: r2, height: h });

    // Wall thickness b = r1 - r2 = 2
    expect(cyl.getWallThickness()).toBeCloseTo(2);

    // Volume V = PI * (r1^2 - r2^2) * h = PI * (9 - 1) * 5 = 40 * PI
    expect(cyl.getVolume()).toBeCloseTo(Math.PI * 40);

    // Lateral area M = 2 * PI * (r1 + r2) * h = 2 * PI * 4 * 5 = 40 * PI
    expect(cyl.getLateralArea()).toBeCloseTo(Math.PI * 40);

    // Total surface area A = 2 * PI * (r1 + r2) * (r1 - r2 + h) = 2 * PI * 4 * 7 = 56 * PI
    expect(cyl.getTotalSurfaceArea()).toBeCloseTo(Math.PI * 56);
  });

  it("should support wallThickness option to automatically compute innerRadius", () => {
    const cyl = new HollowCylinder({ radiusOuter: 2.5, wallThickness: 0.5, height: 4 });
    expect(cyl.radiusOuter).toBeCloseTo(2.5);
    expect(cyl.radiusInner).toBeCloseTo(2.0);
    expect(cyl.getWallThickness()).toBeCloseTo(0.5);
  });

  it("should generate proper geometry buffers with separated sharp normals for caps and walls", () => {
    const radialSegments = 16;
    const heightSegments = 2;
    const cyl = new HollowCylinder({
      radiusOuter: 2,
      radiusInner: 1,
      height: 4,
      radialSegments,
      heightSegments,
    });
    const data = cyl.getGeometryData();

    expect(data.vertices).toBeDefined();
    expect(data.indices).toBeDefined();
    expect(data.normals).toBeDefined();
    expect(data.uvs).toBeDefined();

    // Check vertex values are finite numbers
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

  it("should support partial sector angles and open-ended cylinders", () => {
    const halfCyl = new HollowCylinder({
      radiusOuter: 2,
      radiusInner: 1,
      height: 3,
      thetaStart: 0,
      thetaLength: Math.PI,
      openEnded: false,
    });

    expect(halfCyl.getVolume()).toBeCloseTo((Math.PI * (4 - 1) * 3) / 2);
    const data = halfCyl.getGeometryData();
    expect(data.vertices.length).toBeGreaterThan(0);
    expect(data.indices!.length).toBeGreaterThan(0);

    const openCyl = new HollowCylinder({
      radiusOuter: 2,
      radiusInner: 1,
      height: 3,
      openEnded: true,
    });
    expect(openCyl.getTotalSurfaceArea()).toBeCloseTo(openCyl.getLateralArea());
  });
});
