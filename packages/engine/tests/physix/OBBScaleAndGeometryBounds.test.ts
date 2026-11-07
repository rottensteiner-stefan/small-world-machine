import { describe, it, expect } from "vitest";
import { Object3D } from "../../src/core/Object3D.js";
import { Cube } from "../../src/geometry/Cube.js";
import { OBB } from "../../src/physix/OBB.js";
import { Matrix4 } from "../../src/math/Matrix4.js";
import { Vector3D } from "../../src/math/Vector3D.js";

describe("OBB Scaling & Geometry Bounds Preservation", () => {
  it("scales halfExtents correctly in OBB.transform()", () => {
    const obb = new OBB(new Vector3D(0, 0, 0), new Vector3D(1, 2, 3));
    const mat = new Matrix4().compose(
      new Vector3D(0, 0, 0),
      new Vector3D(0, 0, 0),
      new Vector3D(2, 3, 4),
    );

    obb.transform(mat);
    expect(obb.halfExtents.x).toBeCloseTo(2);
    expect(obb.halfExtents.y).toBeCloseTo(6);
    expect(obb.halfExtents.z).toBeCloseTo(12);
  });

  it("preserves assigned OBB bounds on Object3D when geometry is attached and scaled", () => {
    const obj = new Object3D();
    obj.geometry = new Cube({ size: 2 }).getGeometryData(); // local bounds from -1 to 1 (half extents 1, 1, 1)
    const customObb = new OBB();
    obj.bounds = customObb;

    obj.scale.set(3, 4, 5);
    obj.updateMatrixWorld();
    obj.computeBounds();

    // Bounds must remain an OBB
    expect(obj.bounds).toBe(customObb);
    expect(obj.bounds instanceof OBB).toBe(true);

    const obb = obj.bounds as OBB;
    expect(obb.halfExtents.x).toBeCloseTo(3);
    expect(obb.halfExtents.y).toBeCloseTo(4);
    expect(obb.halfExtents.z).toBeCloseTo(5);

    // Re-computing on next frame maintains correct scaling
    obj.computeBounds();
    expect(obb.halfExtents.x).toBeCloseTo(3);
    expect(obb.halfExtents.y).toBeCloseTo(4);
    expect(obb.halfExtents.z).toBeCloseTo(5);
  });
});
