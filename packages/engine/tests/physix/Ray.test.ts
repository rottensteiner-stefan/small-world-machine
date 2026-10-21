import { describe, it, expect } from "vitest";
import { Ray } from "../../src/physix/Ray.js";
import { BoundingBox } from "../../src/physix/BoundingBox.js";
import { BoundingSphere } from "../../src/physix/BoundingSphere.js";
import { OBB } from "../../src/physix/OBB.js";
import { ConvexHull } from "../../src/physix/ConvexHull.js";
import { Vector3D } from "../../src/math/index.js";

describe("Ray", () => {
  it("should find the intersection distance for a ray hitting a box", () => {
    const ray = new Ray(new Vector3D(0, 0, 0), new Vector3D(1, 0, 0));
    const box = new BoundingBox(new Vector3D(5, -1, -1), new Vector3D(7, 1, 1));
    expect(ray.intersectsBox(box)).toBeCloseTo(5);
  });

  it("should return -1 for a ray missing a box", () => {
    const ray = new Ray(new Vector3D(0, 0, 0), new Vector3D(1, 0, 0));
    const box = new BoundingBox(new Vector3D(5, 5, 5), new Vector3D(7, 7, 7));
    expect(ray.intersectsBox(box)).toBe(-1);
  });

  it("should find the nearest intersection distance for a ray hitting a sphere", () => {
    const ray = new Ray(new Vector3D(0, 0, 0), new Vector3D(1, 0, 0));
    const sphere = new BoundingSphere(new Vector3D(10, 0, 0), 1.0);
    // Ray enters the sphere at x=9 (10 units away, minus the radius).
    expect(ray.intersectsSphere(sphere)).toBeCloseTo(9);
  });

  it("should return -1 for a ray missing a sphere", () => {
    const ray = new Ray(new Vector3D(0, 0, 0), new Vector3D(1, 0, 0));
    const sphere = new BoundingSphere(new Vector3D(10, 5, 0), 1.0);
    expect(ray.intersectsSphere(sphere)).toBe(-1);
  });

  it("should return the exit-point distance when the ray origin starts inside a sphere", () => {
    const ray = new Ray(new Vector3D(0, 0, 0), new Vector3D(1, 0, 0));
    const sphere = new BoundingSphere(new Vector3D(0, 0, 0), 2.0);
    // Origin is inside the sphere, so the near root (t1) is negative -- the ray should
    // still report the far/exit root instead of claiming no intersection.
    expect(ray.intersectsSphere(sphere)).toBeCloseTo(2);
  });

  it("should return -1 for a sphere entirely behind the ray's origin", () => {
    const ray = new Ray(new Vector3D(0, 0, 0), new Vector3D(1, 0, 0));
    const sphere = new BoundingSphere(new Vector3D(-10, 0, 0), 1.0);
    expect(ray.intersectsSphere(sphere)).toBe(-1);
  });

  describe("intersectsOBB [MIN-05]", () => {
    it("should find the intersection distance for an unrotated OBB", () => {
      const ray = new Ray(new Vector3D(0, 0, 0), new Vector3D(1, 0, 0));
      const obb = new OBB(new Vector3D(10, 0, 0), new Vector3D(1, 1, 1));
      expect(ray.intersectsOBB(obb)).toBeCloseTo(9);
    });

    it("should return -1 for a ray missing an OBB", () => {
      const ray = new Ray(new Vector3D(0, 0, 0), new Vector3D(1, 0, 0));
      const obb = new OBB(new Vector3D(10, 5, 0), new Vector3D(1, 1, 1));
      expect(ray.intersectsOBB(obb)).toBe(-1);
    });

    it("should intersect rotated OBB correctly", () => {
      const ray = new Ray(new Vector3D(0, 0, 0), new Vector3D(0, 0, 1));
      const obb = new OBB(new Vector3D(0, 0, 10), new Vector3D(1, 1, 1));
      // Rotate 45 deg around Y
      const cos45 = Math.SQRT1_2;
      obb.axes[0].set(cos45, 0, cos45);
      obb.axes[2].set(-cos45, 0, cos45);
      expect(ray.intersectsOBB(obb)).toBeGreaterThan(0);
      expect(ray.intersectsOBB(obb)).toBeLessThan(10);
    });
  });

  describe("convex hull targets", () => {
    function cubeHull(): ConvexHull {
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
      const f = [
        [0, 3, 2, 1],
        [4, 5, 6, 7],
        [0, 1, 5, 4],
        [3, 7, 6, 2],
        [0, 4, 7, 3],
        [1, 2, 6, 5],
      ];
      return new ConvexHull(v, f);
    }

    it("intersectVolume returns the entry distance for a hull (was silently -1)", () => {
      const ray = new Ray(new Vector3D(0, 0, 10), new Vector3D(0, 0, -1));
      expect(ray.intersectVolume(cubeHull())).toBeCloseTo(9, 6);
      const miss = new Ray(new Vector3D(5, 5, 10), new Vector3D(0, 0, -1));
      expect(miss.intersectVolume(cubeHull())).toBe(-1);
    });

    it("a ray starting inside a hull reports the exit distance like the other volumes", () => {
      const ray = new Ray(new Vector3D(0, 0, 0), new Vector3D(1, 0, 0));
      expect(ray.intersectVolume(cubeHull())).toBeCloseTo(1, 6);
    });

    it("intersectVolumeDetailed gives hit point and outward normal on a hull", () => {
      const ray = new Ray(new Vector3D(0.2, 5, 0.1), new Vector3D(0, -1, 0));
      const pt = new Vector3D();
      const n = new Vector3D();
      const t = ray.intersectVolumeDetailed(cubeHull(), pt, n);
      expect(t).toBeCloseTo(4, 6);
      expect(pt.y).toBeCloseTo(1, 6);
      expect(n.y).toBeCloseTo(1, 6);
      expect(n.x).toBeCloseTo(0, 6);
    });
  });
});
