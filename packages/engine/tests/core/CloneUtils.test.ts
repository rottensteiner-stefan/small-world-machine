import { describe, it, expect } from "vitest";
import { shallowCloneWithValueTypes } from "../../src/core/CloneUtils.js";
import { Vector2D, Vector3D, Quaternion } from "../../src/math/index.js";
import { Color } from "../../src/core/colors/Color.js";
import { StandardMaterial } from "../../src/core/materials/surface/StandardMaterial.js";
import { TerrainMaterial } from "../../src/core/materials/TerrainMaterial.js";

describe("CloneUtils.shallowCloneWithValueTypes", () => {
  it("deep clones Vector2D, Vector3D, Quaternion, and Color", () => {
    const original = {
      uuid: "test-uuid-1",
      vec2: new Vector2D(1, 2),
      vec3: new Vector3D(3, 4, 5),
      quat: new Quaternion(0, 0, 0, 1),
      col: new Color(0.1, 0.2, 0.3, 1),
      name: "Original",
    };

    const clone = shallowCloneWithValueTypes(original);

    expect(clone.uuid).not.toBe(original.uuid);
    expect(clone.name).toBe("Original");

    // Check independent objects
    expect(clone.vec2).not.toBe(original.vec2);
    expect(clone.vec2.x).toBe(1);
    clone.vec2.x = 99;
    expect(original.vec2.x).toBe(1);

    expect(clone.vec3).not.toBe(original.vec3);
    clone.vec3.y = 88;
    expect(original.vec3.y).toBe(4);

    expect(clone.quat).not.toBe(original.quat);
    clone.quat.w = 0.5;
    expect(original.quat.w).toBe(1);

    expect(clone.col).not.toBe(original.col);
    clone.col.r = 0.9;
    expect(original.col.r).toBe(0.1);
  });

  it("deep clones Arrays and elements inside them", () => {
    const original = {
      points: [new Vector3D(1, 2, 3), new Vector3D(4, 5, 6)],
      tags: ["alpha", "beta"],
      numbers: [10, 20, 30],
    };

    const clone = shallowCloneWithValueTypes(original);

    expect(clone.points).not.toBe(original.points);
    expect(clone.points[0]).not.toBe(original.points[0]);
    clone.points[0]!.x = 999;
    expect(original.points[0]!.x).toBe(1);

    expect(clone.numbers).not.toBe(original.numbers);
    clone.numbers[0] = 555;
    expect(original.numbers[0]).toBe(10);
  });

  it("clones StandardMaterial and TerrainMaterial without leaking value type references", () => {
    const mat = new StandardMaterial({
      normalScale: new Vector2D(2, 3),
      color: new Color(0.5, 0.5, 0.5),
    });

    const matClone = mat.clone() as StandardMaterial;
    expect(matClone.normalScale).not.toBe(mat.normalScale);
    matClone.normalScale.x = 10;
    expect(mat.normalScale.x).toBe(2);

    const terrain = new TerrainMaterial({
      thresholds: [1.0, 5.0, 10.0, 1.0],
      texRepeat: [15.0, 15.0],
    });

    const terrainClone = terrain.clone() as TerrainMaterial;
    expect(terrainClone.thresholds).not.toBe(terrain.thresholds);
    terrainClone.thresholds[0] = 99;
    expect(terrain.thresholds[0]).toBe(1.0);
  });
});
