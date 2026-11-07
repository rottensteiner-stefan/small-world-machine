import { describe, it, expect } from "vitest";
import {
  OpenFrame,
  LShape,
  Rhombus,
  TriStar,
  CylindricalArch,
  HollowTruncatedCone,
  Cone,
  Capsule,
} from "../../src/geometry/index.js";

describe("New Rechneronline Geometries & Mathematical Formulas", () => {
  describe("OpenFrame (Offener Rahmen)", () => {
    it("should compute exact 2D geometric properties", () => {
      const frame2D = new OpenFrame({ width: 6, height: 5, thickness: 1 });
      // b = a - 2c = 6 - 2 = 4
      expect(frame2D.getInnerWidth()).toBe(4);
      // i = h - c = 5 - 1 = 4
      expect(frame2D.getInnerHeight()).toBe(4);
      // u = 2a + 4h - 4c = 2*6 + 4*5 - 4*1 = 12 + 20 - 4 = 28
      expect(frame2D.getPerimeter()).toBe(28);
      // A = c(2h + a - 2c) = 1*(10 + 6 - 2) = 14
      expect(frame2D.getArea()).toBe(14);
      expect(frame2D.getVolume()).toBe(0);
      expect(frame2D.getTotalSurfaceArea()).toBe(14);

      const data = frame2D.getGeometryData();
      expect(data.vertices.length).toBeGreaterThan(0);
      expect(data.normals!.length).toBe(data.vertices.length);
      expect(data.uvs!.length).toBe((data.vertices.length / 3) * 2);
      expect(data.indices!.length).toBe(18); // 3 quads * 6 indices
    });

    it("should compute exact 3D extruded properties", () => {
      const frame3D = new OpenFrame({ width: 6, height: 5, thickness: 1, depth: 2 });
      expect(frame3D.getVolume()).toBe(14 * 2); // 28
      // Total area = 2 * A + u * depth = 2 * 14 + 28 * 2 = 28 + 56 = 84
      expect(frame3D.getTotalSurfaceArea()).toBe(84);

      const data = frame3D.getGeometryData();
      expect(data.vertices.length).toBeGreaterThan(0);
      expect(data.normals!.length).toBe(data.vertices.length);
    });
  });

  describe("LShape (L-Form)", () => {
    it("should compute exact 2D geometric properties", () => {
      const lshape2D = new LShape({ width: 5, height: 4, thickness: 1 });
      // a' = a - c = 4
      expect(lshape2D.getInnerWidth()).toBe(4);
      // b' = b - c = 3
      expect(lshape2D.getInnerHeight()).toBe(3);
      // u = 2(a + b) = 2(5 + 4) = 18
      expect(lshape2D.getPerimeter()).toBe(18);
      // A = c(a + b - c) = 1*(5 + 4 - 1) = 8
      expect(lshape2D.getArea()).toBe(8);
      expect(lshape2D.getVolume()).toBe(0);
      expect(lshape2D.getTotalSurfaceArea()).toBe(8);

      const data = lshape2D.getGeometryData();
      expect(data.vertices.length).toBeGreaterThan(0);
      expect(data.indices!.length).toBe(12); // 2 quads * 6 indices
    });

    it("should compute exact 3D extruded properties", () => {
      const lshape3D = new LShape({ width: 5, height: 4, thickness: 1, depth: 3 });
      expect(lshape3D.getVolume()).toBe(8 * 3); // 24
      // Total area = 2 * 8 + 18 * 3 = 16 + 54 = 70
      expect(lshape3D.getTotalSurfaceArea()).toBe(70);
    });
  });

  describe("Rhombus (Raute)", () => {
    it("should compute exact formulas from side and angle", () => {
      // Side 4, angle 60 deg (PI / 3)
      const rhombus = new Rhombus({ side: 4, angle: Math.PI / 3 });
      // e = 2a cos(30) = 8 * sqrt(3)/2 = 4*sqrt(3) ~ 6.9282
      expect(rhombus.diagonalA).toBeCloseTo(4 * Math.sqrt(3), 5);
      // f = 2a sin(30) = 8 * 0.5 = 4
      expect(rhombus.diagonalB).toBeCloseTo(4, 5);
      // u = 4a = 16
      expect(rhombus.getPerimeter()).toBe(16);
      // A = a^2 * sin(60) = 16 * sqrt(3)/2 = 8*sqrt(3) ~ 13.8564
      expect(rhombus.getArea()).toBeCloseTo(8 * Math.sqrt(3), 5);
      // h = a * sin(60) = 4 * sqrt(3)/2 = 2*sqrt(3)
      expect(rhombus.getHeight()).toBeCloseTo(2 * Math.sqrt(3), 5);
      // r_i = h / 2 = sqrt(3)
      expect(rhombus.getIncircleRadius()).toBeCloseTo(Math.sqrt(3), 5);

      const data = rhombus.getGeometryData();
      expect(data.vertices.length).toBe(12); // 4 vertices * 3
      expect(data.indices!.length).toBe(6); // 2 triangles
    });

    it("should compute exact formulas when diagonals are explicitly given", () => {
      const rhombus = new Rhombus({ diagonalA: 6, diagonalB: 8, depth: 2 });
      // side = sqrt(3^2 + 4^2) = 5
      expect(rhombus.side).toBeCloseTo(5, 5);
      expect(rhombus.getPerimeter()).toBe(20);
      // A = e * f / 2 = 6 * 8 / 2 = 24
      expect(rhombus.getArea()).toBe(24);
      expect(rhombus.getVolume()).toBe(48);
      // Total area = 2 * 24 + 20 * 2 = 88
      expect(rhombus.getTotalSurfaceArea()).toBe(88);
    });
  });

  describe("TriStar (Dreistern)", () => {
    it("should compute exact 2D star formulas", () => {
      const star = new TriStar({ armLength: 2, innerAngle: Math.PI / 3 }); // 60 deg
      // beta = 120 + 60 = 180 deg (PI)
      expect(star.getOuterAngle()).toBeCloseTo(Math.PI, 5);
      // b = 2a sin(30) = 2*2*0.5 = 2
      expect(star.getBaseLength()).toBeCloseTo(2, 5);
      // i = a cos(30) = 2 * sqrt(3)/2 = sqrt(3)
      expect(star.getArmHeight()).toBeCloseTo(Math.sqrt(3), 5);
      // u = 6a = 12
      expect(star.getPerimeter()).toBe(12);
      // For alpha = 60, star is an equilateral triangle of side 2a = 4!
      // Area = sqrt(3)/4 * 4^2 = 4*sqrt(3) ~ 6.9282
      expect(star.getArea()).toBeCloseTo(4 * Math.sqrt(3), 5);

      const data = star.getGeometryData();
      expect(data.vertices.length).toBe(21); // (1 center + 6 boundary) * 3
      expect(data.indices!.length).toBe(18); // 6 triangles
    });

    it("should compute 3D extruded star volume and surface", () => {
      const star3D = new TriStar({ armLength: 2, innerAngle: Math.PI / 6, depth: 3 });
      expect(star3D.getVolume()).toBeCloseTo(star3D.getArea() * 3, 5);
      expect(star3D.getTotalSurfaceArea()).toBeCloseTo(
        2 * star3D.getArea() + star3D.getPerimeter() * 3,
        5,
      );
    });
  });

  describe("CylindricalArch (Zylinderbogen)", () => {
    it("should compute exact 90-degree cylindrical arch formulas", () => {
      const arch = new CylindricalArch({ pipeRadius: 1, bendRadius: 2, arcAngle: Math.PI / 2 });
      // R = a + r = 2 + 1 = 3
      expect(arch.getMajorRadius()).toBe(3);
      // Mantle M = pi^2 * (a + r) * r = pi^2 * 3 * 1 = 3 * pi^2 ~ 29.6088
      expect(arch.getMantleArea()).toBeCloseTo(3 * Math.PI * Math.PI, 4);
      // Each cap = pi * r^2 = pi
      expect(arch.getCapArea()).toBeCloseTo(Math.PI, 5);
      // Total area = M + 2 * pi = 3 * pi^2 + 2 * pi
      expect(arch.getTotalSurfaceArea()).toBeCloseTo(3 * Math.PI * Math.PI + 2 * Math.PI, 4);
      // Volume = 0.5 * pi^2 * (a + r) * r^2 = 1.5 * pi^2
      expect(arch.getVolume()).toBeCloseTo(1.5 * Math.PI * Math.PI, 4);

      const data = arch.getGeometryData();
      expect(data.vertices.length).toBeGreaterThan(0);
      expect(data.normals!.length).toBe(data.vertices.length);
      expect(data.indices!.length).toBeGreaterThan(0);
    });
  });

  describe("Cone (Kegel)", () => {
    it("should compute exact analytical cone properties", () => {
      const cone = new Cone({ radius: 3, height: 4 });
      // Slant height m = sqrt(3^2 + 4^2) = 5
      expect(cone.getSlantHeight()).toBe(5);
      // Lateral area M = pi * r * m = 15 * pi
      expect(cone.getLateralArea()).toBeCloseTo(15 * Math.PI, 5);
      // Base area = pi * r^2 = 9 * pi
      expect(cone.getBaseArea()).toBeCloseTo(9 * Math.PI, 5);
      // Total surface area = 15*pi + 9*pi = 24*pi
      expect(cone.getTotalSurfaceArea()).toBeCloseTo(24 * Math.PI, 5);
      // Volume = 1/3 * pi * r^2 * h = 1/3 * pi * 9 * 4 = 12 * pi
      expect(cone.getVolume()).toBeCloseTo(12 * Math.PI, 5);
      // Apex angle = 2 * asin(3 / 5) ~ 1.2870 rad (~73.74 deg)
      expect(cone.getApexAngle()).toBeCloseTo(2 * Math.asin(3 / 5), 5);
      // Base angle = atan(4 / 3) ~ 0.9273 rad (~53.13 deg)
      expect(cone.getBaseAngle()).toBeCloseTo(Math.atan2(4, 3), 5);
      // A / V = 24*pi / (12*pi) = 2.0
      expect(cone.getSurfaceToVolumeRatio()).toBeCloseTo(2.0, 5);
    });
  });

  describe("HollowTruncatedCone (Hohlkegelstumpf)", () => {
    it("should compute exact conical frustum reducer formulas", () => {
      // R = 4, r = 2, S = 3, s = 1, h = 4
      const htc = new HollowTruncatedCone({
        outerRadiusBottom: 4,
        outerRadiusTop: 2,
        innerRadiusBottom: 3,
        innerRadiusTop: 1,
        height: 4,
      });

      // Outer slant: sqrt((4-2)^2 + 4^2) = sqrt(20)
      expect(htc.getOuterSlantHeight()).toBeCloseTo(Math.sqrt(20), 5);
      // Inner slant: sqrt((3-1)^2 + 4^2) = sqrt(20)
      expect(htc.getInnerSlantHeight()).toBeCloseTo(Math.sqrt(20), 5);
      // Outer lateral: pi * (4 + 2) * sqrt(20) = 6*pi*sqrt(20)
      expect(htc.getOuterLateralArea()).toBeCloseTo(6 * Math.PI * Math.sqrt(20), 4);
      // Inner lateral: pi * (3 + 1) * sqrt(20) = 4*pi*sqrt(20)
      expect(htc.getInnerLateralArea()).toBeCloseTo(4 * Math.PI * Math.sqrt(20), 4);
      // Bottom cap: pi * (4^2 - 3^2) = 7*pi
      expect(htc.getBottomCapArea()).toBeCloseTo(7 * Math.PI, 5);
      // Top cap: pi * (2^2 - 1^2) = 3*pi
      expect(htc.getTopCapArea()).toBeCloseTo(3 * Math.PI, 5);
      // Total area: 10*pi*sqrt(20) + 10*pi
      expect(htc.getTotalSurfaceArea()).toBeCloseTo(10 * Math.PI * Math.sqrt(20) + 10 * Math.PI, 4);

      // Volume: (4*pi/3) * (16 + 8 + 4 - 9 - 3 - 1) = (4*pi/3) * (28 - 13) = (4*pi/3) * 15 = 20*pi
      expect(htc.getVolume()).toBeCloseTo(20 * Math.PI, 5);

      const data = htc.getGeometryData();
      expect(data.vertices.length).toBeGreaterThan(0);
      expect(data.normals!.length).toBe(data.vertices.length);
      expect(data.indices!.length).toBeGreaterThan(0);
    });
  });

  describe("Capsule (Kapsel)", () => {
    it("should compute exact capsule formulas", () => {
      const capsule = new Capsule({ radius: 2, length: 6 });
      // Total length = 6 + 2*2 = 10
      expect(capsule.getTotalLength()).toBe(10);
      // Cylinder lateral area = 2 * pi * 2 * 6 = 24 * pi
      expect(capsule.getCylinderLateralArea()).toBeCloseTo(24 * Math.PI, 5);
      // Hemisphere area (both) = 4 * pi * 2^2 = 16 * pi
      expect(capsule.getHemisphereArea()).toBeCloseTo(16 * Math.PI, 5);
      // Total surface area = 24*pi + 16*pi = 40 * pi
      expect(capsule.getTotalSurfaceArea()).toBeCloseTo(40 * Math.PI, 5);
      // Volume = pi * 2^2 * (4/3 * 2 + 6) = 4*pi * (8/3 + 18/3) = 4*pi * 26/3 = 104*pi/3
      expect(capsule.getVolume()).toBeCloseTo((104 * Math.PI) / 3, 5);
      // A / V = 40*pi / (104*pi/3) = 120 / 104 = 15 / 13 ~ 1.1538
      expect(capsule.getSurfaceToVolumeRatio()).toBeCloseTo(15 / 13, 5);
    });
  });
});
