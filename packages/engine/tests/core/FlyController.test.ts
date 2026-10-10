import { describe, it, expect, beforeEach } from "vitest";
import { FlyController } from "../../src/core/controllers/FlyController.js";
import { Camera } from "../../src/core/cameras/Camera.js";
import { Scene } from "../../src/core/Scene.js";
import { Object3D } from "../../src/core/Object3D.js";
import { Cube } from "../../src/geometry/Cube.js";
import { Keys } from "../../src/enums/Keys.js";
import { CameraStrategyType } from "../../src/enums/CameraStrategyType.js";
import { Vector3D, PerspectiveProjection } from "../../src/math/index.js";
import { Octree } from "../../src/core/culling/Octree.js";
import { BoundingBox } from "../../src/physix/BoundingBox.js";
import { InputInterface, MouseState } from "../../src/core/input/Input.js";

// Mock InputInterface
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

describe("FlyController", () => {
  let camera: Camera;
  let mockInput: MockInput;
  let scene: Scene;

  beforeEach(() => {
    camera = new Camera(new PerspectiveProjection());
    camera.setStrategy(CameraStrategyType.FPS);
    camera.position.set(0, 5, 10);
    camera.target.set(0, 5, 0);
    camera.theta = 0; // Look toward -Z
    camera.phi = 0;

    mockInput = new MockInput();
    scene = new Scene();
  });

  it("should initialize with default options", () => {
    const controller = new FlyController({
      input: mockInput,
    });
    camera.addBehavior(controller);

    expect(controller.enabled).toBe(true);
    expect(controller.moveSpeed).toBe(7.0);
    expect(controller.fastMultiplier).toBe(2.5);
    expect(controller.slowMultiplier).toBe(0.35);
  });

  it("should fly forward when W key is pressed", () => {
    const controller = new FlyController({
      input: mockInput,
      moveSpeed: 10,
    });
    camera.addBehavior(controller);

    // Camera looking along -Z
    mockInput.setKey(Keys.W, true);
    const startZ = camera.position.z;

    // Simulate 0.1s delta
    controller.update(0.1);

    expect(camera.position.z).toBeLessThan(startZ);
  });

  it("should ascend when Space or E is pressed", () => {
    const controller = new FlyController({
      input: mockInput,
      moveSpeed: 10,
    });
    camera.addBehavior(controller);

    mockInput.setKey(Keys.SPACE, true);
    const startY = camera.position.y;

    controller.update(0.1);

    expect(camera.position.y).toBeGreaterThan(startY);
  });

  it("should descend when C or Q is pressed", () => {
    const controller = new FlyController({
      input: mockInput,
      moveSpeed: 10,
    });
    camera.addBehavior(controller);

    mockInput.setKey(Keys.C, true);
    const startY = camera.position.y;

    controller.update(0.1);

    expect(camera.position.y).toBeLessThan(startY);
  });

  it("should boost speed with Shift key", () => {
    const controllerNormal = new FlyController({
      input: mockInput,
      moveSpeed: 10,
      fastMultiplier: 2.0,
    });
    camera.addBehavior(controllerNormal);

    mockInput.setKey(Keys.W, true);
    controllerNormal.update(0.1);
    const normalDist = 10 - camera.position.z;

    // Reset and test with Shift
    camera.position.set(0, 5, 10);
    mockInput.setKey(Keys.SHIFT_L, true);
    controllerNormal.update(0.1);
    const boostDist = 10 - camera.position.z;

    expect(boostDist).toBeCloseTo(normalDist * 2.0, 3);
  });

  it("should resolve solid collisions against scene obstacles", () => {
    // Setup scene with a solid wall cube at (0, 5, 0) of size 2 (spans -1..1 in x, 4..6 in y, -1..1 in z)
    scene.staticOctree = new Octree(
      new BoundingBox(new Vector3D(-20, -20, -20), new Vector3D(20, 20, 20)),
      { maxDepth: 4, maxObjects: 8 },
    );

    const wall = new Object3D("Wall");
    wall.isStatic = true;
    wall.geometry = new Cube({ size: 2 }).getGeometryData();
    wall.position.set(0, 5, 0);
    scene.add(wall);
    scene.update(0);
    scene.updateStaticOctree();

    // Position camera just outside the wall at Z = 1.6, moving forward toward Z = 0
    camera.position.set(0, 5, 1.6);
    camera.target.set(0, 5, 0);

    const controller = new FlyController({
      input: mockInput,
      scene,
      moveSpeed: 10,
      collisionRadius: 0.5,
    });
    camera.addBehavior(controller);

    // Try flying straight through the wall
    mockInput.setKey(Keys.W, true);
    for (let i = 0; i < 10; i++) {
      controller.update(0.1);
    }

    // Camera radius is 0.5, wall front surface is at Z = 1.0 -> Camera should not penetrate past Z = 1.5
    expect(camera.position.z).toBeGreaterThanOrEqual(1.49);
  });
});
