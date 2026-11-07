import { describe, expect, it } from "vitest";
import { SpringLerpBehavior } from "../../../src/core/behaviors/SpringLerpBehavior.js";
import { Object3D } from "../../../src/core/Object3D.js";
import { Vector3D } from "../../../src/math/Vector3D.js";

describe("SpringLerpBehavior", () => {
  const target = new Vector3D(10, 10, 10);

  it("moves the target strictly toward the spring target and never overshoots", () => {
    const obj = new Object3D("testTarget");
    obj.position.set(0, 0, 0);

    const behavior = new SpringLerpBehavior(target, 0.5);
    behavior.onAttach(obj);

    let dist = obj.position.distanceTo(target);
    for (let i = 0; i < 60; i++) {
      behavior.update(1 / 60);
      const nextDist = obj.position.distanceTo(target);
      // Approaches and never overshoots; float convergence to exactly `target` is allowed once the
      // reachable precision is exhausted (the distance can only be zero once reached).
      expect(nextDist).toBeLessThanOrEqual(dist + 1e-12);
      dist = nextDist;
    }
    expect(dist).toBeLessThan(1e-6); // after a second of spring time it must be essentially there
  });

  it("converges onto the spring target over time", () => {
    const obj = new Object3D("testTarget");
    obj.position.set(0, 0, 0);

    const behavior = new SpringLerpBehavior(target, 0.5);
    behavior.onAttach(obj);

    for (let i = 0; i < 2000; i++) {
      behavior.update(1 / 60);
    }

    expect(obj.position.distanceTo(target)).toBeLessThan(1e-3);
  });

  it("is frame-rate independent for equivalent simulation time", () => {
    const fine = new Object3D("fine");
    {
      // 60 steps of 1/60s.
      const fb = new SpringLerpBehavior(target, 0.1);
      fb.onAttach(fine);
      for (let i = 0; i < 60; i++) fb.update(1 / 60);
    }

    const coarse = new Object3D("coarse");
    const b = new SpringLerpBehavior(target, 0.1);
    b.onAttach(coarse);
    for (let i = 0; i < 30; i++) b.update(1 / 30); // half the frames, double the dt

    // Both simulate exactly 1s of spring time -> must end at the same distance.
    const fineDist = fine.position.distanceTo(target);
    const coarseDist = coarse.position.distanceTo(target);
    expect(Math.abs(fineDist - coarseDist)).toBeLessThan(1e-6);
  });

  it("does nothing while no Object3D target is attached", () => {
    const behavior = new SpringLerpBehavior(target, 0.5);
    // No onAttach() -> `target` is undefined; update is a no-op (position untouched, no throw).
    expect(() => behavior.update(1 / 60)).not.toThrow();
  });
});
