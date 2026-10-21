import { describe, expect, it } from "vitest";
import { Scene } from "../../src/core/Scene.js";
import { Object3D } from "../../src/core/Object3D.js";
import { StandardMaterial } from "../../src/core/materials/index.js";
import { Cube } from "../../src/geometry/index.js";
import { Vector3D } from "../../src/math/index.js";

describe("Scene opaque batch lifecycle", () => {
  it("drops batches of removed/cloned materials once they stay empty", () => {
    const scene = new Scene();
    const obj = new Object3D("mesh");
    obj.geometry = new Cube({ size: 1 }).getGeometryData();
    obj.material = new StandardMaterial();
    scene.add(obj);
    const vp = new Float32Array(16);
    const cam = new Vector3D();

    scene.getVisibleObjectsSorted(vp, cam, true);
    expect(scene.getVisibleObjectsSorted(vp, cam, true).opaqueBatches).toHaveLength(1);

    scene.remove(obj);
    // Short-lived emptiness keeps the batch (cheap re-show).
    expect(scene.getVisibleObjectsSorted(vp, cam, true).opaqueBatches).toHaveLength(1);
    for (let i = 0; i < 130; i++) scene.getVisibleObjectsSorted(vp, cam, true);
    const list = scene.getVisibleObjectsSorted(vp, cam, true);
    expect(list.opaqueBatches).toHaveLength(0);
    expect(list.opaqueLookup.size).toBe(0);

    // Re-adding recreates the batch.
    scene.add(obj);
    expect(scene.getVisibleObjectsSorted(vp, cam, true).opaqueBatches).toHaveLength(1);
  });
});
