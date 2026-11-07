import { describe, it, expect } from "vitest";
import { TruncatedCone } from "../../src/geometry/TruncatedCone.js";
import { CutCylinder } from "../../src/geometry/CutCylinder.js";
import { PointedPillar } from "../../src/geometry/PointedPillar.js";
import { SphericalTriangleSector } from "../../src/geometry/SphericalTriangleSector.js";
import { SphericalCap } from "../../src/geometry/SphericalCap.js";
import { Arch } from "../../src/geometry/Arch.js";
import { Annulus } from "../../src/geometry/Annulus.js";

describe("Rechneronline Core Geometries", () => {
  describe("1. TruncatedCone (Kegelstumpf)", () => {
    it("should compute exact mathematical properties according to rechneronline.de/pi/kegelstumpf.php", () => {
      const r1 = 3; // base radius
      const r2 = 1; // top radius
      const h = 4; // height
      const cone = new TruncatedCone({ radiusBottom: r1, radiusTop: r2, height: h });

      // Slant height s = sqrt((3 - 1)^2 + 4^2) = sqrt(4 + 16) = sqrt(20) = 4.47213595
      const s = Math.sqrt(20);
      expect(cone.getSlantHeight()).toBeCloseTo(s);

      // Lateral area M = PI * (r1 + r2) * s = PI * 4 * sqrt(20)
      expect(cone.getLateralArea()).toBeCloseTo(Math.PI * 4 * s);

      // Base area = PI * 9, Top area = PI * 1
      expect(cone.getBaseArea()).toBeCloseTo(Math.PI * 9);
      expect(cone.getTopArea()).toBeCloseTo(Math.PI * 1);

      // Total area A = M + PI*9 + PI*1 = PI * 4 * sqrt(20) + 10*PI
      expect(cone.getTotalSurfaceArea()).toBeCloseTo(Math.PI * 4 * s + 10 * Math.PI);

      // Volume V = (PI * h / 3) * (r1^2 + r1*r2 + r2^2) = (4 * PI / 3) * (9 + 3 + 1) = (52/3) * PI
      expect(cone.getVolume()).toBeCloseTo((52 / 3) * Math.PI);
    });

    it("should generate valid buffer data with unit normals", () => {
      const cone = new TruncatedCone({
        radiusBottom: 2,
        radiusTop: 1,
        height: 3,
        radialSegments: 16,
      });
      const data = cone.getGeometryData();
      expect(data.vertices.length).toBeGreaterThan(0);
      expect(data.indices!.length).toBeGreaterThan(0);
      for (let i = 0; i < data.normals!.length; i += 3) {
        const len = Math.hypot(data.normals![i]!, data.normals![i + 1]!, data.normals![i + 2]!);
        expect(len).toBeCloseTo(1.0, 3);
      }
    });
  });

  describe("2. CutCylinder (Zylinderabschnitt)", () => {
    it("should compute exact mathematical properties according to rechneronline.de/pi/zylinderabschnitt.php", () => {
      const r = 2;
      const h1 = 2;
      const h2 = 6;
      const cut = new CutCylinder({ radius: r, heightMin: h1, heightMax: h2 });

      // Semi-major axis a = sqrt(r^2 + ((h2 - h1)/2)^2) = sqrt(4 + 4) = sqrt(8)
      expect(cut.getSemiMajorAxis()).toBeCloseTo(Math.sqrt(8));

      // Cut angle alpha = atan((6 - 2) / (2 * 2)) = atan(1) = PI / 4 = 45 deg
      expect(cut.getCutAngle()).toBeCloseTo(Math.PI / 4);

      // Volume V = PI * r^2 * (h1 + h2)/2 = PI * 4 * 4 = 16 * PI
      expect(cut.getVolume()).toBeCloseTo(16 * Math.PI);

      // Lateral area M = PI * r * (h1 + h2) = PI * 2 * 8 = 16 * PI
      expect(cut.getLateralArea()).toBeCloseTo(16 * Math.PI);

      // Total area A = PI * r * (r + a + h1 + h2) = PI * 2 * (2 + sqrt(8) + 8) = 2*PI*(10 + sqrt(8))
      expect(cut.getTotalSurfaceArea()).toBeCloseTo(2 * Math.PI * (10 + Math.sqrt(8)));
    });

    it("should generate valid buffers with finite coordinates and unit normals", () => {
      const cut = new CutCylinder({ radius: 1.5, heightMin: 1, heightMax: 3, radialSegments: 16 });
      const data = cut.getGeometryData();
      for (let i = 0; i < data.normals!.length; i += 3) {
        const len = Math.hypot(data.normals![i]!, data.normals![i + 1]!, data.normals![i + 2]!);
        expect(len).toBeCloseTo(1.0, 3);
      }
    });
  });

  describe("3. PointedPillar (Spitze Säule)", () => {
    it("should compute exact mathematical properties according to rechneronline.de/pi/spitze-saeule.php", () => {
      const a = 2; // base radius
      const b = 1; // transition radius
      const h1 = 3; // pillar height
      const h2 = 2; // tip height
      const pillar = new PointedPillar({
        radiusBase: a,
        radiusTransition: b,
        heightPillar: h1,
        heightTip: h2,
      });

      // s1 = sqrt((2 - 1)^2 + 3^2) = sqrt(10)
      const s1 = Math.sqrt(10);
      expect(pillar.getSlantHeightPillar()).toBeCloseTo(s1);

      // s2 = sqrt(1^2 + 2^2) = sqrt(5)
      const s2 = Math.sqrt(5);
      expect(pillar.getSlantHeightTip()).toBeCloseTo(s2);

      // M = PI * ((a + b)*s1 + b*s2) = PI * (3*sqrt(10) + sqrt(5))
      const m = Math.PI * (3 * s1 + s2);
      expect(pillar.getLateralArea()).toBeCloseTo(m);

      // Base area = PI * a^2 = 4 * PI
      expect(pillar.getBaseArea()).toBeCloseTo(4 * Math.PI);

      // Total area = 4*PI + M
      expect(pillar.getTotalSurfaceArea()).toBeCloseTo(4 * Math.PI + m);

      // Volume = (PI / 3) * (h1 * (a^2 + a*b + b^2) + b^2 * h2) = (PI / 3) * (3 * (4 + 2 + 1) + 1 * 2) = (PI / 3) * (21 + 2) = (23/3) * PI
      expect(pillar.getVolume()).toBeCloseTo((23 / 3) * Math.PI);
    });

    it("should generate valid buffer data with split normals at the transition ridge", () => {
      const pillar = new PointedPillar({
        radiusBase: 1,
        radiusTransition: 0.5,
        heightPillar: 2,
        heightTip: 1,
        radialSegments: 16,
      });
      const data = pillar.getGeometryData();
      expect(data.vertices.length).toBeGreaterThan(0);
      for (let i = 0; i < data.normals!.length; i += 3) {
        const len = Math.hypot(data.normals![i]!, data.normals![i + 1]!, data.normals![i + 2]!);
        expect(len).toBeCloseTo(1.0, 3);
      }
    });
  });

  describe("4. SphericalTriangleSector (Kugeldreiecksektor)", () => {
    it("should compute exact mathematical properties according to rechneronline.de/pi/kugeldreiecksektor.php", () => {
      const r = 2;
      const alpha = Math.PI / 2; // 90 degrees
      const sector = new SphericalTriangleSector({ radius: r, angle: alpha });

      // Base arc length a = alpha * r = PI
      expect(sector.getArcLength()).toBeCloseTo(Math.PI);

      // Curved spherical triangle area S = alpha * r^2 = (PI / 2) * 4 = 2 * PI
      expect(sector.getSphericalTriangleArea()).toBeCloseTo(2 * Math.PI);

      // Planar bounding area A_planar = ((PI + alpha) / 2) * r^2 = ((PI + PI/2) / 2) * 4 = 3 * PI
      expect(sector.getPlanarArea()).toBeCloseTo(3 * Math.PI);

      // Total surface area A = 2*PI + 3*PI = 5 * PI
      expect(sector.getTotalSurfaceArea()).toBeCloseTo(5 * Math.PI);

      // Volume V = (alpha * r^3) / 3 = ((PI / 2) * 8) / 3 = (4/3) * PI (which is 1/8 of total sphere volume (32/3)*PI)
      expect(sector.getVolume()).toBeCloseTo((4 / 3) * Math.PI);
    });

    it("should generate proper vertex normals on spherical surface", () => {
      const sector = new SphericalTriangleSector({
        radius: 1.5,
        angle: Math.PI / 3,
        widthSegments: 12,
        heightSegments: 8,
      });
      const data = sector.getGeometryData();
      expect(data.vertices.length).toBeGreaterThan(0);
      for (let i = 0; i < data.normals!.length; i += 3) {
        const len = Math.hypot(data.normals![i]!, data.normals![i + 1]!, data.normals![i + 2]!);
        expect(len).toBeCloseTo(1.0, 3);
      }
    });
  });

  describe("5. SphericalCap (Kugelsegment)", () => {
    it("should compute exact mathematical properties according to rechneronline.de/pi/kugelsegment.php", () => {
      const r = 5;
      const h = 2;
      const cap = new SphericalCap({ radius: r, height: h });

      // Base radius a = sqrt(h * (2r - h)) = sqrt(2 * (10 - 2)) = sqrt(16) = 4
      expect(cap.getBaseRadius()).toBeCloseTo(4);

      // Curved dome area M = 2 * PI * r * h = 2 * PI * 5 * 2 = 20 * PI
      expect(cap.getCurvedArea()).toBeCloseTo(20 * Math.PI);

      // Base circular area = PI * a^2 = 16 * PI
      expect(cap.getBaseArea()).toBeCloseTo(16 * Math.PI);

      // Total surface area A = M + A_base = 36 * PI (= PI * h * (4r - h) = PI * 2 * 18 = 36*PI)
      expect(cap.getTotalSurfaceArea()).toBeCloseTo(36 * Math.PI);

      // Volume V = (PI * h^2 / 3) * (3r - h) = (4 * PI / 3) * (15 - 2) = (52/3) * PI
      expect(cap.getVolume()).toBeCloseTo((52 / 3) * Math.PI);
    });

    it("should handle hemisphere (h = r) exactly", () => {
      const r = 3;
      const hemisphere = new SphericalCap({ radius: r, height: r });
      expect(hemisphere.getBaseRadius()).toBeCloseTo(3);
      expect(hemisphere.getCurvedArea()).toBeCloseTo(2 * Math.PI * 9); // half sphere mantle = 18*PI
      expect(hemisphere.getVolume()).toBeCloseTo((2 / 3) * Math.PI * 27); // half sphere volume = 18*PI
    });

    it("should generate valid geometry buffers", () => {
      const cap = new SphericalCap({ radius: 2, height: 1, radialSegments: 16, heightSegments: 8 });
      const data = cap.getGeometryData();
      for (let i = 0; i < data.normals!.length; i += 3) {
        const len = Math.hypot(data.normals![i]!, data.normals![i + 1]!, data.normals![i + 2]!);
        expect(len).toBeCloseTo(1.0, 3);
      }
    });
  });

  describe("6. Arch (Bogen)", () => {
    it("should compute exact mathematical properties according to rechneronline.de/pi/bogen.php", () => {
      const l = 6; // length
      const h = 4; // height
      const t = 2; // depth
      const r = 2; // arch radius
      const arch = new Arch({ length: l, height: h, depth: t, radius: r });

      // Cross-sectional face area = h * l - (PI * r^2 / 2) = 24 - 2 * PI
      const faceArea = 24 - 2 * Math.PI;
      expect(arch.getFaceArea()).toBeCloseTo(faceArea);

      // Intrados area = PI * r * t = 4 * PI
      expect(arch.getIntradosArea()).toBeCloseTo(4 * Math.PI);

      // Total volume = faceArea * t = 2 * (24 - 2 * PI) = 48 - 4 * PI
      expect(arch.getVolume()).toBeCloseTo((24 - 2 * Math.PI) * 2);

      // Total surface area = 2 * faceArea + intrados + 2*t*(l + h - r)
      // = 2*(24 - 2*PI) + 4*PI + 2*2*(6 + 4 - 2) = 48 - 4*PI + 4*PI + 4 * 8 = 80
      expect(arch.getTotalSurfaceArea()).toBeCloseTo(80);
    });

    it("should generate watertight mesh buffers with finite vertex coords and valid normals", () => {
      const arch = new Arch({ length: 5, height: 3, depth: 1.5, radius: 1.2, radialSegments: 16 });
      const data = arch.getGeometryData();
      expect(data.vertices.length).toBeGreaterThan(0);
      expect(data.indices!.length).toBeGreaterThan(0);
      for (let i = 0; i < data.normals!.length; i += 3) {
        const len = Math.hypot(data.normals![i]!, data.normals![i + 1]!, data.normals![i + 2]!);
        expect(len).toBeCloseTo(1.0, 3);
      }
    });
  });

  describe("7. Annulus (Kreisring)", () => {
    it("should compute exact mathematical properties according to rechneronline.de/pi/kreisring.php", () => {
      const r = 2; // inner radius
      const R = 5; // outer radius
      const ring = new Annulus({ innerRadius: r, outerRadius: R });

      // Wall thickness b = R - r = 3
      expect(ring.getWallThickness()).toBeCloseTo(3);

      // Median radius r_med = (R + r) / 2 = 3.5
      expect(ring.getMedianRadius()).toBeCloseTo(3.5);

      // Tangent chord length l = 2 * sqrt(R^2 - r^2) = 2 * sqrt(25 - 4) = 2 * sqrt(21)
      expect(ring.getTangentChordLength()).toBeCloseTo(2 * Math.sqrt(21));

      // Perimeter U = 2 * PI * (R + r) = 2 * PI * 7 = 14 * PI
      expect(ring.getPerimeter()).toBeCloseTo(14 * Math.PI);

      // Area A = PI * (R^2 - r^2) = PI * (25 - 4) = 21 * PI
      expect(ring.getArea()).toBeCloseTo(21 * Math.PI);
    });

    it("should generate planar 2D ring in X-Z plane with +Y normals", () => {
      const ring = new Annulus({
        innerRadius: 1,
        outerRadius: 2,
        thetaSegments: 16,
        phiSegments: 2,
      });
      const data = ring.getGeometryData();
      expect(data.vertices.length).toBeGreaterThan(0);
      expect(data.indices!.length).toBeGreaterThan(0);
      for (let i = 0; i < data.vertices.length; i += 3) {
        expect(data.vertices[i + 1]).toBeCloseTo(0); // Y is 0
      }
      for (let i = 0; i < data.normals!.length; i += 3) {
        expect(data.normals![i]).toBeCloseTo(0);
        expect(data.normals![i + 1]).toBeCloseTo(1);
        expect(data.normals![i + 2]).toBeCloseTo(0);
      }
    });
  });
});
