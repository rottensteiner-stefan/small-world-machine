import { describe, it, expect } from "vitest";
import { Raycaster } from "../../src/physix/Raycaster.js";
import { BoundingBox } from "../../src/physix/BoundingBox.js";
import { BoundingSphere } from "../../src/physix/BoundingSphere.js";
import { OBB } from "../../src/physix/OBB.js";
import { Object3D } from "../../src/core/Object3D.js";
import { Vector3D } from "../../src/math/index.js";

describe("Raycaster", () => {
  it("should pick a box-bounded object along the ray", () => {
    const raycaster = new Raycaster();
    raycaster.ray.set(new Vector3D(0, 0, 0), new Vector3D(1, 0, 0));

    const box = new Object3D("Box");
    box.bounds = new BoundingBox(new Vector3D(5, -1, -1), new Vector3D(7, 1, 1));

    const hits = raycaster.intersectObjects([box]);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.object).toBe(box);
    expect(hits[0]!.distance).toBeCloseTo(5);
  });

  it("should pick a sphere-bounded object along the ray (Gadget Inspector regression)", () => {
    // Gadget Inspector's click-to-select, and anything else built on this raycaster,
    // used to silently skip every sphere-bounded object (Discs, Wisps, ...) -- only
    // BoundingType.BOX ever reached the hit list. This is exactly that case.
    const raycaster = new Raycaster();
    raycaster.ray.set(new Vector3D(0, 0, 0), new Vector3D(1, 0, 0));

    const sphere = new Object3D("Sphere");
    sphere.bounds = new BoundingSphere(new Vector3D(10, 0, 0), 1.0);

    const hits = raycaster.intersectObjects([sphere]);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.object).toBe(sphere);
    expect(hits[0]!.distance).toBeCloseTo(9);
  });

  it("should sort mixed box/sphere hits by distance, closest first", () => {
    const raycaster = new Raycaster();
    raycaster.ray.set(new Vector3D(0, 0, 0), new Vector3D(1, 0, 0));

    const far = new Object3D("Far");
    far.bounds = new BoundingSphere(new Vector3D(20, 0, 0), 1.0);
    const near = new Object3D("Near");
    near.bounds = new BoundingBox(new Vector3D(3, -1, -1), new Vector3D(4, 1, 1));

    const hits = raycaster.intersectObjects([far, near]);
    expect(hits.map((h) => h.object.name)).toEqual(["Near", "Far"]);
  });

  it("should skip objects with isCollidable = false regardless of bounds type", () => {
    const raycaster = new Raycaster();
    raycaster.ray.set(new Vector3D(0, 0, 0), new Vector3D(1, 0, 0));

    const sphere = new Object3D("Sphere");
    sphere.bounds = new BoundingSphere(new Vector3D(10, 0, 0), 1.0);
    sphere.isCollidable = false;

    expect(raycaster.intersectObjects([sphere])).toHaveLength(0);
  });

  it("should skip objects with no bounds", () => {
    const raycaster = new Raycaster();
    raycaster.ray.set(new Vector3D(0, 0, 0), new Vector3D(1, 0, 0));

    const obj = new Object3D("NoBounds");
    expect(raycaster.intersectObjects([obj])).toHaveLength(0);
  });

  it("should pick an OBB-bounded object along the ray [MIN-05]", () => {
    const raycaster = new Raycaster();
    raycaster.ray.set(new Vector3D(0, 0, 0), new Vector3D(1, 0, 0));

    const obbObj = new Object3D("OBBObj");
    obbObj.bounds = new OBB(new Vector3D(15, 0, 0), new Vector3D(1, 2, 3));

    const hits = raycaster.intersectObjects([obbObj]);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.object).toBe(obbObj);
    expect(hits[0]!.distance).toBeCloseTo(14);
  });

  it("should accurately pick triangle mesh geometry using local-space inverted ray [MAJ-03]", () => {
    const raycaster = new Raycaster();
    // Cast ray straight along +Z from (0, 0, -10)
    raycaster.ray.set(new Vector3D(0, 0, -10), new Vector3D(0, 0, 1));

    const meshObj = new Object3D("TriangleMesh");
    // Object translated to (0, 0, 0), rotated 0, scaled 1
    meshObj.bounds = new BoundingBox(new Vector3D(-2, -2, -1), new Vector3D(2, 2, 1));
    meshObj.geometry = {
      vertices: new Float32Array([
        -1,
        -1,
        0, // v0
        1,
        -1,
        0, // v1
        0,
        1,
        0, // v2
      ]),
      indices: new Uint16Array([0, 1, 2]),
      getBoundingVolume: (): BoundingBox =>
        new BoundingBox(new Vector3D(-1, -1, 0), new Vector3D(1, 1, 0)),
    };
    meshObj.updateMatrixWorld();

    const hits = raycaster.intersectObjects([meshObj]);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.object).toBe(meshObj);
    // Ray origin is at -10, triangle is at z=0 -> distance is 10
    expect(hits[0]!.distance).toBeCloseTo(10);
  });

  it("should correctly handle transformed (scaled & translated) mesh geometry [MAJ-03]", () => {
    const raycaster = new Raycaster();
    // Cast ray straight along +Z from (2, 4, 0)
    raycaster.ray.set(new Vector3D(2, 4, 0), new Vector3D(0, 0, 1));

    const meshObj = new Object3D("ScaledMesh");
    meshObj.position.set(2, 4, 10);
    meshObj.scale.set(2, 2, 2);
    meshObj.updateMatrixWorld();

    meshObj.bounds = new BoundingBox(new Vector3D(0, 2, 8), new Vector3D(4, 6, 12));
    meshObj.geometry = {
      vertices: new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0]),
      indices: new Uint16Array([0, 1, 2]),
      getBoundingVolume: (): BoundingBox =>
        new BoundingBox(new Vector3D(-1, -1, 0), new Vector3D(1, 1, 0)),
    };

    const hits = raycaster.intersectObjects([meshObj]);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.object).toBe(meshObj);
    // Ray origin at z=0, mesh at z=10 -> world distance is 10
    expect(hits[0]!.distance).toBeCloseTo(10);
  });

  describe("hit point and normal", () => {
    /** A 2x2 quad in the local XY plane facing +Z. */
    const makeQuad = (): Object3D => {
      const obj = new Object3D("Quad");
      obj.geometry = {
        vertices: new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]),
        indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
        getBoundingVolume: (): BoundingBox =>
          new BoundingBox(new Vector3D(-1, -1, 0), new Vector3D(1, 1, 0)),
      };
      return obj;
    };

    it("returns the world hit point and a ray-facing unit normal", () => {
      const raycaster = new Raycaster();
      const quad = makeQuad();
      quad.position.set(1, 2, 5);
      quad.updateMatrixWorld();
      quad.bounds = new BoundingBox(new Vector3D(0, 1, 4), new Vector3D(2, 3, 6));

      raycaster.ray.set(new Vector3D(1.5, 2.25, 0), new Vector3D(0, 0, 1));
      const front = raycaster.intersectObjects([quad])[0]!;
      expect(front.point.x).toBeCloseTo(1.5);
      expect(front.point.y).toBeCloseTo(2.25);
      expect(front.point.z).toBeCloseTo(5);
      expect(front.normal.z).toBeCloseTo(-1); // faces the ray, so towards -Z

      raycaster.ray.set(new Vector3D(1.5, 2.25, 10), new Vector3D(0, 0, -1));
      const back = raycaster.intersectObjects([quad])[0]!;
      expect(back.normal.z).toBeCloseTo(1);
    });

    it("transforms the normal with the inverse transpose under non-uniform scale", () => {
      const raycaster = new Raycaster();
      // A quad in XY, scaled (4, 1, 1) and rotated about Z by 45 degrees: the plane is still
      // z = 0, so its normal must stay +Z (towards the ray).
      const quad = makeQuad();
      quad.scale.set(4, 1, 1);
      quad.rotation.set(0, 0, Math.PI / 4);
      quad.updateMatrixWorld();
      quad.bounds = new BoundingBox(new Vector3D(-5, -5, 0), new Vector3D(5, 5, 0));
      raycaster.ray.set(new Vector3D(0, 0, 3), new Vector3D(0, 0, -1));
      const hit = raycaster.intersectObjects([quad])[0]!;
      expect(hit.normal.x).toBeCloseTo(0);
      expect(hit.normal.y).toBeCloseTo(0);
      expect(hit.normal.z).toBeCloseTo(1);

      // Tilted plane under non-uniform scale: the normal must be unit length and perpendicular
      // to the transformed surface tangents.
      const tilted = makeQuad();
      tilted.scale.set(1, 3, 1);
      tilted.rotation.set(Math.PI / 4, 0, 0);
      tilted.updateMatrixWorld();
      tilted.bounds = new BoundingBox(new Vector3D(-5, -5, -5), new Vector3D(5, 5, 5));
      raycaster.ray.set(new Vector3D(0, 0, 10), new Vector3D(0, 0, -1));
      const t = raycaster.intersectObjects([tilted])[0]!;
      const len = Math.hypot(t.normal.x, t.normal.y, t.normal.z);
      expect(len).toBeCloseTo(1);
      expect(t.normal.z).toBeGreaterThan(0);
      // Perpendicular to the transformed surface tangents (world X and the scaled, tilted Y).
      const tangentY = new Vector3D(0, 3 * Math.cos(Math.PI / 4), 3 * Math.sin(Math.PI / 4));
      expect(t.normal.x).toBeCloseTo(0);
      expect(t.normal.y * tangentY.y + t.normal.z * tangentY.z).toBeCloseTo(0);
    });

    it("falls back to the negated ray direction for broad-phase-only hits", () => {
      const raycaster = new Raycaster();
      raycaster.ray.set(new Vector3D(0, 0, 0), new Vector3D(1, 0, 0));
      const box = new Object3D("Box");
      box.bounds = new BoundingBox(new Vector3D(5, -1, -1), new Vector3D(7, 1, 1));
      const hit = raycaster.intersectObjects([box])[0]!;
      expect(hit.point.x).toBeCloseTo(5);
      expect(hit.normal.x).toBeCloseTo(-1);
    });
  });
});
