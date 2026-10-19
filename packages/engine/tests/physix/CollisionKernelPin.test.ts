import { describe, expect, it } from "vitest";
import { Collision } from "../../src/physix/Collision.js";
import { OBB } from "../../src/physix/OBB.js";
import { BoundingBox } from "../../src/physix/BoundingBox.js";
import { BoundingSphere } from "../../src/physix/BoundingSphere.js";
import { ConvexHull } from "../../src/physix/ConvexHull.js";
import { Vector3D } from "../../src/math/index.js";

/**
 * Kernel-pin suite for the Collision-Kern split. Every expected value below was captured
 * from the pre-split `Collision.ts` (same inputs, full double precision) and MUST stay
 * byte-for-byte identical after the file is decomposed into the sweep kernel, the OBB-SAT
 * kernel and `CollisionHull.ts`. A deviation here means the split changed physics behavior,
 * not an allowed tolerance.
 */

/** Axis-aligned box ConvexHull, same winding as used across physix tests. */
function boxHull(center: Vector3D, halfExtents: Vector3D): ConvexHull {
  const { x: cx, y: cy, z: cz } = center;
  const { x: hx, y: hy, z: hz } = halfExtents;
  const v = [
    new Vector3D(cx - hx, cy - hy, cz - hz),
    new Vector3D(cx + hx, cy - hy, cz - hz),
    new Vector3D(cx + hx, cy + hy, cz - hz),
    new Vector3D(cx - hx, cy + hy, cz - hz),
    new Vector3D(cx - hx, cy - hy, cz + hz),
    new Vector3D(cx + hx, cy - hy, cz + hz),
    new Vector3D(cx + hx, cy + hy, cz + hz),
    new Vector3D(cx - hx, cy + hy, cz + hz),
  ];
  const faces = [
    [0, 3, 2, 1],
    [4, 5, 6, 7],
    [0, 1, 5, 4],
    [3, 7, 6, 2],
    [0, 4, 7, 3],
    [1, 2, 6, 5],
  ];
  return new ConvexHull(v, faces);
}

/** Asserts exactly zero (either zero sign; `toBe()` on 0 fails for -0 via Object.is). */
function expectZero(v: number): void {
  expect(v === 0).toBe(true);
}

describe("Collision kernel pins (pre-split baselines)", () => {
  it("OBB-SAT: resolveObbObb / resolveSphereObb / resolveBoxObb MTVs", () => {
    const out = new Vector3D();

    const a = new OBB(new Vector3D(0, 0, 0), new Vector3D(1, 1, 1));
    const b = new OBB(new Vector3D(1.5, 0, 0), new Vector3D(1, 1, 1));
    expect(Collision.resolveObbObb(a, b, out)).toBe(true);
    expect(out.x).toBe(-0.5);
    expectZero(out.y);
    expectZero(out.z);
    expect(Collision.test(a, new OBB(new Vector3D(5, 0, 0), new Vector3D(1, 1, 1)))).toBe(false);

    out.set(0, 0, 0);
    const s = new BoundingSphere(new Vector3D(0.5, 0, 0), 0.5);
    expect(Collision.resolveSphereObb(s, b, out)).toBe(true);
    expect(out.x).toBe(-0.5);
    expectZero(out.y);
    expectZero(out.z);

    const bx = new BoundingBox(new Vector3D(0, 0, 0), new Vector3D(2, 2, 2));
    const obb2 = new OBB(new Vector3D(2.5, 0, 0), new Vector3D(1, 1, 1));
    out.set(0, 0, 0);
    expect(Collision.resolveBoxObb(bx, obb2, out)).toBe(true);
    expect(out.x).toBe(-0.5);
    expectZero(out.y);
    expectZero(out.z);
    expect(Collision.test(bx, obb2)).toBe(true);
  });

  it("hull SAT: resolveHullHull / resolveHullBox / resolveHullObb / resolveHullSphere MTVs", () => {
    const out = new Vector3D();

    const hA = boxHull(new Vector3D(0, 0, 0), new Vector3D(1, 1, 1));
    const hB = boxHull(new Vector3D(1.5, 0, 0), new Vector3D(1, 1, 1));
    expect(Collision.resolveHullHull(hA, hB, out)).toBe(true);
    expect(out.x).toBe(-0.5);
    expectZero(out.y);
    expectZero(out.z);
    expect(Collision.test(hA, boxHull(new Vector3D(5, 0, 0), new Vector3D(1, 1, 1)))).toBe(false);

    out.set(0, 0, 0);
    const bx = new BoundingBox(new Vector3D(0.5, -1, -1), new Vector3D(2.5, 1, 1));
    expect(Collision.resolveHullBox(hA, bx, out)).toBe(true);
    expect(out.x).toBe(-0.5);
    expectZero(out.y);
    expectZero(out.z);
    expect(Collision.test(hA, bx)).toBe(true);

    out.set(0, 0, 0);
    const hA2 = boxHull(new Vector3D(0, 0, 0), new Vector3D(1, 1, 1));
    const obb = new OBB(new Vector3D(1.5, 0, 0), new Vector3D(1, 1, 1));
    expect(Collision.resolveHullObb(hA2, obb, out)).toBe(true);
    expect(out.x).toBe(-0.5);
    expectZero(out.y);
    expectZero(out.z);
    expect(Collision.test(hA2, obb)).toBe(true);

    out.set(0, 0, 0);
    const hull = boxHull(new Vector3D(0, 0, 0), new Vector3D(1, 1, 1));
    const s = new BoundingSphere(new Vector3D(1.5, 0, 0), 0.75);
    expect(Collision.resolveHullSphere(hull, s, out)).toBe(true);
    expect(out.x).toBe(-0.25);
    expectZero(out.y);
    expectZero(out.z);
    expect(Collision.test(hull, s)).toBe(true);
  });

  it("resolve() dispatch routes to the same MTV as the specific resolvers", () => {
    const out = new Vector3D();
    const ra = new OBB(new Vector3D(0, 0, 0), new Vector3D(1, 1, 1));
    const rb = new OBB(new Vector3D(1.5, 0, 0), new Vector3D(1, 1, 1));
    expect(Collision.resolve(ra, rb, out)).toBe(true);
    expect(out.x).toBe(-0.5);
    expectZero(out.y);
    expectZero(out.z);
  });

  it("sweep kernel: TOIs for every pair class are byte-identical", () => {
    expect(
      Collision.sweepSphereSphere(
        new Vector3D(0, 0, 5),
        new Vector3D(0, 0, -10),
        0.5,
        new BoundingSphere(new Vector3D(0, 0, 0), 0.5),
      ),
    ).toBe(0.4);
    expect(
      Collision.sweepSphereBox(
        new Vector3D(0, 0, 5),
        new Vector3D(0, 0, -10),
        0.5,
        new BoundingBox(new Vector3D(-0.3, -0.3, -0.3), new Vector3D(0.3, 0.3, 0.3)),
      ),
    ).toBe(0.42000000000000004);
    expect(
      Collision.sweepSphereObb(
        new Vector3D(0, 0, 5),
        new Vector3D(0, 0, -10),
        0.5,
        new OBB(new Vector3D(0, 0, 0), new Vector3D(0.3, 0.3, 0.3)),
      ),
    ).toBe(0.42000000000000004);
    expect(
      Collision.sweepBoxBox(
        new Vector3D(0, 0, 5),
        new Vector3D(0, 0, -10),
        new Vector3D(0.25, 0.25, 0.25),
        new BoundingBox(new Vector3D(-0.3, -0.3, -0.3), new Vector3D(0.3, 0.3, 0.3)),
      ),
    ).toBe(0.44500000000000006);
    expect(
      Collision.sweepObbObb(
        new Vector3D(0, 0, 5),
        new Vector3D(0, 0, -10),
        new OBB(new Vector3D(0, 0, 0), new Vector3D(0.25, 0.25, 0.25)),
        new OBB(new Vector3D(0, 0, 0), new Vector3D(0.3, 0.3, 0.3)),
      ),
    ).toBe(0.44500000000000006);
    expect(
      Collision.sweepRayVolume(
        new Vector3D(0, 0, 5),
        new Vector3D(0, 0, -10),
        new BoundingSphere(new Vector3D(0, 0, 0), 0.5),
      ),
    ).toBe(0.45);
  });

  it("sweep() dispatch (3-arg and 4-arg) reaches the identical TOIs", () => {
    expect(
      Collision.sweep(
        new BoundingSphere(new Vector3D(0, 0, 0), 0.5),
        new Vector3D(0, 0, 5),
        new Vector3D(0, 0, -10),
        new BoundingSphere(new Vector3D(0, 0, 1), 0.5),
      ),
    ).toBe(0.3);
    expect(
      Collision.sweep(
        new BoundingSphere(new Vector3D(0, 0, 5), 0.5),
        new Vector3D(0, 0, -10),
        new BoundingSphere(new Vector3D(0, 0, 0), 0.5),
      ),
    ).toBe(0.4);
  });
});
