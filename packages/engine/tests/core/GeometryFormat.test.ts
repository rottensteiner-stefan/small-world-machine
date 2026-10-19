import { describe, it, expect } from "vitest";
import {
  Capsule,
  Circle,
  Cone,
  Cube,
  Cylinder,
  Disk,
  ExtrudeGeometry,
  Gear,
  Ground,
  Pyramid,
  Sphere,
  Torus,
  Triangle,
  Tube,
  Vector2D,
  Vector3D,
} from "../../src/index.js";

describe("Geometry Buffer Types", () => {
  it("should have matching index and wireframe index array types", () => {
    const geometries = [
      new Cube({ size: 3 }),
      new Sphere({ radius: 1.5 }),
      new Pyramid({ base: 3, height: 3 }),
      new Torus({ radius: 1.5, tube: 0.5 }),
      new Capsule({ radius: 1, length: 2 }),
      new Cone({ radius: 1.5, height: 3 }),
      new Cylinder({ radiusTop: 1.5, radiusBottom: 1.5, height: 3 }),
      new Tube({ radius: 1.5, innerRadius: 1.0, height: 3 }),
      new Circle({ radius: 1.5 }),
      new Disk({ radius: 1.5 }),
      new Cylinder({ radiusTop: 1.5, radiusBottom: 1.5, height: 3, thetaLength: Math.PI }),
      new Ground({ width: 3, depth: 3 }),
      new Triangle(new Vector3D(-1, 0, 0), new Vector3D(1, 0, 0), new Vector3D(0, 0, -1)),
      new Gear({ innerRadius: 1.0, toothHeight: 0.5, teeth: 12, thickness: 0.5 }),
      new ExtrudeGeometry({
        shape: [new Vector2D(-1, -1), new Vector2D(1, -1), new Vector2D(1, 1), new Vector2D(-1, 1)],
      }),
    ];

    for (const geo of geometries) {
      const data = geo.getGeometryData();

      const idx = data.indices;
      const wireIdx = data.wireframeIndices;

      // Some geometries might not have indices at all, but if they do, we check them
      if (idx && wireIdx) {
        expect(idx.constructor.name).toBe(wireIdx.constructor.name);
        expect(idx.BYTES_PER_ELEMENT).toBe(wireIdx.BYTES_PER_ELEMENT);
      }
    }
  });
});
