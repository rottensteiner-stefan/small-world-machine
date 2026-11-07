import { describe, expect, it } from "vitest";
import { Scene } from "../../../src/core/Scene.js";
import { Object3D } from "../../../src/core/Object3D.js";
import { Decal } from "../../../src/core/objects/Decal.js";
import { DecalMaterial } from "../../../src/core/materials/index.js";
import { resolveSphereCollisions } from "../../../src/core/behaviors/CollisionResolution.js";
import { BoundingSphere } from "../../../src/physix/index.js";
import { Vector3D } from "../../../src/math/index.js";

function run(blocker: Object3D): Vector3D {
  const scene = new Scene();
  blocker.updateMatrixWorld(true);
  blocker.computeBounds();
  scene.add(blocker);
  const target = new Object3D("player");
  target.position.set(0, 0.2, 0);
  const collider = new BoundingSphere(new Vector3D(0, 0, 0), 0.5);
  resolveSphereCollisions(collider, target, scene, 0.2);
  return target.position;
}

describe("resolveSphereCollisions vs. decals", () => {
  it("does not push the player out of a decal's projection box", () => {
    const decal = new Decal(new DecalMaterial());
    decal.setPosition(0, 0.2, 0).setScale(4, 4, 4);
    const position = run(decal);
    expect(position.x).toBeCloseTo(0);
    expect(position.y).toBeCloseTo(0.2);
    expect(position.z).toBeCloseTo(0);
  });
});
