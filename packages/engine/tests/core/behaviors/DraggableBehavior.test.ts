import { describe, expect, it } from "vitest";
import { attachBehavior, detachBehavior } from "../../../src/core/behaviors/Behavior.js";
import { DraggableBehavior } from "../../../src/core/behaviors/DraggableBehavior.js";
import { Object3D } from "../../../src/core/Object3D.js";
import { Camera } from "../../../src/core/cameras/Camera.js";
import { PerspectiveProjection } from "../../../src/math/projections/PerspectiveProjection.js";
import { Ray } from "../../../src/physix/index.js";
import { Vector3D } from "../../../src/math/index.js";

function makeCamera(): Camera {
  const camera = new Camera(new PerspectiveProjection());
  camera.position.set(0, 0, 5);
  camera.target.set(0, 0, 0);
  return camera;
}

describe("DraggableBehavior", () => {
  it("clears the target's pointer handlers on detach instead of leaving them live", () => {
    const obj = new Object3D("test");
    const behavior = new DraggableBehavior(makeCamera());
    attachBehavior(obj.behaviors, behavior, obj);

    expect(obj.onPointerDown).toBeDefined();
    expect(obj.onPointerUp).toBeDefined();
    expect(obj.onPointerMove).toBeDefined();

    detachBehavior(obj.behaviors, behavior);

    expect(behavior.target).toBeUndefined();
    expect(obj.onPointerDown).toBeUndefined();
    expect(obj.onPointerUp).toBeUndefined();
    expect(obj.onPointerMove).toBeUndefined();
  });

  it("does not clobber a different behavior's pointer handlers set after it", () => {
    // Mirrors HoverBehavior's identity-check test: onPointerDown/Up/Move are single-slot
    // callbacks on Object3D, so onDetach() must only clear them if they still hold this
    // behavior's own closures -- not unconditionally, which would erase whatever a later
    // behavior wired up in the meantime.
    const obj = new Object3D("test");
    const behavior = new DraggableBehavior(makeCamera());
    attachBehavior(obj.behaviors, behavior, obj);

    const otherDown = (): void => {};
    const otherUp = (): void => {};
    const otherMove = (): void => {};
    obj.onPointerDown = otherDown;
    obj.onPointerUp = otherUp;
    obj.onPointerMove = otherMove;

    detachBehavior(obj.behaviors, behavior);

    expect(obj.onPointerDown).toBe(otherDown);
    expect(obj.onPointerUp).toBe(otherUp);
    expect(obj.onPointerMove).toBe(otherMove);
  });

  it("stops updating the target's position after detach even if a stray pointer move fires", () => {
    const obj = new Object3D("test");
    obj.position.set(0, 0, 0);
    const behavior = new DraggableBehavior(makeCamera());
    attachBehavior(obj.behaviors, behavior, obj);

    const down = obj.onPointerDown!;
    down(new Ray(new Vector3D(0, 0, 5), new Vector3D(0, 0, -1)), new Vector3D(0, 0, 0));

    detachBehavior(obj.behaviors, behavior);

    // A stray move after detach must be a no-op: the handler slot itself is now undefined.
    expect(obj.onPointerMove).toBeUndefined();
    expect(obj.position.x).toBe(0);
  });
});
