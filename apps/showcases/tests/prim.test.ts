// @vitest-environment node
import { describe, it, expect } from "vitest";
import { StandardMaterial } from "@small-world-machine/engine";
import { box } from "../shared/prim.js";

describe("shared/prim box(...)", () => {
  it("returns an Object3D with unit-cube geometry, scale, position and material", () => {
    const material = new StandardMaterial();
    const obj = box("TestBox", material, [2, 3, 4], [1, 5, -2], { cast: true, receive: true });

    expect(obj.name).toBe("TestBox");
    expect(obj.material).toBe(material);
    expect(obj.scale.x).toBe(2);
    expect(obj.scale.y).toBe(3);
    expect(obj.scale.z).toBe(4);
    expect(obj.position.x).toBe(1);
    expect(obj.position.y).toBe(5);
    expect(obj.position.z).toBe(-2);
    expect(obj.castShadow).toBe(true);
    expect(obj.receiveShadow).toBe(true);
    expect(obj.geometry).toBeDefined();
  });

  it("defaults shadow flags and position to off / origin", () => {
    const material = new StandardMaterial();
    const obj = box("DefaultBox", material, [1, 1, 1]);

    expect(obj.castShadow).toBe(false);
    expect(obj.receiveShadow).toBe(false);
    expect(obj.position.x).toBe(0);
    expect(obj.position.y).toBe(0);
    expect(obj.position.z).toBe(0);
  });

  it("shares a single geometry instance across calls (like the old shared cubeGeom)", () => {
    const material = new StandardMaterial();
    const a = box("A", material, [1, 1, 1]);
    const b = box("B", material, [1, 1, 1]);

    expect(a.geometry).toBe(b.geometry);
  });
});
