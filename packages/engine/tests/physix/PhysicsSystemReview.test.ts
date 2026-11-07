import { describe, it, expect, vi, beforeEach } from "vitest";
import { PhysicsSystem } from "../../src/physix/PhysicsSystem.js";
import { Scene } from "../../src/core/Scene.js";
import { Object3D } from "../../src/core/Object3D.js";
import { RigidBody } from "../../src/physix/RigidBody.js";
import { BoundingSphere } from "../../src/physix/BoundingSphere.js";
import { Vector3D } from "../../src/math/index.js";
import { EventDispatcherImpl } from "../../src/core/events/EventDispatcherImpl.js";

function dynamicBody(name: string): Object3D {
  const o = new Object3D(name);
  o.bounds = new BoundingSphere(o.position, 0.5);
  o.rigidBody = new RigidBody(1);
  return o;
}

describe("PhysicsSystem review fixes", () => {
  beforeEach(() => {
    Object3D.resetNextId();
  });

  it("counts fixed steps dropped by the maxSubSteps spiral-of-death guard", () => {
    const system = new PhysicsSystem(new EventDispatcherImpl());
    system.gravity.set(0, 0, 0);
    system.fixedTimeStep = 1 / 60;
    system.maxSubSteps = 2;
    system.maxDeltaTime = 1;
    const scene = new Scene();
    expect(system.droppedSteps).toBe(0);
    // 10 steps of time, only 2 simulated -> 8 dropped.
    system.step(scene, 10.2 / 60);
    expect(system.droppedSteps).toBe(8);
    // A frame that fits in the budget drops nothing.
    system.step(scene, 1 / 60);
    expect(system.droppedSteps).toBe(8);
  });

  it("warns once about dynamic bodies nested below another object, not about root-level ones", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const system = new PhysicsSystem(new EventDispatcherImpl());
      system.gravity.set(0, 0, 0);
      const scene = new Scene();
      const rootBody = dynamicBody("root");
      scene.add(rootBody);
      const parent = new Object3D("parent");
      scene.add(parent);
      const nested = dynamicBody("nested");
      nested.position.copyFrom(new Vector3D(5, 0, 0));
      parent.add(nested);

      system.step(scene, 1 / 60);
      system.step(scene, 1 / 60);
      const messages = warn.mock.calls.map((c) => String(c[0]));
      expect(messages.filter((m) => m.includes("'nested'")).length).toBe(1);
      expect(messages.some((m) => m.includes("'root'"))).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });
});
