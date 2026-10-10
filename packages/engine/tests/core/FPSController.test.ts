import { describe, it, expect } from "vitest";
import { FPSController } from "../../src/core/controllers/FPSController.js";
import { Camera } from "../../src/core/cameras/Camera.js";
import { PerspectiveProjection } from "../../src/math/index.js";
import { InputInterface, MouseState } from "../../src/core/input/Input.js";
import { Keys } from "../../src/enums/Keys.js";
import { CameraStrategyType } from "../../src/enums/index.js";

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
  private _keys = new Map<string, boolean>();

  public isPressed(code: string): boolean {
    return !!this._keys.get(code);
  }

  public getAxis(neg: string, pos: string): number {
    let v = 0;
    if (this.isPressed(neg)) v -= 1;
    if (this.isPressed(pos)) v += 1;
    return v;
  }

  public setKey(code: string, pressed: boolean): void {
    this._keys.set(code, pressed);
  }
}

describe("FPSController Movement Regressions", () => {
  it("should move forward (-Z) when W is pressed and theta is 0", () => {
    const cam = new Camera(new PerspectiveProjection());
    cam.setStrategy(CameraStrategyType.FPS);
    cam.position.set(0, 0, 0);
    cam.theta = 0; // Looking towards -Z
    cam.phi = 0;

    // Initial sync
    cam.update(cam.target, 0, 0, 0);

    const input = new MockInput();
    const controller = new FPSController({ input, moveSpeed: 10 });
    controller.onAttach(cam);

    input.setKey(Keys.W, true);
    controller.update(1.0); // Move for 1 second

    // With theta=0, look direction is (0, 0, -1)
    expect(cam.position.z).toBeCloseTo(-10);
  });

  it("should move backward (+Z) when S is pressed and theta is 0", () => {
    const cam = new Camera(new PerspectiveProjection());
    cam.setStrategy(CameraStrategyType.FPS);
    cam.position.set(0, 0, 0);
    cam.theta = 0;
    cam.phi = 0;
    cam.update(cam.target, 0, 0, 0);

    const input = new MockInput();
    const controller = new FPSController({ input, moveSpeed: 10 });
    controller.onAttach(cam);

    input.setKey(Keys.S, true);
    controller.update(1.0);

    expect(cam.position.z).toBeCloseTo(10);
  });

  it("should move right (+X) when W is pressed and theta is PI/2", () => {
    const cam = new Camera(new PerspectiveProjection());
    cam.setStrategy(CameraStrategyType.FPS);
    cam.position.set(0, 0, 0);
    cam.theta = Math.PI / 2; // Looking towards +X
    cam.phi = 0;
    cam.update(cam.target, 0, 0, 0);

    const input = new MockInput();
    const controller = new FPSController({ input, moveSpeed: 10 });
    controller.onAttach(cam);

    input.setKey(Keys.W, true);
    controller.update(1.0);

    expect(cam.position.x).toBeCloseTo(10);
    expect(cam.position.z).toBeCloseTo(0);
  });
});
