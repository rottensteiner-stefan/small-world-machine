import { describe, it, expect } from "vitest";
import {
  Annulus,
  Cube,
  Sphere,
  Cone,
  Cylinder,
  Pyramid,
  Octahedron,
  Torus,
  Capsule,
  TruncatedCone,
  CutCylinder,
  PointedPillar,
  SphericalTriangleSector,
  SphericalCap,
  Arch,
  HollowCylinder,
  Barrel,
  CylinderSector,
  Gear,
  Tube,
  OpenFrame,
  LShape,
  Rhombus,
  TriStar,
  CylindricalArch,
  HollowTruncatedCone,
} from "../../src/geometry/index.js";
import { AbstractGeometry } from "../../src/geometry/AbstractGeometry.js";

function checkOutwardNormals(
  geometry: AbstractGeometry,
  _name: string,
): { totalTriangles: number; flippedTriangles: number } {
  const data = geometry.getGeometryData();
  const v = data.vertices;
  const n = data.normals;
  const idx = data.indices;

  expect(v).toBeDefined();
  expect(n).toBeDefined();
  expect(idx).toBeDefined();

  let flippedCount = 0;
  const total = idx!.length / 3;

  for (let i = 0; i < idx!.length; i += 3) {
    const i0 = idx![i]! * 3;
    const i1 = idx![i + 1]! * 3;
    const i2 = idx![i + 2]! * 3;

    // Vertices
    const ax = v[i0]!,
      ay = v[i0 + 1]!,
      az = v[i0 + 2]!;
    const bx = v[i1]!,
      by = v[i1 + 1]!,
      bz = v[i1 + 2]!;
    const cx = v[i2]!,
      cy = v[i2 + 1]!,
      cz = v[i2 + 2]!;

    // Edges
    const e1x = bx - ax,
      e1y = by - ay,
      e1z = bz - az;
    const e2x = cx - ax,
      e2y = cy - ay,
      e2z = cz - az;

    // Face normal from cross product (v1 - v0) x (v2 - v0)
    const fnx = e1y * e2z - e1z * e2y;
    const fny = e1z * e2x - e1x * e2z;
    const fnz = e1x * e2y - e1y * e2x;

    // Average vertex normal
    const vnx = (n![i0]! + n![i1]! + n![i2]!) / 3;
    const vny = (n![i0 + 1]! + n![i1 + 1]! + n![i2 + 1]!) / 3;
    const vnz = (n![i0 + 2]! + n![i1 + 2]! + n![i2 + 2]!) / 3;

    const dot = fnx * vnx + fny * vny + fnz * vnz;
    const faceArea = Math.hypot(fnx, fny, fnz);

    // If triangle is not degenerate and face normal opposes vertex normal
    if (faceArea > 1e-6 && dot < -1e-6) {
      flippedCount++;
    }
  }

  return { totalTriangles: total, flippedTriangles: flippedCount };
}

describe("Winding & Outward-Facing Normal Verification", () => {
  const geometries: [string, AbstractGeometry][] = [
    ["Cube", new Cube({ size: 2 })],
    ["Sphere", new Sphere({ radius: 1.5 })],
    ["Cone", new Cone({ radius: 1.5, height: 3 })],
    ["Cylinder", new Cylinder({ radiusTop: 1.5, radiusBottom: 1.5, height: 3 })],
    [
      "CylinderSector",
      new CylinderSector({
        radiusTop: 1.5,
        radiusBottom: 1.5,
        height: 3,
        thetaLength: Math.PI * 0.75,
      }),
    ],
    ["Pyramid", new Pyramid({ base: 2, height: 3 })],
    ["Octahedron", new Octahedron({ radius: 1.5 })],
    ["Torus", new Torus({ radius: 1.5, tube: 0.5 })],
    ["Capsule", new Capsule({ radius: 1, length: 2 })],
    [
      "Gear",
      new Gear({ teeth: 8, innerRadius: 1.0, toothHeight: 0.5, holeRadius: 0.3, thickness: 0.5 }),
    ],
    ["Tube", new Tube({ radius: 1.5, innerRadius: 0.8, height: 3 })],
    ["TruncatedCone", new TruncatedCone({ radiusBottom: 1.5, radiusTop: 0.75, height: 3 })],
    ["CutCylinder", new CutCylinder({ radius: 1.5, heightMin: 1.2, heightMax: 3.2 })],
    [
      "PointedPillar",
      new PointedPillar({
        radiusBase: 1.2,
        radiusTransition: 0.8,
        heightPillar: 2.2,
        heightTip: 1.2,
      }),
    ],
    [
      "SphericalTriangleSector",
      new SphericalTriangleSector({ radius: 1.8, angle: Math.PI * 0.65 }),
    ],
    ["SphericalCap", new SphericalCap({ radius: 2.0, height: 1.2 })],
    ["Arch", new Arch({ length: 3.4, height: 3.0, depth: 1.2, radius: 1.2 })],
    ["HollowCylinder", new HollowCylinder({ radiusOuter: 1.5, radiusInner: 0.8, height: 3 })],
    ["Barrel", new Barrel({ radiusMiddle: 1.5, radiusEnds: 1.1, height: 3 })],
    ["OpenFrame2D", new OpenFrame({ width: 3, height: 3, thickness: 0.6, depth: 0 })],
    ["OpenFrame3D", new OpenFrame({ width: 3, height: 3, thickness: 0.6, depth: 1.5 })],
    ["LShape2D", new LShape({ width: 3, height: 3, thickness: 0.6, depth: 0 })],
    ["LShape3D", new LShape({ width: 3, height: 3, thickness: 0.6, depth: 1.5 })],
    ["Rhombus2D", new Rhombus({ side: 2.5, angle: Math.PI / 3, depth: 0 })],
    ["Rhombus3D", new Rhombus({ side: 2.5, angle: Math.PI / 3, depth: 1.5 })],
    ["TriStar2D", new TriStar({ armLength: 2.0, innerAngle: Math.PI / 6, depth: 0 })],
    ["TriStar3D", new TriStar({ armLength: 2.0, innerAngle: Math.PI / 6, depth: 1.5 })],
    [
      "CylindricalArch",
      new CylindricalArch({ pipeRadius: 0.6, bendRadius: 1.5, arcAngle: Math.PI / 2 }),
    ],
    [
      "HollowTruncatedCone",
      new HollowTruncatedCone({
        outerRadiusBottom: 1.8,
        outerRadiusTop: 1.0,
        innerRadiusBottom: 1.4,
        innerRadiusTop: 0.7,
        height: 2.5,
      }),
    ],
  ];

  for (const [name, geom] of geometries) {
    it(`should have 100% outward-facing triangles for ${name}`, () => {
      const result = checkOutwardNormals(geom, name);
      expect(
        result.flippedTriangles,
        `${name} has ${result.flippedTriangles} flipped triangles out of ${result.totalTriangles}`,
      ).toBe(0);
    });
  }

  describe("Specific Geometry Defect Remediation Tests", () => {
    it("Annulus top faces have CCW cross-product pointing strictly in +Y direction", () => {
      const annulus = new Annulus({
        innerRadius: 1.0,
        outerRadius: 2.0,
        thetaSegments: 16,
        phiSegments: 4,
      });
      const data = annulus.getGeometryData();
      const v = data.vertices;
      const idx = data.indices!;

      for (let i = 0; i < idx.length; i += 3) {
        const i0 = idx[i]! * 3;
        const i1 = idx[i + 1]! * 3;
        const i2 = idx[i + 2]! * 3;

        const e1x = v[i1]! - v[i0]!;
        const e1z = v[i1 + 2]! - v[i0 + 2]!;
        const e2x = v[i2]! - v[i0]!;
        const e2z = v[i2 + 2]! - v[i0 + 2]!;

        // Cross product: (e1x, 0, e1z) x (e2x, 0, e2z) -> Y component = e1z * e2x - e1x * e2z
        const fny = e1z * e2x - e1x * e2z;
        expect(fny).toBeGreaterThan(0);
      }
    });

    it("Tube unshares cap vertices from mantle and mirrors UV V coordinate", () => {
      const tube = new Tube({
        radius: 2.0,
        innerRadius: 1.0,
        height: 4.0,
        radialSegments: 16,
        heightSegments: 2,
      });
      const data = tube.getGeometryData();
      const v = data.vertices;
      const n = data.normals!;
      const uv = data.uvs!;

      // Check mantle UV V coordinates:
      // At y = -hh (y=0 in loop), vCoord should be 1 - 0 = 1
      // At y = +hh (y=heightSegments in loop), vCoord should be 1 - 1 = 0
      const hh = 2.0;
      for (let i = 0; i < v.length; i += 3) {
        const y = v[i + 1]!;
        const vCoord = uv[(i / 3) * 2 + 1]!;
        if (Math.abs(y - hh) < 1e-4 && (Math.abs(n[i]!) > 0.1 || Math.abs(n[i + 2]!) > 0.1)) {
          // Mantle vertex at top should have V = 0
          expect(vCoord).toBeCloseTo(0);
        }
      }

      // Check cap normals:
      // Vertices on the top cap (y = hh) that have ny > 0.5 must have ny close to 1.0 (not tilted by mantle)
      for (let i = 0; i < v.length; i += 3) {
        const ny = n[i + 1]!;
        if (ny > 0.5) {
          expect(ny).toBeCloseTo(1.0, 3);
          expect(Math.hypot(n[i]!, n[i + 2]!)).toBeCloseTo(0, 3);
        } else if (ny < -0.5) {
          expect(ny).toBeCloseTo(-1.0, 3);
          expect(Math.hypot(n[i]!, n[i + 2]!)).toBeCloseTo(0, 3);
        }
      }
    });

    it("CutCylinder side cap axis top point equals avgH - yCenterOffset (eliminating wedge gap)", () => {
      const cut = new CutCylinder({
        radius: 2.0,
        heightMin: 2.0,
        heightMax: 6.0,
        thetaStart: 0,
        thetaLength: Math.PI, // partial sector with side caps
        radialSegments: 16,
        heightSegments: 4,
      });

      const data = cut.getGeometryData();
      const v = data.vertices;

      const avgH = (2.0 + 6.0) / 2; // 4.0
      const yCenterOffset = avgH / 2; // 2.0
      const expectedAxisTopY = avgH - yCenterOffset; // 2.0

      // Find axis vertices (x = 0, z = 0) with maximum Y
      let maxAxisY = -Infinity;
      for (let i = 0; i < v.length; i += 3) {
        if (Math.abs(v[i]!) < 1e-5 && Math.abs(v[i + 2]!) < 1e-5) {
          if (v[i + 1]! > maxAxisY) {
            maxAxisY = v[i + 1]!;
          }
        }
      }

      expect(maxAxisY).toBeCloseTo(expectedAxisTopY, 4);
    });
  });
});
