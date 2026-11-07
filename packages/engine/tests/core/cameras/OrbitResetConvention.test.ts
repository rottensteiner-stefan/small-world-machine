import { describe, expect, it } from "vitest";
import { SmoothStrategy } from "../../../src/core/cameras/strategies/SmoothStrategy.js";
import { StiffStrategy } from "../../../src/core/cameras/strategies/StiffStrategy.js";
import { Vector3D } from "../../../src/math/index.js";
import type { CameraInterfaceData } from "../../../src/interfaces/index.js";

// Transition test for `AbstractShowcase.resetCamera()` on orbit strategies. Smooth/Stiff place the
// camera at target + radius * (sinθ·cosφ, sinφ, cosθ·cosφ): their angles describe `position - target`.
// `setInitialCamera` stores look-direction angles (`target - position`); `resetCamera` used to feed
// those back unchanged, which mirrored the view below the ground after the first orbit (`R` key).
// The reset now derives the orbit angles from the restored position -- this test pins that convention.

interface FakeCamera {
  position: Vector3D;
  target: Vector3D;
  theta: number;
  phi: number;
}

function orbitAngles(
  position: Vector3D,
  target: Vector3D,
): { theta: number; phi: number; radius: number } {
  const rx = position.x - target.x;
  const ry = position.y - target.y;
  const rz = position.z - target.z;
  const radius = Math.hypot(rx, ry, rz);
  return { theta: Math.atan2(rx, rz), phi: Math.asin(ry / radius), radius };
}

describe("orbit strategies: reset round-trips through the position-relative angle convention", () => {
  for (const make of [
    (): SmoothStrategy => new SmoothStrategy(),
    (): StiffStrategy => new StiffStrategy(),
  ]) {
    const strategy = make();
    it(`${strategy.type}: restoring position + orbit angles reproduces the initial pose`, () => {
      strategy.minRadius = 0.1;
      const target = new Vector3D(0, 0.06, 0);
      const initial = new Vector3D(0.67, 0.6, 0.8);
      const cam: FakeCamera = {
        position: initial.clone(),
        target: target.clone(),
        theta: 0,
        phi: 0,
      };
      const data = cam as unknown as CameraInterfaceData;

      strategy.update(data, target, 0, 0); // initializes from the position
      strategy.update(data, target, 400, -120); // user orbits away
      expect(cam.position.y).not.toBeCloseTo(initial.y, 3);

      // What resetCamera() now does for strategies exposing `radius`.
      cam.position.copyFrom(initial);
      const a = orbitAngles(initial, target);
      cam.theta = a.theta;
      cam.phi = a.phi;
      strategy.radius = a.radius;
      strategy.update(data, target, 0, 0);

      expect(cam.position.x).toBeCloseTo(initial.x, 5);
      expect(cam.position.y).toBeCloseTo(initial.y, 5);
      expect(cam.position.z).toBeCloseTo(initial.z, 5);
    });
  }

  it("the look-direction angles (old reset) would mirror the pose below the target", () => {
    const strategy = new SmoothStrategy();
    strategy.minRadius = 0.1;
    const target = new Vector3D(0, 0.06, 0);
    const initial = new Vector3D(0.67, 0.6, 0.8);
    const cam: FakeCamera = { position: initial.clone(), target: target.clone(), theta: 0, phi: 0 };
    const data = cam as unknown as CameraInterfaceData;
    strategy.update(data, target, 0, 0);

    const dir = target.clone().sub(initial).normalize();
    cam.phi = Math.asin(dir.y);
    cam.theta = Math.atan2(dir.x, -dir.z);
    strategy.update(data, target, 0, 0);
    expect(cam.position.y).toBeLessThan(target.y);
  });
});
