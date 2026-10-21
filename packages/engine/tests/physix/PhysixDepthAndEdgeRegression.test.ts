import { describe, expect, it } from "vitest";
import { Collision } from "../../src/physix/Collision.js";
import { ConvexHull } from "../../src/physix/ConvexHull.js";
import { BoundingBox } from "../../src/physix/BoundingBox.js";
import { BoundingSphere } from "../../src/physix/BoundingSphere.js";
import { Vector3D } from "../../src/math/index.js";

function cubeHull(half: number): ConvexHull {
  const h = half;
  const v = [
    new Vector3D(-h, -h, -h),
    new Vector3D(h, -h, -h),
    new Vector3D(h, h, -h),
    new Vector3D(-h, h, -h),
    new Vector3D(-h, -h, h),
    new Vector3D(h, -h, h),
    new Vector3D(h, h, h),
    new Vector3D(-h, h, h),
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

describe("penetration depth under containment (MTV = shorter way out)", () => {
  it("box-box: a thin plate inside a tall box is pushed out by its true depth, not its thickness", () => {
    const plate = new BoundingBox(new Vector3D(-5, 4.9, -5), new Vector3D(5, 5.1, 5));
    const tall = new BoundingBox(new Vector3D(-1, 0, -1), new Vector3D(1, 10, 1));
    const result = new Vector3D();
    expect(Collision.resolveBoxBox(plate, tall, result)).toBe(true);
    // The interval-intersection width would give 0.2 here: far too little to get out.
    expect(Math.abs(result.y)).toBeCloseTo(5.1, 6);
    expect(result.x).toBe(0);
    expect(result.z).toBe(0);
  });

  it("box-box: partial overlap still resolves by the overlap width, towards the right side", () => {
    const a = new BoundingBox(new Vector3D(0, 0, 0), new Vector3D(2, 2, 2));
    const b = new BoundingBox(new Vector3D(1.5, 0, 0), new Vector3D(4, 2, 2));
    const result = new Vector3D();
    expect(Collision.resolveBoxBox(a, b, result)).toBe(true);
    expect(result.x).toBeCloseTo(-0.5, 9);
  });

  it("hull-hull: a small cube deep inside a big cube reports a depth of more than its own size", () => {
    const big = cubeHull(5);
    const small = cubeHull(0.5);
    const result = new Vector3D();
    expect(Collision.resolveHullHull(small, big, result)).toBe(true);
    // Shortest way out for the small cube (width 1) is 5 + 0.5 = 5.5 along an axis.
    expect(result.length()).toBeGreaterThan(5);
  });
});

describe("hull vs sphere near an edge", () => {
  it("does not report a phantom contact for a sphere that is clear of the edge", () => {
    const cube = cubeHull(1);
    // Distance to the edge x = y = 1 is sqrt(0.4^2 + 0.4^2) = 0.566 > radius 0.5.
    const sphere = new BoundingSphere(new Vector3D(1.4, 1.4, 0), 0.5);
    expect(Collision.resolveHullSphere(cube, sphere, new Vector3D())).toBe(false);
  });

  it("still reports the contact when the sphere really touches the edge", () => {
    const cube = cubeHull(1);
    // Distance to the edge is sqrt(0.3^2 + 0.3^2) = 0.424 < radius 0.5.
    const sphere = new BoundingSphere(new Vector3D(1.3, 1.3, 0), 0.5);
    expect(Collision.resolveHullSphere(cube, sphere, new Vector3D())).toBe(true);
  });
});
