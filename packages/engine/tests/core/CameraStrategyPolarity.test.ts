import { describe, it, expect } from "vitest";
import { Camera } from "../../src/core/cameras/Camera.js";
import type { FPSStrategy } from "../../src/core/cameras/strategies/FPSStrategy.js";
import { PerspectiveProjection, Vector3D } from "../../src/math/index.js";
import { CameraStrategyType } from "../../src/enums/index.js";

// R2: industry-standard "non-inverted / natural pitch". dy > 0 (mouse pulled down) must LOWER
// the view (decrease target.y - position.y) in EVERY camera strategy. FPS used to invert the
// relation vs. the orbit strategies -> control break on strategy switch. An invariant golden
// test pins the unified dy direction; `invertY` is the explicit legacy escape hatch.
function viewRise(cam: Camera): number {
  return cam.target.y - cam.position.y;
}

describe("CameraStrategy unified vertical pitch polarity (R2)", () => {
  it("FPS: dy > 0 lowers the view (natural pitch)", () => {
    const cam = new Camera(new PerspectiveProjection());
    cam.setStrategy(CameraStrategyType.FPS);
    cam.position.set(0, 2, 0);
    cam.update(cam.target, 0, 0, 0);
    const before = viewRise(cam);
    cam.update(cam.target, 0, 8, 0);
    expect(viewRise(cam)).toBeLessThan(before);
  });

  it("FPS: invertY = true restores the legacy rising view", () => {
    const cam = new Camera(new PerspectiveProjection());
    cam.setStrategy(CameraStrategyType.FPS);
    (cam.strategy as FPSStrategy).invertY = true;
    cam.position.set(0, 2, 0);
    cam.update(cam.target, 0, 0, 0);
    const before = viewRise(cam);
    cam.update(cam.target, 0, 8, 0);
    expect(viewRise(cam)).toBeGreaterThan(before);
  });

  it("SMOOTH: dy > 0 lowers the view (camera rises above target) - same direction as FPS", () => {
    const cam = new Camera(new PerspectiveProjection());
    cam.setStrategy(CameraStrategyType.SMOOTH);
    const target = new Vector3D(0, 0, 0);
    cam.position.set(10, 5, 0);
    cam.update(target, 0, 0, 0); // orbit init
    const before = viewRise(cam);
    cam.update(target, 0, 8, 0);
    expect(viewRise(cam)).toBeLessThan(before);
  });

  it("STIFF: dy > 0 lowers the view (camera rises above target) - same direction as FPS", () => {
    const cam = new Camera(new PerspectiveProjection());
    cam.setStrategy(CameraStrategyType.STIFF);
    const target = new Vector3D(0, 0, 0);
    cam.position.set(10, 5, 0);
    cam.update(target, 0, 0, 0);
    const before = viewRise(cam);
    cam.update(target, 0, 8, 0);
    expect(viewRise(cam)).toBeLessThan(before);
  });
});

// D3: switching strategies must be an EXPLICIT state transition. The orbit strategies derive
// their own radius/theta/phi from position -> target on first update; entering FPS used to
// reuse the orbit-convention theta/phi blindly, which flips the view ~180 deg (control break).
describe("CameraStrategy explicit transition preserves the view (D3)", () => {
  it("SMOOTH -> FPS keeps the view direction (no snap/inversion)", () => {
    const cam = new Camera(new PerspectiveProjection());
    cam.setStrategy(CameraStrategyType.SMOOTH);
    const target = new Vector3D(0, 0, 0);
    cam.position.set(10, 5, 0);
    cam.update(target, 0, 0, 0); // orbit init

    const fwd0 = new Vector3D(
      target.x - cam.position.x,
      target.y - cam.position.y,
      target.z - cam.position.z,
    ).normalize();

    cam.setStrategy(CameraStrategyType.FPS); // explicit conversion must preserve the view
    cam.update(cam.target, 0, 0, 0);

    const fwd1 = new Vector3D(
      cam.target.x - cam.position.x,
      cam.target.y - cam.position.y,
      cam.target.z - cam.position.z,
    ).normalize();

    expect(fwd1.x).toBeCloseTo(fwd0.x, 4);
    expect(fwd1.y).toBeCloseTo(fwd0.y, 4);
    expect(fwd1.z).toBeCloseTo(fwd0.z, 4);
  });

  it("FPS -> SMOOTH keeps the view direction", () => {
    const cam = new Camera(new PerspectiveProjection());
    cam.setStrategy(CameraStrategyType.FPS);
    cam.position.set(3, 4, 5);
    cam.theta = 0.7;
    cam.phi = 0.3;
    cam.update(cam.target, 0, 0, 0);
    const target0 = new Vector3D(cam.target.x, cam.target.y, cam.target.z).clone();

    const fwd0 = new Vector3D(
      target0.x - cam.position.x,
      target0.y - cam.position.y,
      target0.z - cam.position.z,
    ).normalize();

    cam.setStrategy(CameraStrategyType.SMOOTH);
    cam.update(target0, 0, 0, 0); // orbit self-initializes from position -> target

    const fwd1 = new Vector3D(
      cam.target.x - cam.position.x,
      cam.target.y - cam.position.y,
      cam.target.z - cam.position.z,
    ).normalize();

    expect(fwd1.x).toBeCloseTo(fwd0.x, 4);
    expect(fwd1.y).toBeCloseTo(fwd0.y, 4);
    expect(fwd1.z).toBeCloseTo(fwd0.z, 4);
  });
});
