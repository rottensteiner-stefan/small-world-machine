import { describe, it, expect } from "vitest";
import { Collision } from "../../src/physix/Collision.js";
import { BoundingBox } from "../../src/physix/BoundingBox.js";
import { BoundingSphere } from "../../src/physix/BoundingSphere.js";
import { OBB } from "../../src/physix/OBB.js";
import { Vector3D, Matrix4 } from "../../src/math/index.js";

describe("Collision", () => {
  it("should accurately detect Sphere-Sphere collisions", () => {
    const s1 = new BoundingSphere(new Vector3D(0, 0, 0), 1.0);
    const s2 = new BoundingSphere(new Vector3D(1.5, 0, 0), 1.0);
    const s3 = new BoundingSphere(new Vector3D(2.5, 0, 0), 1.0);

    expect(Collision.test(s1, s2)).toBe(true); // Distance 1.5 < 1+1
    expect(Collision.test(s1, s3)).toBe(false); // Distance 2.5 > 1+1
  });

  it("should accurately detect Box-Box collisions", () => {
    const b1 = new BoundingBox(new Vector3D(-1, -1, -1), new Vector3D(1, 1, 1));
    const b2 = new BoundingBox(new Vector3D(0.5, 0.5, 0.5), new Vector3D(2, 2, 2));
    const b3 = new BoundingBox(new Vector3D(2, 2, 2), new Vector3D(3, 3, 3));

    expect(Collision.test(b1, b2)).toBe(true);
    expect(Collision.test(b1, b3)).toBe(false);
  });

  it("should accurately detect Sphere-Box collisions", () => {
    const s = new BoundingSphere(new Vector3D(1.5, 0, 0), 1.0);
    const b = new BoundingBox(new Vector3D(-1, -1, -1), new Vector3D(1, 1, 1));

    // Distance from center (1.5,0,0) to box edge (1,0,0) is 0.5. Radius is 1. -> Intersect
    expect(Collision.test(s, b)).toBe(true);
    // Reverse test (Box-Sphere)
    expect(Collision.test(b, s)).toBe(true);

    s.center.set(3, 0, 0);
    expect(Collision.test(s, b)).toBe(false);
  });

  it("should handle OBB-OBB collisions using SAT", () => {
    const obb1 = new OBB();
    obb1.center.set(0, 0, 0);
    obb1.halfExtents.set(1, 1, 1);

    const obb2 = new OBB();
    obb2.center.set(1.5, 0, 0);
    // obb2.transform() is called below, so its half-extents must be set via
    // setLocalHalfExtents() -- transform() always derives `halfExtents` from the local
    // (unscaled) value, not from whatever was last poked into `halfExtents` directly.
    obb2.setLocalHalfExtents(1, 1, 1);

    // Axis-aligned, should intersect
    expect(Collision.test(obb1, obb2)).toBe(true);

    // Rotate obb2 by 45 degrees on Y.
    // Wait, let's just use transform
    const m = new Matrix4();
    Matrix4.rotateY(Math.PI / 4, m);
    m.data[12] = 2.5; // Translate X by 2.5
    obb2.transform(m);

    // Distance 2.5. Half extents 1 + 1*sqrt(2) approx 1 + 1.41 = 2.41. Should not intersect.
    expect(Collision.test(obb1, obb2)).toBe(false);

    // Move closer
    m.data[12] = 2.0;
    obb2.transform(m);
    expect(Collision.test(obb1, obb2)).toBe(true);
  });

  it("should resolve Sphere-Box collisions correctly", () => {
    const s = new BoundingSphere(new Vector3D(1.5, 0, 0), 1.0);
    const b = new BoundingBox(new Vector3D(-1, -1, -1), new Vector3D(1, 1, 1));
    const result = new Vector3D();

    const resolved = Collision.resolveSphereBox(s, b, result);
    expect(resolved).toBe(true);
    // Overlap = radius(1.0) - dist(0.5) = 0.5. Direction is X+.
    expect(result.x).toBeCloseTo(0.5);
    expect(result.y).toBe(0);
    expect(result.z).toBe(0);
  });

  it("should handle exact boundaries correctly (distance == sum of radii)", () => {
    const s1 = new BoundingSphere(new Vector3D(0, 0, 0), 1.0);
    const s2 = new BoundingSphere(new Vector3D(2.0, 0, 0), 1.0); // Exact boundary

    // According to Collision._sphereSphere: d2 <= r2. So 4 <= 4 is true.
    expect(Collision.test(s1, s2)).toBe(true);

    s2.center.set(2.0001, 0, 0); // Barely separated
    expect(Collision.test(s1, s2)).toBe(false);
  });

  it("should handle exact boundaries for Box-Box", () => {
    const b1 = new BoundingBox(new Vector3D(0, 0, 0), new Vector3D(1, 1, 1));
    const b2 = new BoundingBox(new Vector3D(1, 0, 0), new Vector3D(2, 1, 1)); // Touching on X=1

    // Box vs Box uses >= and <=. 1 <= 2 && 1 >= 1. Should be true.
    expect(Collision.test(b1, b2)).toBe(true);

    b2.min.x = 1.0001; // Barely separated
    expect(Collision.test(b1, b2)).toBe(false);
  });

  it("should resolve Box-Box collisions along the axis of least penetration", () => {
    const b1 = new BoundingBox(new Vector3D(-1, -1, -1), new Vector3D(1, 1, 1));
    const b2 = new BoundingBox(new Vector3D(0.5, -1, -1), new Vector3D(2.5, 1, 1));
    const result = new Vector3D();

    const resolved = Collision.resolveBoxBox(b1, b2, result);
    expect(resolved).toBe(true);
    // Overlap on X is 0.5 (from x=0.5 to x=1), Y/Z fully overlap (2.0). X is the least penetration axis.
    // b1.center.x(0) - b2.center.x(1.5) < 0, so b1 is pushed further negative.
    expect(result.x).toBeCloseTo(-0.5);
    expect(result.y).toBe(0);
    expect(result.z).toBe(0);
  });

  it("should return false for non-overlapping Box-Box", () => {
    const b1 = new BoundingBox(new Vector3D(-1, -1, -1), new Vector3D(1, 1, 1));
    const b2 = new BoundingBox(new Vector3D(3, -1, -1), new Vector3D(5, 1, 1));
    const result = new Vector3D();

    expect(Collision.resolveBoxBox(b1, b2, result)).toBe(false);
  });

  it("should handle Sphere-Box center exactly inside the box", () => {
    const s = new BoundingSphere(new Vector3D(0, 0, 0), 1.0);
    const b = new BoundingBox(new Vector3D(-1, -1, -1), new Vector3D(1, 1, 1));
    const result = new Vector3D();

    const resolved = Collision.resolveSphereBox(s, b, result);
    expect(resolved).toBe(true);
    // Depth should be 1.0 (radius) along the axis of least penetration
    // Wait, the least penetration distance from center to bounds.
    // Center is 0, bounds are -1, 1. Distance to edge is 1. Radius is 1. Overlap = radius + distance = 2.
    // Let's check resolveSphereBox logic. If center is EXACTLY inside, it pushes along least penetration.
    expect(Math.abs(result.x) + Math.abs(result.y) + Math.abs(result.z)).toBeCloseTo(2.0);
  });

  it("should accurately detect and resolve Box-OBB collisions", () => {
    const b = new BoundingBox(new Vector3D(-1, -1, -1), new Vector3D(1, 1, 1));
    const obb = new OBB();
    obb.center.set(1.5, 0, 0);
    obb.halfExtents.set(1, 1, 1);

    expect(Collision.test(b, obb)).toBe(true);
    expect(Collision.test(obb, b)).toBe(true);

    const result = new Vector3D();
    const resolved = Collision.resolveBoxObb(b, obb, result);
    expect(resolved).toBe(true);
    // Overlap is 0.5. result points from obb to b, so towards -X.
    expect(result.x).toBeCloseTo(-0.5);
    expect(result.y).toBeCloseTo(0);
    expect(result.z).toBeCloseTo(0);

    obb.center.set(5, 0, 0);
    expect(Collision.test(b, obb)).toBe(false);
  });

  it("should accurately detect Sphere-OBB collisions", () => {
    const s = new BoundingSphere(new Vector3D(1.5, 0, 0), 1.0);
    const obb = new OBB();
    obb.center.set(0, 0, 0);
    obb.halfExtents.set(1, 1, 1);

    // Same geometry as the axis-aligned Sphere-Box test: distance to face is 0.5, radius 1 -> intersect.
    expect(Collision.test(s, obb)).toBe(true);
    // Reverse order (OBB-Sphere)
    expect(Collision.test(obb, s)).toBe(true);

    s.center.set(3, 0, 0);
    expect(Collision.test(s, obb)).toBe(false);
  });

  it("should resolve Sphere-OBB collisions correctly", () => {
    const s = new BoundingSphere(new Vector3D(1.5, 0, 0), 1.0);
    const obb = new OBB();
    obb.center.set(0, 0, 0);
    obb.halfExtents.set(1, 1, 1);
    const result = new Vector3D();

    const resolved = Collision.resolveSphereObb(s, obb, result);
    expect(resolved).toBe(true);
    // Axis-aligned OBB with these values behaves identically to resolveSphereBox's test above.
    expect(result.x).toBeCloseTo(0.5);
    expect(result.y).toBeCloseTo(0);
    expect(result.z).toBeCloseTo(0);
  });

  it("should handle Sphere-OBB center exactly inside the OBB", () => {
    const s = new BoundingSphere(new Vector3D(0, 0, 0), 1.0);
    const obb = new OBB();
    obb.center.set(0, 0, 0);
    obb.halfExtents.set(1, 1, 1);
    const result = new Vector3D();

    const resolved = Collision.resolveSphereObb(s, obb, result);
    expect(resolved).toBe(true);
    expect(Math.abs(result.x) + Math.abs(result.y) + Math.abs(result.z)).toBeCloseTo(2.0);
  });

  it("should resolve OBB-OBB collisions via the minimum-translation vector", () => {
    const obb1 = new OBB();
    obb1.center.set(0, 0, 0);
    obb1.halfExtents.set(1, 1, 1);

    const obb2 = new OBB();
    obb2.center.set(1.5, 0, 0);
    obb2.halfExtents.set(1, 1, 1);

    const result = new Vector3D();
    const resolved = Collision.resolveObbObb(obb1, obb2, result);
    expect(resolved).toBe(true);
    // Same axis-aligned geometry as the Box-Box MTV test: overlap 0.5 on X, obb1 pushed toward -X.
    expect(result.x).toBeCloseTo(-0.5);
    expect(result.y).toBeCloseTo(0);
    expect(result.z).toBeCloseTo(0);
  });

  it("should return false for non-overlapping OBB-OBB", () => {
    const obb1 = new OBB();
    obb1.center.set(0, 0, 0);
    obb1.halfExtents.set(1, 1, 1);

    const obb2 = new OBB();
    obb2.center.set(5, 0, 0);
    obb2.halfExtents.set(1, 1, 1);

    const result = new Vector3D();
    expect(Collision.resolveObbObb(obb1, obb2, result)).toBe(false);
  });

  describe("CCD sweeps", () => {
    it("should find the earliest time-of-impact for a sphere sweeping through a static sphere", () => {
      const s = new BoundingSphere(new Vector3D(10, 0, 0), 1.0);
      // Moving sphere starts far left and travels 20 units along +X, radius 1.
      // Combined radius is 2, so contact happens when centers are 2 apart: at x=8, i.e. t=8/20=0.4.
      const toi = Collision.sweepSphereSphere(
        new Vector3D(0, 0, 0),
        new Vector3D(20, 0, 0),
        1.0,
        s,
      );
      expect(toi).toBeCloseTo(0.4);
    });

    it("should return -1 for a sphere sweep that misses entirely", () => {
      const s = new BoundingSphere(new Vector3D(10, 5, 0), 1.0);
      const toi = Collision.sweepSphereSphere(
        new Vector3D(0, 0, 0),
        new Vector3D(20, 0, 0),
        1.0,
        s,
      );
      expect(toi).toBe(-1);
    });

    it("should leave a sphere sweep that already overlaps and moves away to the discrete resolver (-1)", () => {
      const s = new BoundingSphere(new Vector3D(0.5, 0, 0), 1.0);
      const toi = Collision.sweepSphereSphere(
        new Vector3D(0, 0, 0),
        new Vector3D(-5, 0, 0),
        1.0,
        s,
      );
      expect(toi).toBe(-1);
    });

    it("should return TOI 0 for a sphere sweep that already overlaps and is driven deeper", () => {
      // Replaces the old "overlap -> -1" pin: that let residual penetration tunnel through.
      const s = new BoundingSphere(new Vector3D(0.5, 0, 0), 1.0);
      const toi = Collision.sweepSphereSphere(new Vector3D(0, 0, 0), new Vector3D(5, 0, 0), 1.0, s);
      expect(toi).toBe(0);
    });

    it("should find the earliest time-of-impact for a sphere sweeping through a static box", () => {
      const b = new BoundingBox(new Vector3D(9, -1, -1), new Vector3D(11, 1, 1));
      // Box face expanded by radius 1 sits at x=8; sphere travels from x=0 to x=20.
      const toi = Collision.sweepSphereBox(new Vector3D(0, 0, 0), new Vector3D(20, 0, 0), 1.0, b);
      expect(toi).toBeCloseTo(0.4);
    });

    it("should return -1 for a sphere sweep that passes over a box (no overlap on other axes)", () => {
      const b = new BoundingBox(new Vector3D(9, -1, -1), new Vector3D(11, 1, 1));
      const toi = Collision.sweepSphereBox(new Vector3D(0, 5, 0), new Vector3D(20, 0, 0), 1.0, b);
      expect(toi).toBe(-1);
    });

    it("should find the earliest time-of-impact for a sphere sweeping through a rotated OBB", () => {
      const obb = new OBB();
      obb.center.set(10, 0, 0);
      // obb.transform() is called below, so half-extents must be set via setLocalHalfExtents().
      obb.setLocalHalfExtents(1, 1, 1);
      // A 45-degree Y rotation widens the cube's silhouette along the sweep axis (the diagonal is
      // longer than a face), so contact happens somewhere before the axis-aligned box case above --
      // just assert it's a genuine, in-range hit rather than pinning an exact value.
      const m = new Matrix4();
      Matrix4.rotateY(Math.PI / 4, m);
      m.data[12] = 10;
      obb.transform(m);

      const toi = Collision.sweepSphereObb(new Vector3D(0, 0, 0), new Vector3D(20, 0, 0), 1.0, obb);
      expect(toi).toBeGreaterThan(0);
      expect(toi).toBeLessThan(1);
    });

    it("should return -1 when the sweeping sphere isn't moving", () => {
      const s = new BoundingSphere(new Vector3D(10, 0, 0), 1.0);
      const toi = Collision.sweepSphereSphere(new Vector3D(0, 0, 0), new Vector3D(0, 0, 0), 1.0, s);
      expect(toi).toBe(-1);
    });
  });
});
