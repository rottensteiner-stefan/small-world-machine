import { describe, it, expect, vi } from "vitest";
import { CameraFlyToBehavior } from "../../../src/core/behaviors/CameraFlyToBehavior.js";
import { Camera } from "../../../src/core/cameras/Camera.js";
import { PerspectiveProjection } from "../../../src/math/projections/PerspectiveProjection.js";
import { Vector3D } from "../../../src/math/Vector3D.js";
import { Easing } from "../../../src/math/Easing.js";

describe("CameraFlyToBehavior", () => {
  const createCamera = (): Camera =>
    new Camera(new PerspectiveProjection({ fov: Math.PI / 3, aspect: 1.6, near: 0.1, far: 1000 }));

  it("smoothly interpolates camera position and target over duration", async () => {
    const camera = createCamera();
    camera.position.set(0, 0, 0);
    camera.target.set(0, 0, -10);

    const behavior = new CameraFlyToBehavior();
    camera.addBehavior(behavior);

    const onComplete = vi.fn();
    const flightPromise = behavior.flyTo({
      position: new Vector3D(10, 20, 30),
      target: new Vector3D(10, 20, 20),
      duration: 1.0,
      easing: Easing.linear,
      onComplete,
    });

    expect(behavior.isFlying).toBe(true);

    // Halfway update (0.5s)
    behavior.update(0.5);

    // Without control point, midpoint has a subtle vertical lift
    expect(camera.position.x).toBeCloseTo(5.0);
    expect(camera.position.z).toBeCloseTo(15.0);
    expect(camera.position.y).toBeGreaterThan(10.0); // lifted slightly

    expect(camera.target.x).toBeCloseTo(5.0);
    expect(camera.target.y).toBeCloseTo(10.0);
    expect(camera.target.z).toBeCloseTo(5.0);

    // Finish flight
    behavior.update(0.5);

    expect(behavior.isFlying).toBe(false);
    expect(camera.position.x).toBe(10);
    expect(camera.position.y).toBe(20);
    expect(camera.position.z).toBe(30);
    expect(camera.target.x).toBe(10);
    expect(camera.target.y).toBe(20);
    expect(camera.target.z).toBe(20);

    const result = await flightPromise;
    expect(result).toBe(true);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("passes exactly through geometric waypoint at t=0.5 when isWaypoint is true", () => {
    const camera = createCamera();
    camera.position.set(0, 0, 10);
    camera.target.set(0, 0, 0);

    const behavior = new CameraFlyToBehavior();
    camera.addBehavior(behavior);

    const waypoint = new Vector3D(4, 8, 0); // e.g. center of an archway
    behavior.flyTo({
      position: new Vector3D(0, 0, -10),
      target: new Vector3D(0, 0, -20),
      duration: 1.0,
      easing: Easing.linear,
      controlPoint: waypoint,
      isWaypoint: true,
    });

    // Advance to t = 0.5
    behavior.update(0.5);

    // Must hit the waypoint on the nose!
    expect(camera.position.x).toBeCloseTo(4.0, 5);
    expect(camera.position.y).toBeCloseTo(8.0, 5);
    expect(camera.position.z).toBeCloseTo(0.0, 5);
  });

  it("resolves false and calls onCancel if flight is cancelled", async () => {
    const camera = createCamera();
    camera.position.set(0, 0, 0);

    const behavior = new CameraFlyToBehavior();
    camera.addBehavior(behavior);

    const onCancel = vi.fn();
    const flightPromise = behavior.flyTo({
      position: new Vector3D(100, 100, 100),
      target: new Vector3D(100, 100, 0),
      duration: 2.0,
      onCancel,
    });

    behavior.update(0.5);
    expect(behavior.isFlying).toBe(true);

    behavior.cancel();

    expect(behavior.isFlying).toBe(false);
    const result = await flightPromise;
    expect(result).toBe(false);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("smoothly retargets if a new flyTo is called while flying", async () => {
    const camera = createCamera();
    camera.position.set(0, 0, 0);

    const behavior = new CameraFlyToBehavior();
    camera.addBehavior(behavior);

    const firstFlight = behavior.flyTo({
      position: new Vector3D(10, 0, 0),
      target: new Vector3D(10, 0, -10),
      duration: 1.0,
      easing: Easing.linear,
    });

    behavior.update(0.5); // moves to x ≈ 5

    const secondFlight = behavior.flyTo({
      position: new Vector3D(0, 10, 0),
      target: new Vector3D(0, 10, -10),
      duration: 1.0,
      easing: Easing.linear,
    });

    const firstResult = await firstFlight;
    expect(firstResult).toBe(false); // first flight was superseded

    behavior.update(1.0); // finish second flight
    expect(camera.position.x).toBeCloseTo(0);
    expect(camera.position.y).toBeCloseTo(10);

    const secondResult = await secondFlight;
    expect(secondResult).toBe(true);
  });

  it("works seamlessly through camera.flyTo(...) convenience method", async () => {
    const camera = createCamera();
    camera.position.set(1, 2, 3);
    camera.target.set(0, 0, 0);

    expect(camera.isFlying).toBe(false);

    const promise = camera.flyTo({
      position: new Vector3D(5, 5, 5),
      target: new Vector3D(0, 0, 0),
      duration: 0.5,
      easing: Easing.linear,
    });

    expect(camera.isFlying).toBe(true);

    // Advance camera update
    camera.update(camera.target, 0, 0, 0.5);

    expect(camera.isFlying).toBe(false);
    expect(camera.position.x).toBe(5);
    expect(camera.position.y).toBe(5);
    expect(camera.position.z).toBe(5);

    const completed = await promise;
    expect(completed).toBe(true);
  });

  it("smoothly flies through multiple waypoints via Catmull-Rom spline", async () => {
    const camera = createCamera();
    camera.position.set(0, 0, 0); // P0
    camera.target.set(0, 0, -10);

    const behavior = new CameraFlyToBehavior();
    camera.addBehavior(behavior);

    const w1 = new Vector3D(10, 0, 0); // W1
    const w2 = new Vector3D(10, 10, 0); // W2
    const targetPos = new Vector3D(0, 10, 0); // Target

    // Trajectory: (0,0,0) -> (10,0,0) -> (10,10,0) -> (0,10,0) [4 points, 3 segments]
    const flight = behavior.flyTo({
      position: targetPos,
      target: new Vector3D(0, 10, -10),
      waypoints: [w1, w2],
      duration: 3.0,
      easing: Easing.linear,
    });

    // At t = 1.0s (1/3 progress): passes W1
    behavior.update(1.0);
    expect(camera.position.x).toBeCloseTo(10.0, 1);
    expect(camera.position.y).toBeCloseTo(0.0, 1);

    // At t = 2.0s (2/3 progress): passes W2
    behavior.update(1.0);
    expect(camera.position.x).toBeCloseTo(10.0, 1);
    expect(camera.position.y).toBeCloseTo(10.0, 1);

    // At t = 3.0s (completion): reaches final target
    behavior.update(1.0);
    expect(camera.position.x).toBeCloseTo(0.0, 1);
    expect(camera.position.y).toBeCloseTo(10.0, 1);
    expect(behavior.isFlying).toBe(false);

    const res = await flight;
    expect(res).toBe(true);
  });

  it("handles a single waypoint in waypoints array via inverse Bézier", () => {
    const camera = createCamera();
    camera.position.set(0, 0, 10);
    camera.target.set(0, 0, 0);

    const behavior = new CameraFlyToBehavior();
    camera.addBehavior(behavior);

    const waypoint = new Vector3D(6, 4, 0);
    behavior.flyTo({
      position: new Vector3D(0, 0, -10),
      target: new Vector3D(0, 0, -20),
      duration: 1.0,
      easing: Easing.linear,
      waypoints: [waypoint],
    });

    // Advance to t = 0.5
    behavior.update(0.5);

    expect(camera.position.x).toBeCloseTo(6.0, 5);
    expect(camera.position.y).toBeCloseTo(4.0, 5);
    expect(camera.position.z).toBeCloseTo(0.0, 5);
  });
});
