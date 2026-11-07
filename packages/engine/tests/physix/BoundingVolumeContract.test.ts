import { describe, expect, it } from "vitest";
import { BoundingBox } from "../../src/physix/BoundingBox.js";
import { BoundingSphere } from "../../src/physix/BoundingSphere.js";
import { OBB } from "../../src/physix/OBB.js";
import { ConvexHull } from "../../src/physix/ConvexHull.js";
import { Ray } from "../../src/physix/Ray.js";
import { Collision } from "../../src/physix/Collision.js";
import { Vector3D, Matrix4 } from "../../src/math/index.js";
import { BoundingType } from "../../src/enums/index.js";
import type { BoundingVolume } from "../../src/interfaces/index.js";

/**
 * Pins the BoundingVolume-Vollendung contract: `BoundingVolume` is a discriminated union whose
 * members carry a literal `type`, every concrete class implements the full method set, and the
 * methods behave consistently across box/sphere/OBB/hull. These tests exist so the union + method
 * set cannot silently regress back into cast-based narrowing or a split API.
 */

/** Axis-aligned unit-cube ConvexHull, matching the winding used across physix tests. */
function makeUnitHull(): ConvexHull {
  const v = [
    new Vector3D(-1, -1, -1),
    new Vector3D(1, -1, -1),
    new Vector3D(1, 1, -1),
    new Vector3D(-1, 1, -1),
    new Vector3D(-1, -1, 1),
    new Vector3D(1, -1, 1),
    new Vector3D(1, 1, 1),
    new Vector3D(-1, 1, 1),
  ];
  const faces = [
    [0, 3, 2, 1], // -Z
    [4, 5, 6, 7], // +Z
    [0, 1, 5, 4], // -Y
    [3, 7, 6, 2], // +Y
    [0, 4, 7, 3], // -X
    [1, 2, 6, 5], // +X
  ];
  return new ConvexHull(v, faces);
}

/** One volume per concrete type, all centered at the origin and fully inside [-1,1]^3. */
function centeredOriginVolumes(): Array<{ v: BoundingVolume; type: BoundingType }> {
  return [
    { v: new BoundingBox(new Vector3D(-1, -1, -1), new Vector3D(1, 1, 1)), type: BoundingType.BOX },
    { v: new BoundingSphere(new Vector3D(0, 0, 0), 1), type: BoundingType.SPHERE },
    { v: new OBB(new Vector3D(0, 0, 0), new Vector3D(0.9, 0.9, 0.9)), type: BoundingType.OBB },
    { v: makeUnitHull(), type: BoundingType.HULL },
  ];
}

describe("BoundingVolume discriminated union", () => {
  it("every concrete volume carries a distinct literal type discriminator", () => {
    const box = new BoundingBox();
    const sphere = new BoundingSphere(new Vector3D(0, 0, 0), 0);
    const obb = new OBB();
    const hull = makeUnitHull();
    expect(box.type).toBe(BoundingType.BOX);
    expect(sphere.type).toBe(BoundingType.SPHERE);
    expect(obb.type).toBe(BoundingType.OBB);
    expect(hull.type).toBe(BoundingType.HULL);
    expect(new Set([box.type, sphere.type, obb.type, hull.type]).size).toBe(4);
  });

  it("narrows to the concrete type via `.type` without any cast", () => {
    const classify = (v: BoundingVolume): string => {
      switch (v.type) {
        case BoundingType.BOX:
          return "box";
        case BoundingType.SPHERE:
          return "sphere";
        case BoundingType.OBB:
          return "obb";
        case BoundingType.HULL:
          return "hull";
      }
    };
    expect(classify(new BoundingBox())).toBe("box");
    expect(classify(new BoundingSphere(new Vector3D(), 0))).toBe("sphere");
    expect(classify(new OBB())).toBe("obb");
    expect(classify(makeUnitHull())).toBe("hull");
  });

  it("works end-to-end through the Collision dispatch without casts", () => {
    const s = new BoundingSphere(new Vector3D(0, 0, 0), 0.5);
    const s2 = new BoundingSphere(new Vector3D(0.8, 0, 0), 0.5);
    const hull = makeUnitHull();
    // Sphere-vs-sphere and sphere-vs-hull route through unknown concrete pairs in `test()`.
    expect(Collision.test(s, s2)).toBe(true);
    expect(Collision.test(new BoundingSphere(new Vector3D(5, 0, 0), 0.5), s2)).toBe(false);
    expect(Collision.test(s, hull)).toBe(true);
    expect(Collision.test(new BoundingSphere(new Vector3D(6, 0, 0), 0.5), hull)).toBe(false);
  });
});

describe("BoundingVolume method set", () => {
  it("getAabb() encloses the volume's center for every concrete type", () => {
    for (const { v } of centeredOriginVolumes()) {
      const aabb = v.getAabb();
      expect(aabb).toBeInstanceOf(BoundingBox);
      expect(aabb.min.x).toBeLessThanOrEqual(v.center.x);
      expect(v.center.x).toBeLessThanOrEqual(aabb.max.x);
      expect(aabb.min.y).toBeLessThanOrEqual(v.center.y);
      expect(v.center.y).toBeLessThanOrEqual(aabb.max.y);
      expect(aabb.min.z).toBeLessThanOrEqual(v.center.z);
      expect(v.center.z).toBeLessThanOrEqual(aabb.max.z);
    }
  });

  it("cloneEmpty() returns a distinct instance of the exact same concrete type", () => {
    for (const { v, type } of centeredOriginVolumes()) {
      const empty = v.cloneEmpty();
      expect(empty).not.toBe(v);
      expect(empty.type).toBe(type);
    }
  });

  it("volume() computes positive geometric volume per type", () => {
    const box = new BoundingBox(new Vector3D(0, 0, 0), new Vector3D(2, 2, 2));
    expect(box.volume()).toBeCloseTo(8, 6);

    const sphere = new BoundingSphere(new Vector3D(0, 0, 0), 2);
    expect(sphere.volume()).toBeCloseTo((4 / 3) * Math.PI * 8, 5);

    const obb = new OBB(new Vector3D(0, 0, 0), new Vector3D(2, 3, 4));
    expect(obb.volume()).toBeCloseTo(8 * 2 * 3 * 4, 6);

    // Unit-cube hull has dimensions 2x2x2.
    expect(makeUnitHull().volume()).toBeCloseTo(8, 4);
  });

  it("closestPoint() returns a surface point at the true distance for external queries", () => {
    const sphere = new BoundingSphere(new Vector3D(0, 0, 0), 1);
    const pSphere = sphere.closestPoint(new Vector3D(10, 0, 0));
    expect(pSphere.x).toBeCloseTo(1, 6);
    expect(pSphere.y).toBeCloseTo(0, 6);
    expect(pSphere.z).toBeCloseTo(0, 6);

    const box = new BoundingBox(new Vector3D(0, 0, 0), new Vector3D(2, 2, 2));
    const pBox = box.closestPoint(new Vector3D(5, 1, 1));
    expect(pBox.x).toBeCloseTo(2, 6);
    expect(pBox.y).toBeCloseTo(1, 6);
    expect(pBox.z).toBeCloseTo(1, 6);

    const obb = new OBB(new Vector3D(0, 0, 0), new Vector3D(1, 2, 3));
    const pObb = obb.closestPoint(new Vector3D(5, 0, 0));
    expect(pObb.x).toBeCloseTo(1, 6);
    expect(pObb.y).toBeCloseTo(0, 6);
    expect(pObb.z).toBeCloseTo(0, 6);

    const hull = makeUnitHull();
    const pHull = hull.closestPoint(new Vector3D(5, 0, 0));
    expect(Math.abs(pHull.x - 1)).toBeLessThan(1e-5);
    expect(pHull.x).toBeGreaterThanOrEqual(-1);
    expect(pHull.x).toBeLessThanOrEqual(1);
    expect(pHull.distanceTo(new Vector3D(5, 0, 0))).toBeCloseTo(4, 4);
  });

  it("closestPoint() of a point strictly inside returns a point on the surface", () => {
    const box = new BoundingBox(new Vector3D(0, 0, 0), new Vector3D(2, 2, 2));
    const p = box.closestPoint(new Vector3D(1, 1, 1));
    const onSurface = p.x === 0 || p.x === 2 || p.y === 0 || p.y === 2 || p.z === 0 || p.z === 2;
    expect(onSurface).toBe(true);
  });

  it("surfaceNormalAt() returns a unit-length outward normal", () => {
    const sphere = new BoundingSphere(new Vector3D(0, 0, 0), 1);
    const top = sphere.surfaceNormalAt(new Vector3D(0, 1, 0));
    expect(top.x).toBeCloseTo(0, 6);
    expect(top.y).toBeCloseTo(1, 6);
    expect(top.z).toBeCloseTo(0, 6);

    for (const { v } of centeredOriginVolumes()) {
      const n = v.surfaceNormalAt(v.closestPoint(new Vector3D(3, 3, 3)));
      const len = n.length();
      expect(len).toBeGreaterThan(0.9999);
      expect(len).toBeLessThan(1.0001);
      expect(Number.isFinite(n.x) && Number.isFinite(n.y) && Number.isFinite(n.z)).toBe(true);
    }
  });

  it("intersectsRay() reports true for a centered ray and false for a clear miss", () => {
    const hitRay = new Ray(new Vector3D(0, 0, 10), new Vector3D(0, 0, -1));
    const missRay = new Ray(new Vector3D(10, 10, 10), new Vector3D(-1, 0, 0));
    for (const { v } of centeredOriginVolumes()) {
      expect(v.intersectsRay(hitRay)).toBe(true);
      expect(v.intersectsRay(missRay)).toBe(false);
    }
  });

  it("translate() moves every volume by the offset", () => {
    const offset = new Vector3D(3, -2, 1);
    const volumes = centeredOriginVolumes();
    for (const { v } of volumes) {
      const before = v.center.clone();
      v.translate(offset);
      expect(v.center.x).toBeCloseTo(before.x + offset.x, 6);
      expect(v.center.y).toBeCloseTo(before.y + offset.y, 6);
      expect(v.center.z).toBeCloseTo(before.z + offset.z, 6);
    }

    // A translated box keeps its min/max consistent with the moved center.
    const box = new BoundingBox(new Vector3D(0, 0, 0), new Vector3D(2, 2, 2));
    box.translate(offset);
    expect(box.min.x).toBeCloseTo(offset.x, 6);
    expect(box.max.x).toBeCloseTo(offset.x + 2, 6);
    expect(box.center.x).toBeCloseTo(offset.x + 1, 6);
  });

  it("setFromLocal() + transform() places the volume at the configured world position", () => {
    const identity = new Matrix4();

    const box = new BoundingBox();
    box.setFromLocal(new Vector3D(3, 4, 5), new Vector3D(1, 2, 3));
    box.transform(identity);
    expect(box.center.x).toBeCloseTo(3, 6);
    expect(box.center.y).toBeCloseTo(4, 6);
    expect(box.center.z).toBeCloseTo(5, 6);
    expect(box.min.x).toBeCloseTo(2, 6);
    expect(box.max.x).toBeCloseTo(4, 6);

    const sphere = new BoundingSphere(new Vector3D(), 0);
    sphere.setFromLocal(new Vector3D(0, 2, 0), new Vector3D(3, 0, 0));
    sphere.transform(identity);
    expect(sphere.center.y).toBeCloseTo(2, 6);
    expect(sphere.radius).toBeCloseTo(3, 6);

    const obb = new OBB();
    obb.setFromLocal(new Vector3D(1, 1, 1), new Vector3D(1, 1, 1));
    obb.transform(identity);
    expect(obb.center.x).toBeCloseTo(1, 6);
    expect(obb.center.y).toBeCloseTo(1, 6);
    expect(obb.center.z).toBeCloseTo(1, 6);

    // A hull has no half-extent concept -- `setFromLocal` re-positions its centroid.
    const hull = makeUnitHull();
    hull.setFromLocal(new Vector3D(5, 0, 0), new Vector3D(0, 0, 0));
    hull.transform(identity);
    expect(hull.center.x).toBeCloseTo(5, 6);
    expect(hull.center.y).toBeCloseTo(0, 6);
    expect(hull.center.z).toBeCloseTo(0, 6);
  });
});
