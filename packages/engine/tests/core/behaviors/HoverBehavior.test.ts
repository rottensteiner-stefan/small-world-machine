import { describe, expect, it } from "vitest";
import { attachBehavior, detachBehavior } from "../../../src/core/behaviors/Behavior.js";
import { HoverBehavior } from "../../../src/core/behaviors/HoverBehavior.js";
import { Object3D } from "../../../src/core/Object3D.js";
import { StandardMaterial } from "../../../src/core/materials/index.js";

function settle(behavior: HoverBehavior): void {
  for (let i = 0; i < 200; i++) behavior.update(0.05);
}

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

  it("applies configurable emissiveColor, emissiveIntensity, and updates hoverMultiplier", () => {
    const obj = new Object3D("test");
    obj.material = new StandardMaterial();
    const behavior = new HoverBehavior(1.2);
    behavior.emissiveColor.set(1.0, 0.5, 0.0);
    behavior.emissiveIntensity = 3.5;
    attachBehavior(obj.behaviors, behavior, obj);

    expect(behavior.isHovered).toBe(false);
    obj.onPointerEnter?.();
    expect(behavior.isHovered).toBe(true);

    const mat = obj.material as StandardMaterial;
    expect(mat.emissiveColor.r).toBeCloseTo(1.0);
    expect(mat.emissiveColor.g).toBeCloseTo(0.5);
    expect(mat.emissiveColor.b).toBeCloseTo(0.0);
    expect(mat.emissiveIntensity).toBe(3.5);

    obj.onPointerLeave?.();
    expect(behavior.isHovered).toBe(false);
  });

  it("scales toward baseScale * hoverMultiplier, honoring a multiplier changed while hovered", () => {
    const obj = new Object3D("test");
    obj.material = new StandardMaterial();
    obj.setScale(2);
    const behavior = new HoverBehavior(1.5);
    attachBehavior(obj.behaviors, behavior, obj);

    obj.onPointerEnter?.();
    settle(behavior);
    expect(obj.scale.x).toBeCloseTo(3.0, 2);

    behavior.hoverMultiplier = 2.0;
    settle(behavior);
    expect(obj.scale.x).toBeCloseTo(4.0, 2);

    obj.onPointerLeave?.();
    settle(behavior);
    expect(obj.scale.x).toBeCloseTo(2.0, 2);
  });

  it("restores the original emissive color and intensity on leave", () => {
    const obj = new Object3D("test");
    const mat = new StandardMaterial();
    mat.emissiveColor.set(0.1, 0.2, 0.3);
    mat.emissiveIntensity = 0.7;
    obj.material = mat;
    attachBehavior(obj.behaviors, new HoverBehavior(1.5), obj);

    obj.onPointerEnter?.();
    obj.onPointerEnter?.(); // repeated enter must not overwrite the saved original with the glow
    obj.onPointerLeave?.();

    const own = obj.material as StandardMaterial;
    expect(own.emissiveColor.r).toBeCloseTo(0.1);
    expect(own.emissiveColor.g).toBeCloseTo(0.2);
    expect(own.emissiveColor.b).toBeCloseTo(0.3);
    expect(own.emissiveIntensity).toBeCloseTo(0.7);
  });

  it("leaves a shared material untouched when enter is rejected (disabled / inactive) but leave still fires", () => {
    const shared = new StandardMaterial();
    shared.emissiveColor.set(0.4, 0.4, 0.4);
    shared.emissiveIntensity = 3.0;
    const a = new Object3D("a");
    a.material = shared;
    const behavior = new HoverBehavior(1.5);
    attachBehavior(a.behaviors, behavior, a);

    behavior.enabled = false;
    a.onPointerEnter?.();
    a.onPointerLeave?.();
    expect(a.material).toBe(shared);
    expect(shared.emissiveColor.r).toBeCloseTo(0.4);
    expect(shared.emissiveIntensity).toBe(3.0);
    expect(behavior.isHovered).toBe(false);

    behavior.enabled = true;
    detachBehavior(a.behaviors, behavior); // isActive false path: re-wire handlers manually
    const b = new Object3D("b");
    b.material = shared;
    const inactive = new HoverBehavior(1.5);
    attachBehavior(b.behaviors, inactive, b);
    const enter = b.onPointerEnter;
    const leave = b.onPointerLeave;
    detachBehavior(b.behaviors, inactive);
    enter?.();
    leave?.();
    expect(shared.emissiveColor.r).toBeCloseTo(0.4);
    expect(shared.emissiveIntensity).toBe(3.0);
  });
});
