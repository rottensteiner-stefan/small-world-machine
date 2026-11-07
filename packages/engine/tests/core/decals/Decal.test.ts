import { describe, expect, it } from "vitest";
import { Scene } from "../../../src/core/Scene.js";
import { Decal } from "../../../src/core/objects/Decal.js";
import { Object3D } from "../../../src/core/Object3D.js";
import {
  compareDecals,
  computeClipToBox,
  decalWorldVolume,
} from "../../../src/core/decals/DecalMath.js";
import { DecalMaterial, StandardMaterial } from "../../../src/core/materials/index.js";
import { Cube } from "../../../src/geometry/index.js";
import { BoundingType } from "../../../src/enums/index.js";
import { Matrix4, Vector3D } from "../../../src/math/index.js";

function makeDecal(name: string): Decal {
  return new Decal(new DecalMaterial(), name);
}

function placed(
  decal: Decal,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy = sx,
  sz = sx,
): Decal {
  decal.setPosition(x, y, z).setScale(sx, sy, sz).updateMatrixWorld(true);
  return decal;
}

describe("decalWorldVolume", () => {
  it("is the absolute determinant of the world matrix's 3x3 part", () => {
    const decal = placed(makeDecal("d"), 5, 6, 7, 2, 3, 4);

    expect(decalWorldVolume(decal.worldMatrix)).toBeCloseTo(24);
  });
});

describe("compareDecals", () => {
  it("orders by priority first, then larger volume first, then creation order", () => {
    const small = placed(makeDecal("small"), 0, 0, 0, 1);
    const large = placed(makeDecal("large"), 0, 0, 0, 4);
    const top = placed(makeDecal("top"), 0, 0, 0, 1);
    top.priority = 1;
    const twin = placed(makeDecal("twin"), 0, 0, 0, 1);

    const sorted = [top, twin, small, large].sort(compareDecals).map((d) => d.name);

    expect(sorted).toEqual(["large", "small", "twin", "top"]);
  });
});

describe("computeClipToBox", () => {
  it("maps a world-space point inside the box into [-0.5, 0.5] box coordinates", () => {
    const decal = placed(makeDecal("d"), 1, 2, 3, 2, 4, 6);
    const out = new Matrix4();

    // With an identity inverse view-projection, "clip space" is just world space.
    const ok = computeClipToBox(decal.worldMatrix, new Matrix4(), out);

    expect(ok).toBe(true);
    const m = out.data;
    const toBox = (x: number, y: number, z: number): number[] => [
      m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
      m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
      m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
    ];
    expect(toBox(1, 2, 3)).toEqual([0, 0, 0].map((v) => expect.closeTo(v, 6)));
    expect(toBox(2, 4, 6)).toEqual([0.5, 0.5, 0.5].map((v) => expect.closeTo(v, 6)));
  });

  it("returns false for a singular world matrix and leaves the output untouched", () => {
    const decal = placed(makeDecal("d"), 0, 0, 0, 0);
    const out = new Matrix4();
    const before = Array.from(out.data);

    expect(computeClipToBox(decal.worldMatrix, new Matrix4(), out)).toBe(false);
    expect(Array.from(out.data)).toEqual(before);
  });
});

describe("Decal", () => {
  it("is neither collidable nor a shadow caster, yet always has OBB bounds for culling", () => {
    const decal = placed(makeDecal("d"), 0, 0, 0, 2);

    decal.computeBounds();

    expect(decal.isCollidable).toBe(false);
    expect(decal.castShadow).toBe(false);
    expect(decal.bounds?.type).toBe(BoundingType.OBB);
  });
});

describe("Scene decal routing", () => {
  it("collects decals in their own list, sorted, and keeps them out of the opaque and transparent lists", () => {
    const scene = new Scene();
    const opaque = new Object3D("Opaque");
    opaque.geometry = new Cube({ size: 1 }).getGeometryData();
    opaque.material = new StandardMaterial();
    const first = placed(makeDecal("first"), 0, 0, 0, 1);
    const second = placed(makeDecal("second"), 0, 0, 0, 3);
    scene.add(opaque, first, second);

    const list = scene.getVisibleObjectsSorted(new Matrix4().data, new Vector3D());

    expect(list.decals.map((d) => d.name)).toEqual(["second", "first"]);
    expect(list.transparent).toHaveLength(0);
    expect(list.opaqueBatches.flatMap((b) => b.objects.map((o) => o.name))).toEqual(["Opaque"]);
  });
});
