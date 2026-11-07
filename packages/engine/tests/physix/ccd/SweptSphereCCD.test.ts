import { describe, it, expect } from "vitest";
import { Object3D } from "../../../src/core/Object3D.js";
import { SweptSphereCCD } from "../../../src/physix/ccd/SweptSphereCCD.js";
import { PhysicsBroadphase } from "../../../src/physix/broadphase/PhysicsBroadphase.js";
import { BoundingSphere } from "../../../src/physix/BoundingSphere.js";
import { BoundingBox } from "../../../src/physix/BoundingBox.js";
import { Vector3D } from "../../../src/math/index.js";

describe("SweptSphereCCD", () => {
  it("registers fast-moving sphere bodies exceeding the motion threshold", () => {
    const ccd = new SweptSphereCCD();
    const sphereObj = new Object3D("FastBullet");
    sphereObj.bounds = new BoundingSphere(new Vector3D(0, 0, 0), 0.5);

    // Fast displacement = 2.0 > radius(0.5) * threshold(1.0)
    const largeDelta = new Vector3D(2, 0, 0);
    ccd.checkCandidate(sphereObj, largeDelta, 1.0);

    expect(ccd.hasCandidates).toBe(true);
  });

  it("ignores slow-moving bodies within the threshold", () => {
    const ccd = new SweptSphereCCD();
    const sphereObj = new Object3D("SlowBall");
    sphereObj.bounds = new BoundingSphere(new Vector3D(0, 0, 0), 1.0);

    const smallDelta = new Vector3D(0.2, 0, 0);
    ccd.checkCandidate(sphereObj, smallDelta, 1.0);

    expect(ccd.hasCandidates).toBe(false);
  });

  it("clamps position of fast-moving sphere hitting a thin wall", () => {
    const ccd = new SweptSphereCCD();
    const sphereObj = new Object3D("Bullet");
    sphereObj.position.set(0, 0, 0);
    sphereObj.bounds = new BoundingSphere(new Vector3D(0, 0, 0), 0.5);

    const wall = new Object3D("ThinWall");
    wall.bounds = new BoundingBox(new Vector3D(4.9, -5, -5), new Vector3D(5.1, 5, 5));

    const broadphase = new PhysicsBroadphase();
    broadphase.update([wall]);

    const largeDelta = new Vector3D(10, 0, 0); // Tunneling through x=5
    ccd.checkCandidate(sphereObj, largeDelta, 1.0);
    ccd.resolve(broadphase);

    expect(sphereObj.position.x).toBeLessThan(5.5);
    expect(sphereObj.position.x).toBeGreaterThan(4.0);
  });
});
