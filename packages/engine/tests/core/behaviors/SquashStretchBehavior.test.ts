import { SquashStretchBehavior } from "../../../src/core/behaviors/SquashStretchBehavior.js";
import { Object3D } from "../../../src/core/Object3D.js";

describe("SquashStretchBehavior", () => {
  it("captures the target's scale at attach time as the base scale", () => {
    const target = new Object3D("test");
    target.scale.set(2, 3, 4);

    const behavior = new SquashStretchBehavior();
    behavior.onAttach(target);
    behavior.update(1 / 60);

    // With no trigger, offset stays 0 -- scale must remain exactly the captured base scale.
    expect(target.scale.x).toBeCloseTo(2, 5);
    expect(target.scale.y).toBeCloseTo(3, 5);
    expect(target.scale.z).toBeCloseTo(4, 5);
  });

  it("squashes Y down and stretches X/Z out immediately after trigger", () => {
    const target = new Object3D("test");
    target.scale.set(1, 1, 1);

    const behavior = new SquashStretchBehavior();
    behavior.onAttach(target);
    behavior.trigger(0.4);
    behavior.update(0); // apply the impulse without letting the spring integrate yet

    expect(target.scale.y).toBeCloseTo(1 * (1 - 0.4), 5);
    expect(target.scale.x).toBeCloseTo(1 * (1 + 0.5 * 0.4), 5);
    expect(target.scale.z).toBeCloseTo(1 * (1 + 0.5 * 0.4), 5);
  });

  it("settles back to the base scale over time via the damped spring", () => {
    const target = new Object3D("test");
    target.scale.set(1, 1, 1);

    const behavior = new SquashStretchBehavior();
    behavior.onAttach(target);
    behavior.trigger(0.4);

    for (let i = 0; i < 600; i++) {
      behavior.update(1 / 60);
    }

    expect(target.scale.x).toBeCloseTo(1, 2);
    expect(target.scale.y).toBeCloseTo(1, 2);
    expect(target.scale.z).toBeCloseTo(1, 2);
  });
});
