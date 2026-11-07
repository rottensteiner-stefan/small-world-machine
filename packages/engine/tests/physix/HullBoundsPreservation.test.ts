import { describe, it, expect } from "vitest";
import { Object3D } from "../../src/core/Object3D.js";
import { Cube } from "../../src/geometry/Cube.js";
import { ConvexHull } from "../../src/physix/ConvexHull.js";
import { Vector3D } from "../../src/math/Vector3D.js";

describe("ConvexHull bounds preservation on Object3D", () => {
  it("welds coincident points from fromFaceLoops() into a shared vertex list", () => {
    const a = new Vector3D(0, 0, 0);
    const b = new Vector3D(1, 0, 0);
    const c = new Vector3D(1, 1, 0);
    const d = new Vector3D(0, 1, 0);
    const e = new Vector3D(0, 0, 1);

    // A simple pyramid: a square base (a,b,c,d) plus 4 triangular side faces up to apex e.
    // Every point appears in multiple faces, so a naive per-face vertex list would have
    // 4 + 4*3 = 16 entries; welding should collapse it back down to 5 unique points.
    const hull = ConvexHull.fromFaceLoops([
      [a, d, c, b],
      [a, b, e],
      [b, c, e],
      [c, d, e],
      [d, a, e],
    ]);

    expect(hull.vertices.length).toBe(5);
  });

  it("preserves an assigned ConvexHull's bounds across Object3D.computeBounds(), unlike Box/Sphere", () => {
    const obj = new Object3D();
    obj.geometry = new Cube({ size: 2 }).getGeometryData();

    const customHull = ConvexHull.fromFaceLoops([
      [
        new Vector3D(-1, -1, -1),
        new Vector3D(-1, 1, -1),
        new Vector3D(1, 1, -1),
        new Vector3D(1, -1, -1),
      ],
      [
        new Vector3D(-1, -1, 1),
        new Vector3D(1, -1, 1),
        new Vector3D(1, 1, 1),
        new Vector3D(-1, 1, 1),
      ],
      [
        new Vector3D(-1, -1, -1),
        new Vector3D(1, -1, -1),
        new Vector3D(1, -1, 1),
        new Vector3D(-1, -1, 1),
      ],
      [
        new Vector3D(-1, 1, -1),
        new Vector3D(-1, 1, 1),
        new Vector3D(1, 1, 1),
        new Vector3D(1, 1, -1),
      ],
      [
        new Vector3D(-1, -1, -1),
        new Vector3D(-1, -1, 1),
        new Vector3D(-1, 1, 1),
        new Vector3D(-1, 1, -1),
      ],
      [
        new Vector3D(1, -1, -1),
        new Vector3D(1, 1, -1),
        new Vector3D(1, 1, 1),
        new Vector3D(1, -1, 1),
      ],
    ]);
    obj.bounds = customHull;

    obj.position.set(5, 0, 0);
    obj.updateMatrixWorld();
    obj.computeBounds();

    // Bounds must remain the exact same ConvexHull instance (never replaced with a
    // fresh Box/Sphere derived from the geometry), same "sticky" treatment as OBB.
    expect(obj.bounds).toBe(customHull);
    expect(obj.bounds instanceof ConvexHull).toBe(true);
    expect(customHull.center.x).toBeCloseTo(5);

    // Re-computing on the next frame keeps re-deriving from local space correctly.
    obj.position.set(2, 0, 0);
    obj.updateMatrixWorld();
    obj.computeBounds();
    expect(customHull.center.x).toBeCloseTo(2);
  });
});
