import { describe, expect, it } from "vitest";
import { attachBehavior, detachBehavior } from "../../../src/core/behaviors/Behavior.js";
import { HoverBehavior } from "../../../src/core/behaviors/HoverBehavior.js";
import { Object3D } from "../../../src/core/Object3D.js";
import { StandardMaterial } from "../../../src/core/materials/index.js";

describe("HoverBehavior", () => {
  it("scales up and glows on pointer enter, reverts on pointer leave", () => {
    const obj = new Object3D("test");
    obj.material = new StandardMaterial();
    const behavior = new HoverBehavior(1.5);
    attachBehavior(obj.behaviors, behavior, obj);

    obj.onPointerEnter?.();
    expect((obj.material as StandardMaterial).emissiveIntensity).toBe(2.0);

    obj.onPointerLeave?.();
    expect((obj.material as StandardMaterial).emissiveIntensity).toBe(1.0);
  });

  it("keeps a shared material shared until the object is actually hovered", () => {
    const shared = new StandardMaterial();
    const a = new Object3D("a");
    const b = new Object3D("b");
    a.material = shared;
    b.material = shared;
    attachBehavior(a.behaviors, new HoverBehavior(1.5), a);
    attachBehavior(b.behaviors, new HoverBehavior(1.5), b);

    expect(a.material).toBe(shared);
    expect(b.material).toBe(shared);

    a.onPointerEnter?.();
    expect(a.material).not.toBe(shared);
    expect(b.material).toBe(shared);
    expect(shared.emissiveIntensity).toBe(1.0);

    // The private copy is made once and reused on later hovers.
    const own = a.material;
    a.onPointerLeave?.();
    a.onPointerEnter?.();
    expect(a.material).toBe(own);
  });

  it("clears the target's pointer handlers on detach instead of leaving them live", () => {
    const obj = new Object3D("test");
    obj.material = new StandardMaterial();
    const behavior = new HoverBehavior(1.5);
    attachBehavior(obj.behaviors, behavior, obj);
    detachBehavior(obj.behaviors, behavior);

    expect(behavior.target).toBeUndefined();
    expect(obj.onPointerEnter).toBeUndefined();
    expect(obj.onPointerLeave).toBeUndefined();

    // A stray hover after detach must not mutate the material anymore.
    const intensityBefore = (obj.material as StandardMaterial).emissiveIntensity;
    obj.onPointerEnter?.();
    expect((obj.material as StandardMaterial).emissiveIntensity).toBe(intensityBefore);
  });

  it("does not clobber a different behavior's pointer handlers set after it", () => {
    const obj = new Object3D("test");
    const behavior = new HoverBehavior(1.5);
    attachBehavior(obj.behaviors, behavior, obj);

    const otherHandler = (): void => {};
    obj.onPointerEnter = otherHandler;

    detachBehavior(obj.behaviors, behavior);

    expect(obj.onPointerEnter).toBe(otherHandler);
  });
});
