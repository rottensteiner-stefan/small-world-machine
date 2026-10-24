import { describe, expect, it } from "vitest";
import { Object3D } from "../../src/core/Object3D.js";
import { Cube } from "../../src/geometry/index.js";
import { BoundingSphere } from "../../src/physix/index.js";
import { Vector3D } from "../../src/math/index.js";
import { BoundingType } from "../../src/enums/index.js";

describe("Object3D.occlusionCulled", () => {
  it("is a plain per-object field defaulting to false", () => {
    const obj = new Object3D("a");
    expect(obj.occlusionCulled).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(obj, "occlusionCulled")).toBe(true);
    obj.occlusionCulled = true;
    expect(new Object3D("b").occlusionCulled).toBe(false);
  });

  it("does not copy a stale GPU occlusion result into clones", () => {
    const obj = new Object3D("a");
    obj.occlusionCulled = true;
    expect(obj.clone().occlusionCulled).toBe(false);
  });
});

describe("Object3D.computeBounds contract for isCollidable = false", () => {
  it("leaves bounds undefined, so the object is never culled (always draws)", () => {
    const obj = new Object3D("visual");
    obj.geometry = new Cube({ size: 1 }).getGeometryData();
    obj.updateMatrixWorld();
    obj.computeBounds();
    expect(obj.bounds).toBeDefined();
    obj.isCollidable = false;
    obj.computeBounds();
    expect(obj.bounds).toBeUndefined();
  });
});

describe("Object3D.computeBounds preserves a manually assigned BoundingSphere", () => {
  it("does not replace a user-assigned sphere with the geometry box", () => {
    const obj = new Object3D("sphere-bound");
    // Cube geometry yields a BOX bounding volume (type 1) — the mismatch that used to
    // destroy a manually assigned BoundingSphere (type 0) via the cloneEmpty guard.
    obj.geometry = new Cube({ size: 1 }).getGeometryData();
    obj.position.set(1, 2, 3);
    obj.updateMatrixWorld();
    obj.bounds = new BoundingSphere(new Vector3D(0, 0, 0), 5);

    obj.computeBounds();

    expect(obj.bounds).toBeDefined();
    expect(obj.bounds!.type).toBe(BoundingType.SPHERE);
  });

  it("keeps the sphere across repeated computeBounds calls (no reallocation)", () => {
    const obj = new Object3D("sphere-bound");
    obj.geometry = new Cube({ size: 1 }).getGeometryData();
    obj.updateMatrixWorld();
    obj.bounds = new BoundingSphere(new Vector3D(1, 2, 3), 5);

    obj.computeBounds();
    obj.computeBounds();

    expect(obj.bounds!.type).toBe(BoundingType.SPHERE);
  });
});
