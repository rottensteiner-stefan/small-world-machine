import { describe, expect, it } from "vitest";
import { Object3D } from "../../src/core/Object3D.js";
import { Cube } from "../../src/geometry/index.js";

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
