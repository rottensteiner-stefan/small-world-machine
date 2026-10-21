import { describe, expect, it } from "vitest";
import { BoundingSphere } from "../../src/physix/BoundingSphere.js";
import { OBB } from "../../src/physix/OBB.js";
import { ConvexHull } from "../../src/physix/ConvexHull.js";
import { Ray } from "../../src/physix/Ray.js";
import { Vector3D, Matrix4 } from "../../src/math/index.js";

/** Cube [-h,h]^3 as welded-from-loops input, CCW outward; `negZero` writes 0 as -0 on some faces. */
function cubeLoops(h: number, negZero = false): Vector3D[][] {
  const z = negZero ? -0 : 0;
  const p = (x: number, y: number, zz: number): Vector3D =>
    new Vector3D(x === 0 ? z : x, y === 0 ? z : y, zz === 0 ? z : zz);
  return [
    [p(-h, -h, -h), p(-h, h, -h), p(h, h, -h), p(h, -h, -h)],
    [p(-h, -h, h), p(h, -h, h), p(h, h, h), p(-h, h, h)],
    [p(-h, -h, -h), p(h, -h, -h), p(h, -h, h), p(-h, -h, h)],
    [p(-h, h, -h), p(-h, h, h), p(h, h, h), p(h, h, -h)],
    [p(-h, -h, -h), p(-h, -h, h), p(-h, h, h), p(-h, h, -h)],
    [p(h, -h, -h), p(h, h, -h), p(h, h, h), p(h, -h, h)],
  ];
}

function worldMatrix(): Matrix4 {
  // Rotation about Y by 90 degrees, uniform scale 2, translation (10, 0, 0).
  return new Matrix4().compose(
    new Vector3D(10, 0, 0),
    new Vector3D(0, Math.PI / 2, 0),
    new Vector3D(2, 2, 2),
  );
}

describe("Bounding volumes: review fixes", () => {
  it("OBB.translate does not leak the offset through the next transform() (no double translate)", () => {
    const obb = new OBB(new Vector3D(1, 0, 0), new Vector3D(1, 1, 1));
    const m = worldMatrix();
    obb.transform(m);
    const expected = m.transformVector(new Vector3D(1, 0, 0), new Vector3D());
    obb.translate(new Vector3D(0, 5, 0));
    expect(obb.center.y).toBeCloseTo(5, 5);
    obb.transform(m);
    // The local source is untouched: re-deriving from the world matrix reproduces the original.
    expect(obb.center.x).toBeCloseTo(expected.x, 5);
    expect(obb.center.y).toBeCloseTo(expected.y, 5);
    expect(obb.center.z).toBeCloseTo(expected.z, 5);
  });

  it("ConvexHull.translate moves world data exactly once and not the local source", () => {
    const hull = ConvexHull.fromFaceLoops(cubeLoops(1));
    const m = worldMatrix();
    hull.transform(m);
    const before = hull.center.clone();
    const radius = hull.getBroadRadius();
    hull.translate(new Vector3D(0, 5, 0));
    expect(hull.center.x).toBeCloseTo(before.x, 5);
    expect(hull.center.y).toBeCloseTo(before.y + 5, 5);
    expect(hull.getBroadRadius()).toBeCloseTo(radius, 6);
    hull.transform(m);
    expect(hull.center.y).toBeCloseTo(before.y, 5);
    expect(hull.center.x).toBeCloseTo(before.x, 5);
  });

  it("ConvexHull.setFromLocal survives later transform() calls", () => {
    const hull = ConvexHull.fromFaceLoops(cubeLoops(1));
    hull.setFromLocal(new Vector3D(5, 0, 0), new Vector3D());
    hull.transform(new Matrix4());
    expect(hull.center.x).toBeCloseTo(5, 5);
    hull.transform(new Matrix4());
    expect(hull.center.x).toBeCloseTo(5, 5);
  });

  it("ConvexHull.getBroadRadius follows transform() scale (cached value stays correct)", () => {
    const hull = ConvexHull.fromFaceLoops(cubeLoops(1));
    expect(hull.getBroadRadius()).toBeCloseTo(Math.sqrt(3), 5);
    hull.transform(new Matrix4().compose(new Vector3D(), new Vector3D(), new Vector3D(3, 3, 3)));
    expect(hull.getBroadRadius()).toBeCloseTo(3 * Math.sqrt(3), 4);
  });

  it("fromFaceLoops welds -0/0 coordinates and is scale independent", () => {
    for (const scale of [1, 1e-6, 1e4]) {
      // Cube [1,3]*scale: coordinates 1e-6 and 3e-6 collapse under a fixed 5-decimal weld key.
      const loops = cubeLoops(1 * scale, true).map((l) =>
        l.map((v) => new Vector3D(v.x + 2 * scale, v.y + 2 * scale, v.z + 2 * scale)),
      );
      const hull = ConvexHull.fromFaceLoops(loops);
      expect(hull.vertices.length).toBe(8);
      expect(hull.volume() / (8 * scale ** 3)).toBeCloseTo(1, 6);
    }
  });

  it("per-triangle queries stay correct across repeated calls (shared scratch is safe)", () => {
    const hull = ConvexHull.fromFaceLoops(cubeLoops(1));
    for (let i = 0; i < 3; i++) {
      expect(hull.volume()).toBeCloseTo(8, 6);
      const n = hull.surfaceNormalAt(new Vector3D(0.2, 1, -0.3));
      expect(n.y).toBeCloseTo(1, 6);
      const c = hull.closestPoint(new Vector3D(5, 0.3, -0.2));
      expect(c.x).toBeCloseTo(1, 6);
      expect(c.y).toBeCloseTo(0.3, 6);
      expect(c.z).toBeCloseTo(-0.2, 6);
      const near = hull.closestPoint(new Vector3D(3, 3, 3));
      expect(near.distanceTo(new Vector3D(1, 1, 1))).toBeCloseTo(0, 6);
      expect(hull.intersectsRay(new Ray(new Vector3D(0, 0, 10), new Vector3D(0, 0, -1)))).toBe(
        true,
      );
      expect(hull.intersectsRay(new Ray(new Vector3D(9, 9, 10), new Vector3D(0, 0, -1)))).toBe(
        false,
      );
    }
  });

  it("BoundingSphere.closestPoint returns a surface point for interior queries too", () => {
    const s = new BoundingSphere(new Vector3D(1, 2, 3), 2);
    const p = s.closestPoint(new Vector3D(1.5, 2, 3)); // strictly inside
    expect(p.distanceTo(s.center)).toBeCloseTo(2, 6);
    expect(p.x).toBeCloseTo(3, 6); // pushed outwards along +x
    const q = s.closestPoint(s.center);
    expect(q.distanceTo(s.center)).toBeCloseTo(2, 6);
  });
});
