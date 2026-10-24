import { describe, it, expect, vi } from "vitest";
import { OrbitController } from "../../src/core/controllers/OrbitController.js";
import type { OrbitControllerOptions } from "../../src/core/controllers/OrbitController.js";
import { Camera } from "../../src/core/cameras/Camera.js";
import { PerspectiveProjection } from "../../src/math/index.js";
import type { InputInterface, MouseState } from "../../src/core/input/Input.js";

class MockInput implements InputInterface {
  public mouse: MouseState = {
    x: 0,
    y: 0,
    dx: 0,
    dy: 0,
    wheelX: 0,
    wheelY: 0,
    zoom: 0,
    left: false,
    right: false,
  };
  public isPointerLocked = false;
  public isPressed(_code: string): boolean {
    return false;
  }
  public getAxis(_neg: string, _pos: string): number {
    return 0;
  }
  public setKey(_code: string, _pressed: boolean): void {}
}

// The dead vertical-clamping knobs `minPhi`/`maxPhi` were removed from the option surface
// (Phase-1 gate R1). These tests pin the controller's LIVE behavior so the removal is safe
// and the previous "OrbitController: 0 tests" verification hole stays closed.
describe("OrbitController", () => {
  it("throws when no input source is provided", () => {
    expect(() => new OrbitController({} as OrbitControllerOptions)).toThrow(/input/);
  });

  it("accumulates pointer-locked mouse deltas into camera.pendingDx/pendingDy", () => {
    const cam = new Camera(new PerspectiveProjection());
    const input = new MockInput();
    const controller = new OrbitController({ input });
    controller.onAttach(cam);

    input.isPointerLocked = true;
    input.mouse.dx = 3;
    input.mouse.dy = -5;

    controller.update(0);

    expect(cam.pendingDx).toBe(3);
    expect(cam.pendingDy).toBe(-5);
    expect(cam.pendingDx).not.toBe(0);
  });

  it("accumulates mouse deltas while the left mouse button is held", () => {
    const cam = new Camera(new PerspectiveProjection());
    const input = new MockInput();
    const controller = new OrbitController({ input });
    controller.onAttach(cam);

    input.mouse.left = true;
    input.mouse.dx = 7;

    controller.update(0);

    expect(cam.pendingDx).toBe(7);
  });

  it("delegates mouse-wheel zoom to the camera", () => {
    const cam = new Camera(new PerspectiveProjection());
    const input = new MockInput();
    const controller = new OrbitController({ input });
    controller.onAttach(cam);

    const zoomSpy = vi.spyOn(cam, "zoom");
    input.mouse.zoom = 0.5;

    controller.update(0);

    expect(zoomSpy).toHaveBeenCalledTimes(1);
    expect(zoomSpy).toHaveBeenCalledWith(0.05);
    zoomSpy.mockRestore();
  });

  it("does not accumulate rotation when enableRotation is false", () => {
    const cam = new Camera(new PerspectiveProjection());
    const input = new MockInput();
    const controller = new OrbitController({ input, enableRotation: false });
    controller.onAttach(cam);

    input.isPointerLocked = true;
    input.mouse.dx = 3;

    controller.update(0);

    expect(cam.pendingDx).toBe(0);
  });
});
