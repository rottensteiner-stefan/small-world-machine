import { describe, it, expect } from "vitest";
import { FollowCameraBehavior } from "../../../src/core/behaviors/FollowCameraBehavior.js";
import { Object3D } from "../../../src/core/Object3D.js";
import { Camera } from "../../../src/core/cameras/Camera.js";
import { PerspectiveProjection } from "../../../src/math/projections/PerspectiveProjection.js";
import { Vector3D } from "../../../src/math/Vector3D.js";

describe("FollowCameraBehavior", () => {
  const createCamera = (): Camera =>
    new Camera(new PerspectiveProjection({ fov: Math.PI / 3, aspect: 1.6, near: 0.1, far: 1000 }));

  it("locks an object's position to a camera instantly by default", () => {
    const camera = createCamera();
    camera.position.set(10, 20, 30);

    const obj = new Object3D("Follower");
    obj.position.set(0, 0, 0);

    const behavior = new FollowCameraBehavior({ camera });
    obj.addBehavior(behavior);

    behavior.update(0.016);

    expect(obj.position.x).toBe(10);
    expect(obj.position.y).toBe(20);
    expect(obj.position.z).toBe(30);

    // Moving camera moves the object
    camera.position.set(-5, 100, 42);
    behavior.update(0.016);

    expect(obj.position.x).toBe(-5);
    expect(obj.position.y).toBe(100);
    expect(obj.position.z).toBe(42);
  });

  it("respects axis constraints and static offset", () => {
    const camera = createCamera();
    camera.position.set(10, 20, 30);

    const obj = new Object3D("Follower");
    obj.position.set(1, 2, 3);

    const behavior = new FollowCameraBehavior({
      camera,
      axes: { x: true, y: false, z: true },
      offset: new Vector3D(5, 0, -2),
    });
    obj.addBehavior(behavior);

    behavior.update(0.016);

    expect(obj.position.x).toBe(15); // 10 + 5
    expect(obj.position.y).toBe(2); // Unchanged because axes.y is false
    expect(obj.position.z).toBe(28); // 30 - 2
  });

  it("smoothly damps position when damping > 0", () => {
    const camera = createCamera();
    camera.position.set(100, 0, 0);

    const obj = new Object3D("Follower");
    obj.position.set(0, 0, 0);

    const behavior = new FollowCameraBehavior({
      camera,
      damping: 5.0,
    });
    obj.addBehavior(behavior);

    behavior.update(0.1); // dt * damping = 0.5 (moves halfway)

    expect(obj.position.x).toBeCloseTo(50);
    expect(obj.position.y).toBe(0);
    expect(obj.position.z).toBe(0);
  });
});
