import { describe, it, expect } from "vitest";
import { Collision } from "../../src/physix/Collision.js";
import { ConvexHull } from "../../src/physix/ConvexHull.js";
import { BoundingBox } from "../../src/physix/BoundingBox.js";
import { BoundingSphere } from "../../src/physix/BoundingSphere.js";
import { OBB } from "../../src/physix/OBB.js";
import { Vector3D, Matrix4 } from "../../src/math/index.js";

/**
 * Builds an axis-aligned box ConvexHull (local-space, centered at the origin
 * unless later repositioned via `.transform()`), matching the same 6-face
 * winding convention `VoronoiCells`' box-clipping uses.
 */
function makeBoxHull(center: Vector3D, halfExtents: Vector3D): ConvexHull {
  const { x: cx, y: cy, z: cz } = center;
  const { x: hx, y: hy, z: hz } = halfExtents;
  const v = [
    new Vector3D(cx - hx, cy - hy, cz - hz), // 0
    new Vector3D(cx + hx, cy - hy, cz - hz), // 1
    new Vector3D(cx + hx, cy + hy, cz - hz), // 2
    new Vector3D(cx - hx, cy + hy, cz - hz), // 3
    new Vector3D(cx - hx, cy - hy, cz + hz), // 4
    new Vector3D(cx + hx, cy - hy, cz + hz), // 5
    new Vector3D(cx + hx, cy + hy, cz + hz), // 6
    new Vector3D(cx - hx, cy + hy, cz + hz), // 7
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

describe("Collision (ConvexHull)", () => {
  it("builds a box hull with 8 vertices, 6 face normals, 3 unique edge directions", () => {
    const hull = makeBoxHull(new Vector3D(0, 0, 0), new Vector3D(1, 1, 1));
    expect(hull.vertices.length).toBe(8);
    expect(hull.faceNormals.length).toBe(6);
    expect(hull.edgeDirections.length).toBe(3);
  });

  it("matches Box-Box/OBB-OBB detection for equivalent axis-aligned geometry", () => {
    const h1 = makeBoxHull(new Vector3D(0, 0, 0), new Vector3D(1, 1, 1));
    const h2 = makeBoxHull(new Vector3D(1.5, 0, 0), new Vector3D(1, 1, 1));
    expect(Collision.test(h1, h2)).toBe(true);

    const h3 = makeBoxHull(new Vector3D(5, 0, 0), new Vector3D(1, 1, 1));
    expect(Collision.test(h1, h3)).toBe(false);
  });

  it("matches OBB-OBB's minimum-translation-vector for equivalent axis-aligned geometry", () => {
    const h1 = makeBoxHull(new Vector3D(0, 0, 0), new Vector3D(1, 1, 1));
    const h2 = makeBoxHull(new Vector3D(1.5, 0, 0), new Vector3D(1, 1, 1));
    const result = new Vector3D();

    const resolved = Collision.resolveHullHull(h1, h2, result);
    expect(resolved).toBe(true);
    // Same axis-aligned geometry as the OBB-OBB MTV test: overlap 0.5 on X, h1 pushed toward -X.
    expect(result.x).toBeCloseTo(-0.5);
    expect(result.y).toBeCloseTo(0);
    expect(result.z).toBeCloseTo(0);
  });

  it("detects a separating axis only reachable via edge-edge cross products (rotated hull)", () => {
    // Mirrors the OBB-OBB rotated test exactly: only the 9 edge-cross-product axes
    // (not the 3+3 face-normal axes alone) can prove separation here.
    const h1 = makeBoxHull(new Vector3D(0, 0, 0), new Vector3D(1, 1, 1));
    const local = makeBoxHull(new Vector3D(0, 0, 0), new Vector3D(1, 1, 1));

    const m = new Matrix4();
    Matrix4.rotateY(Math.PI / 4, m);
    m.data[12] = 2.5;
    local.transform(m);
    expect(Collision.test(h1, local)).toBe(false);

    m.data[12] = 2.0;
    local.transform(m);
    expect(Collision.test(h1, local)).toBe(true);
  });

  it("matches Sphere-Box's resolution for equivalent geometry", () => {
    const hull = makeBoxHull(new Vector3D(0, 0, 0), new Vector3D(1, 1, 1));
    const s = new BoundingSphere(new Vector3D(1.5, 0, 0), 1.0);
    const result = new Vector3D();

    const resolved = Collision.resolveHullSphere(hull, s, result);
    expect(resolved).toBe(true);
    // Same overlap (0.5) as resolveSphereBox's equivalent test, but the opposite sign:
    // resolveHullSphere(hull, sphere, ...) points towards its *first* parameter (the
    // hull, at x=0) rather than towards the sphere (at x=1.5), i.e. -X here.
    expect(result.x).toBeCloseTo(-0.5);
    expect(result.y).toBeCloseTo(0);
    expect(result.z).toBeCloseTo(0);

    s.center.set(3, 0, 0);
    expect(Collision.test(hull, s)).toBe(false);
  });

  it("matches Sphere-Box's degenerate center-exactly-inside depth", () => {
    const hull = makeBoxHull(new Vector3D(0, 0, 0), new Vector3D(1, 1, 1));
    const s = new BoundingSphere(new Vector3D(0, 0, 0), 1.0);
    const result = new Vector3D();

    const resolved = Collision.resolveHullSphere(hull, s, result);
    expect(resolved).toBe(true);
    // Same accepted depth convention as resolveSphereBox's equivalent test.
    expect(Math.abs(result.x) + Math.abs(result.y) + Math.abs(result.z)).toBeCloseTo(2.0);
  });

  it("matches Box-OBB's detection/resolution for a hull-vs-box pair", () => {
    const hull = makeBoxHull(new Vector3D(0, 0, 0), new Vector3D(1, 1, 1));
    const box = new BoundingBox(new Vector3D(0.5, -1, -1), new Vector3D(2.5, 1, 1));
    const result = new Vector3D();

    expect(Collision.test(hull, box)).toBe(true);
    expect(Collision.test(box, hull)).toBe(true);

    const resolved = Collision.resolveHullBox(hull, box, result);
    expect(resolved).toBe(true);
    expect(result.x).toBeCloseTo(-0.5);
    expect(result.y).toBeCloseTo(0);
    expect(result.z).toBeCloseTo(0);
  });

  it("matches Box-OBB's detection/resolution for a hull-vs-obb pair", () => {
    const hull = makeBoxHull(new Vector3D(0, 0, 0), new Vector3D(1, 1, 1));
    const obb = new OBB();
    obb.center.set(1.5, 0, 0);
    obb.halfExtents.set(1, 1, 1);
    const result = new Vector3D();

    expect(Collision.test(hull, obb)).toBe(true);
    expect(Collision.test(obb, hull)).toBe(true);

    const resolved = Collision.resolveHullObb(hull, obb, result);
    expect(resolved).toBe(true);
    expect(result.x).toBeCloseTo(-0.5);
    expect(result.y).toBeCloseTo(0);
    expect(result.z).toBeCloseTo(0);

    obb.center.set(5, 0, 0);
    expect(Collision.test(hull, obb)).toBe(false);
  });

  it("keeps ConvexHull's transform() re-deriving from local space, not accumulating", () => {
    const hull = makeBoxHull(new Vector3D(0, 0, 0), new Vector3D(1, 1, 1));
    const m = new Matrix4();
    m.data[12] = 3;
    hull.transform(m);
    expect(hull.center.x).toBeCloseTo(3);
    m.data[12] = 1;
    hull.transform(m);
    expect(hull.center.x).toBeCloseTo(1);
  });

  it("hull and OBB SAT agree on the MTV of a slightly tilted resting stack (shared parallel-edge cut-off)", () => {
    for (const tilt of [0, 0.002, 0.004, 0.02]) {
      const place = new Matrix4().compose(
        new Vector3D(0, 1.9, 0),
        new Vector3D(0, 0, tilt),
        new Vector3D(1, 1, 1),
      );
      const hullA = makeBoxHull(new Vector3D(0, 0, 0), new Vector3D(1, 1, 1));
      const hullB = makeBoxHull(new Vector3D(0, 0, 0), new Vector3D(1, 1, 1));
      hullB.transform(place);
      const obbA = new OBB(new Vector3D(0, 0, 0), new Vector3D(1, 1, 1));
      const obbB = new OBB(new Vector3D(0, 0, 0), new Vector3D(1, 1, 1));
      obbA.transform(new Matrix4());
      obbB.transform(place);

      const hullMtv = new Vector3D();
      const obbMtv = new Vector3D();
      expect(Collision.resolve(hullB, hullA, hullMtv)).toBe(true);
      expect(Collision.resolve(obbB, obbA, obbMtv)).toBe(true);
      // Both push the upper box up by ~0.1; no sideways component from a noisy edge axis.
      expect(hullMtv.y).toBeGreaterThan(0.05);
      expect(Math.abs(hullMtv.x)).toBeLessThan(1e-3);
      expect(Math.abs(hullMtv.z)).toBeLessThan(1e-3);
      expect(hullMtv.y).toBeCloseTo(obbMtv.y, 2);
    }
  });
});
