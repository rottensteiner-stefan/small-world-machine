import { describe, it, expect } from "vitest";
import { InteractionManager } from "../../../src/core/input/InteractionManager.js";
import { Scene } from "../../../src/core/Scene.js";
import { Camera } from "../../../src/core/cameras/Camera.js";
import { PerspectiveProjection } from "../../../src/math/projections/PerspectiveProjection.js";
import { Object3D } from "../../../src/core/Object3D.js";
import { Cube } from "../../../src/geometry/Cube.js";
import type { InputInterface, MouseState } from "../../../src/core/input/Input.js";

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

function createMockCanvas(): HTMLCanvasElement {
  const canvas = {
    clientWidth: 800,
    clientHeight: 600,
    getBoundingClientRect: () => ({
      left: 0,
      top: 0,
      width: 800,
      height: 600,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: (): void => {},
    }),
  } as unknown as HTMLCanvasElement;
  return canvas;
}

describe("InteractionManager", () => {
  it("tracks hovered object and fires enter/leave events", () => {
    const scene = new Scene();
    const camera = new Camera(new PerspectiveProjection());
    camera.position.set(0, 0, 5);
    camera.target.set(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateViewMatrix();

    const canvas = createMockCanvas();
    const input = new MockInput();
    const manager = new InteractionManager(scene, camera, canvas, input);

    const cube = new Object3D("testCube");
    cube.geometry = new Cube({ size: 2.0 }).getGeometryData();
    cube.isPickable = true;
    cube.computeBounds();
    scene.add(cube);

    let entered = false;
    let left = false;
    cube.onPointerEnter = (): void => {
      entered = true;
    };
    cube.onPointerLeave = (): void => {
      left = true;
    };

    // Center of canvas: (400, 300) -> NDC (0, 0) -> hits cube at (0, 0, 0)
    input.mouse.x = 400;
    input.mouse.y = 300;
    manager.update();

    expect(entered).toBe(true);
    expect(manager.hoveredObject).toBe(cube);

    // Move outside cube: (10, 10)
    input.mouse.x = 10;
    input.mouse.y = 10;
    manager.update();

    expect(left).toBe(true);
    expect(manager.hoveredObject).toBeNull();
  });

  it("fires onPointerClick when mouse is released within drag threshold", () => {
    const scene = new Scene();
    const camera = new Camera(new PerspectiveProjection());
    camera.position.set(0, 0, 5);
    camera.target.set(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateViewMatrix();

    const canvas = createMockCanvas();
    const input = new MockInput();
    const manager = new InteractionManager(scene, camera, canvas, input);

    const cube = new Object3D("testCube");
    cube.geometry = new Cube({ size: 2.0 }).getGeometryData();
    cube.isPickable = true;
    cube.computeBounds();
    scene.add(cube);

    let clicks = 0;
    cube.onPointerClick = (): void => {
      clicks++;
    };

    input.mouse.x = 400;
    input.mouse.y = 300;
    manager.update();

    // Mouse down
    input.mouse.left = true;
    manager.update();
    expect(manager.activeObject).toBe(cube);

    // Mouse up without moving
    input.mouse.left = false;
    manager.update();

    expect(clicks).toBe(1);
    expect(manager.activeObject).toBeNull();
  });

  it("does not fire onPointerClick when mouse was dragged beyond threshold", () => {
    const scene = new Scene();
    const camera = new Camera(new PerspectiveProjection());
    camera.position.set(0, 0, 5);
    camera.target.set(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateViewMatrix();

    const canvas = createMockCanvas();
    const input = new MockInput();
    const manager = new InteractionManager(scene, camera, canvas, input);

    const cube = new Object3D("testCube");
    cube.geometry = new Cube({ size: 4.0 }).getGeometryData();
    cube.isPickable = true;
    cube.computeBounds();
    scene.add(cube);

    let clicks = 0;
    cube.onPointerClick = (): void => {
      clicks++;
    };

    input.mouse.x = 400;
    input.mouse.y = 300;
    manager.update();

    // Mouse down at 400, 300
    input.mouse.left = true;
    manager.update();

    // Drag 30 pixels (beyond default clickDragThreshold = 6)
    input.mouse.x = 430;
    input.mouse.y = 300;
    manager.update();

    // Mouse up
    input.mouse.left = false;
    manager.update();

    expect(clicks).toBe(0);
    expect(manager.activeObject).toBeNull();
  });

  it("releases activeObject when pointer leaves canvas and mouse is released", () => {
    const scene = new Scene();
    const camera = new Camera(new PerspectiveProjection());
    camera.position.set(0, 0, 5);
    camera.target.set(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateViewMatrix();

    const canvas = createMockCanvas();
    const input = new MockInput();
    const manager = new InteractionManager(scene, camera, canvas, input);

    const cube = new Object3D("testCube");
    cube.geometry = new Cube({ size: 2.0 }).getGeometryData();
    cube.isPickable = true;
    cube.computeBounds();
    scene.add(cube);

    let released = false;
    cube.onPointerUp = (): void => {
      released = true;
    };

    input.mouse.x = 400;
    input.mouse.y = 300;
    input.mouse.left = true;
    manager.update();
    expect(manager.activeObject).toBe(cube);

    // Mouse goes outside canvas (<0) and button is released
    input.mouse.x = -50;
    input.mouse.y = 300;
    input.mouse.left = false;
    manager.update();

    expect(released).toBe(true);
    expect(manager.activeObject).toBeNull();
  });
});

function setup(): {
  manager: InteractionManager;
  input: MockInput;
  cube: Object3D;
  log: string[];
} {
  const scene = new Scene();
  const camera = new Camera(new PerspectiveProjection());
  camera.position.set(0, 0, 5);
  camera.target.set(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateViewMatrix();
  const input = new MockInput();
  const manager = new InteractionManager(scene, camera, createMockCanvas(), input);
  const cube = new Object3D("cube");
  cube.geometry = new Cube({ size: 4.0 }).getGeometryData();
  cube.isPickable = true;
  cube.computeBounds();
  scene.add(cube);
  const log: string[] = [];
  cube.onPointerUp = (): void => {
    log.push("up");
  };
  cube.onPointerClick = (): void => {
    log.push("click");
  };
  input.mouse.x = 400;
  input.mouse.y = 300;
  manager.update();
  return { manager, input, cube, log };
}

describe("InteractionManager click threshold and pointer lock", () => {
  it("counts small jitter as a click and the threshold itself as inclusive (<=)", () => {
    const { manager, input, log } = setup();
    input.mouse.left = true;
    manager.update();
    input.mouse.x = 400 + manager.clickDragThreshold; // exactly 6 px
    manager.update();
    input.mouse.left = false;
    manager.update();
    expect(log).toEqual(["up", "click"]);
  });

  it("does not click one pixel beyond the threshold", () => {
    const { manager, input, log } = setup();
    input.mouse.left = true;
    manager.update();
    input.mouse.x = 400 + manager.clickDragThreshold + 1;
    manager.update();
    input.mouse.left = false;
    manager.update();
    expect(log).toEqual(["up"]);
  });

  it("measures the threshold from press to release, not accumulated jitter", () => {
    const { manager, input, log } = setup();
    input.mouse.left = true;
    manager.update();
    for (const dx of [4, -4, 4, -4, 3]) {
      input.mouse.x = 400 + dx;
      manager.update();
    }
    input.mouse.left = false;
    manager.update();
    expect(log).toEqual(["up", "click"]);
  });

  it("on pointer lock release fires onPointerUp but never onPointerClick, and keeps the press while held", () => {
    const { manager, input, cube, log } = setup();
    input.mouse.left = true;
    manager.update();
    expect(manager.activeObject).toBe(cube);

    input.isPointerLocked = true;
    manager.update(); // still held: press stays active, hover cleared
    expect(manager.activeObject).toBe(cube);
    expect(manager.hoveredObject).toBeNull();
    expect(log).toEqual([]);

    input.mouse.left = false;
    manager.update();
    expect(log).toEqual(["up"]);
    expect(manager.activeObject).toBeNull();
  });
});
