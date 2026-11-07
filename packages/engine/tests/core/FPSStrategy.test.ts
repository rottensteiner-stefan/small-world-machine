import { describe, it, expect } from "vitest";
import { Camera } from "../../src/core/cameras/Camera.js";
import { PerspectiveProjection, Vector3D } from "../../src/math/index.js";
import { CameraStrategyType } from "../../src/enums/index.js";

describe("FPSStrategy position contract", () => {
  it("keeps the controller-owned position when the app passes a distinct targetPos", () => {
    const cam = new Camera(new PerspectiveProjection());
    cam.setStrategy(CameraStrategyType.FPS);
    cam.position.set(3, 1, 7);

    // The engine calls camera.update(...); any vector distinct from `cam.target` (by identity)
    // used to teleport the camera via the object-identity sentinel. Position is controller-owned.
    cam.update(new Vector3D(0, 0, 0), 0, 0, 0);

    expect(cam.position.x).toBeCloseTo(3);
    expect(cam.position.y).toBeCloseTo(1);
    expect(cam.position.z).toBeCloseTo(7);
  });

  it("still derives the look target from the controller-owned position and orientation", () => {
    const cam = new Camera(new PerspectiveProjection());
    cam.setStrategy(CameraStrategyType.FPS);
    cam.position.set(3, 1, 7);
    cam.theta = 0; // Looking towards -Z
    cam.phi = 0;

    cam.update(new Vector3D(0, 0, 0), 0, 0, 0);

    // target = position + forward(0, 0, -1)
    expect(cam.target.x).toBeCloseTo(3);
    expect(cam.target.y).toBeCloseTo(1);
    expect(cam.target.z).toBeCloseTo(6);
  });

  it("applies the vertical look clamp without touching the position", () => {
    const cam = new Camera(new PerspectiveProjection());
    cam.setStrategy(CameraStrategyType.FPS);
    cam.position.set(0, 2, 0);

    // Huge positive dy must clamp phi to HALF_PI - 0.01, never move the feet.
    cam.update(new Vector3D(0, 0, 0), 0, 500, 0);

    expect(cam.phi).toBeLessThanOrEqual(Math.PI / 2);
    expect(cam.position.y).toBeCloseTo(2);
  });
});
