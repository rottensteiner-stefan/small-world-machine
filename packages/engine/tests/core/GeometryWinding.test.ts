import { describe, it, expect } from "vitest";
import {
  Cylinder,
  Tube,
  Torus,
  Pyramid,
  Sphere,
  Ground,
  Vector3D,
  Capsule,
  Circle,
  Disk,
} from "../../src/index.js";

describe("Geometry Winding Order (Analytical)", () => {
  const getTriangleNormal = (
    vertices: Float32Array,
    indices: Uint16Array | Uint32Array,
    triIdx: number,
  ): { normal: Vector3D; centroid: Vector3D; v1: Vector3D; v2: Vector3D; v3: Vector3D } => {
    const i1 = indices[triIdx * 3]! * 3;
    const i2 = indices[triIdx * 3 + 1]! * 3;
    const i3 = indices[triIdx * 3 + 2]! * 3;

    const v1 = new Vector3D(vertices[i1]!, vertices[i1 + 1]!, vertices[i1 + 2]!);
    const v2 = new Vector3D(vertices[i2]!, vertices[i2 + 1]!, vertices[i2 + 2]!);
    const v3 = new Vector3D(vertices[i3]!, vertices[i3 + 1]!, vertices[i3 + 2]!);

    const edge1 = v2.clone().sub(v1);
    const edge2 = v3.clone().sub(v1);
    const normal = edge1.clone().cross(edge2);

    const centroid = new Vector3D(
      (v1.x + v2.x + v3.x) / 3,
      (v1.y + v2.y + v3.y) / 3,
      (v1.z + v2.z + v3.z) / 3,
    );

    return { normal, centroid, v1, v2, v3 };
  };

  it("Plane triangles should point to +Y (Right-Handed CCW Winding)", () => {
    const geo = new Ground().getGeometryData();
    const indices = geo.indices!;
    for (let i = 0; i < indices.length / 3; i++) {
      const { normal } = getTriangleNormal(geo.vertices, indices, i);
      expect(normal.x).toBeCloseTo(0);
      expect(normal.y).toBeGreaterThan(0); // Strictly facing UP
      expect(normal.z).toBeCloseTo(0);
    }
  });

  it("Sphere triangles should point outward", () => {
    const geo = new Sphere().getGeometryData();
    const indices = geo.indices!;
    for (let i = 0; i < indices.length / 3; i++) {
      const { normal, centroid } = getTriangleNormal(geo.vertices, indices, i);
      if (normal.lengthSq() < 0.0001) continue;
      // For sphere, normal should point away from origin
      expect(normal.dot(centroid)).toBeGreaterThan(0);
    }
  });

  it("Cylinder side triangles should point outward", () => {
    const geo = new Cylinder({ heightSegments: 1, radialSegments: 16 }).getGeometryData();
    const indices = geo.indices!;
    // Sides are first in Cylinder
    for (let i = 0; i < 32; i++) {
      // 16 quads * 2
      const { normal, centroid } = getTriangleNormal(geo.vertices, indices, i);
      // For cylinder side, normal XZ should point away from origin XZ
      const dotXZ = normal.x * centroid.x + normal.z * centroid.z;
      expect(dotXZ).toBeGreaterThan(0);
    }
  });

  it("Cylinder top cap should point UP", () => {
    const geo = new Cylinder({ heightSegments: 1, radialSegments: 16 }).getGeometryData();
    const indices = geo.indices!;
    // Top cap follows sides
    for (let i = 32; i < 32 + 16; i++) {
      const { normal } = getTriangleNormal(geo.vertices, indices, i);
      expect(normal.y).toBeGreaterThan(0);
    }
  });

  it("Cylinder bottom cap should point DOWN", () => {
    const geo = new Cylinder({ heightSegments: 1, radialSegments: 16 }).getGeometryData();
    const indices = geo.indices!;
    // Bottom cap follows top cap
    for (let i = 48; i < 48 + 16; i++) {
      const { normal } = getTriangleNormal(geo.vertices, indices, i);
      expect(normal.y).toBeLessThan(0);
    }
  });

  it("Tube outer side triangles should point outward", () => {
    const geo = new Tube({ radialSegments: 16 }).getGeometryData();
    const indices = geo.indices!;
    // Outer sides are first
    for (let i = 0; i < 32; i++) {
      const { normal, centroid } = getTriangleNormal(geo.vertices, indices, i);
      const dotXZ = normal.x * centroid.x + normal.z * centroid.z;
      expect(dotXZ).toBeGreaterThan(0);
    }
  });

  it("Tube inner side triangles should point inward", () => {
    const geo = new Tube({ radialSegments: 16 }).getGeometryData();
    const indices = geo.indices!;
    // Inner sides follow outer sides (32 tris)
    for (let i = 32; i < 64; i++) {
      const { normal, centroid } = getTriangleNormal(geo.vertices, indices, i);
      const dotXZ = normal.x * centroid.x + normal.z * centroid.z;
      // Normal points TOWARDS center, so dot product with outward centroid is negative
      expect(dotXZ).toBeLessThan(0);
    }
  });

  it("Tube top cap should point UP", () => {
    const geo = new Tube({ radialSegments: 16 }).getGeometryData();
    const indices = geo.indices!;
    // Caps follow sides (64 tris)
    for (let i = 64; i < 64 + 32; i++) {
      const { normal } = getTriangleNormal(geo.vertices, indices, i);
      expect(normal.y).toBeGreaterThan(0);
    }
  });

  it("Tube bottom cap should point DOWN", () => {
    const geo = new Tube({ radialSegments: 16 }).getGeometryData();
    const indices = geo.indices!;
    // Bottom cap follows top cap (64 + 32 tris)
    for (let i = 96; i < 128; i++) {
      const { normal } = getTriangleNormal(geo.vertices, indices, i);
      expect(normal.y).toBeLessThan(0);
    }
  });

  it("Pyramid triangles should point outward", () => {
    const geo = new Pyramid().getGeometryData();
    const indices = geo.indices!;
    // Side faces first
    for (let i = 0; i < 4; i++) {
      // radialSegments default is 4
      const { normal, centroid } = getTriangleNormal(geo.vertices, indices, i);
      // Centroid is on the face, normal should point away from origin
      expect(normal.dot(centroid)).toBeGreaterThan(0);
    }
    // Base cap
    const { normal } = getTriangleNormal(geo.vertices, indices, 4); // 5th triangle is first of base
    // Base is at Y = -hh, normal should be (0, -1, 0)
    expect(normal.y).toBeLessThan(0);
  });

  it("Torus triangles should point outward from tube center", () => {
    const radius = 1;
    const geo = new Torus({ radius }).getGeometryData();
    const indices = geo.indices!;
    for (let i = 0; i < indices.length / 3; i++) {
      const { normal, centroid } = getTriangleNormal(geo.vertices, indices, i);
      if (normal.lengthSq() < 0.0001) continue;

      // Tube center in XZ plane is at distance 'radius' from origin
      const distXZ = Math.sqrt(centroid.x * centroid.x + centroid.z * centroid.z);
      const tubeCenter = new Vector3D(
        centroid.x * (radius / distXZ),
        0,
        centroid.z * (radius / distXZ),
      );

      const outwardVec = centroid.clone().sub(tubeCenter);
      expect(normal.dot(outwardVec)).toBeGreaterThan(0);
    }
  });

  it("Capsule side triangles should point outward", () => {
    const geo = new Capsule().getGeometryData();
    const indices = geo.indices!;
    for (let i = 0; i < indices.length / 3; i++) {
      const { normal, centroid } = getTriangleNormal(geo.vertices, indices, i);
      if (normal.lengthSq() < 0.0001) continue;
      // Normal XZ should point away from origin XZ (or full 3D if it's on the cap)
      // Actually, centroid from origin should dot positively with normal
      expect(normal.dot(centroid)).toBeGreaterThan(0);
    }
  });

  it("Circle should point to +Y", () => {
    const geo = new Circle().getGeometryData();
    const indices = geo.indices!;
    for (let i = 0; i < indices.length / 3; i++) {
      const { normal } = getTriangleNormal(geo.vertices, indices, i);
      expect(normal.y).toBeGreaterThan(0);
    }
  });

  it("Disk should point to +Y", () => {
    const geo = new Disk().getGeometryData();
    const indices = geo.indices!;
    for (let i = 0; i < indices.length / 3; i++) {
      const { normal } = getTriangleNormal(geo.vertices, indices, i);
      expect(normal.y).toBeGreaterThan(0);
    }
  });
});
