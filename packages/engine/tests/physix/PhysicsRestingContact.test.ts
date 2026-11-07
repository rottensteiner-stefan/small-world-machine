import { PENETRATION_SLOP } from "../../src/physix/solvers/ContactSolver.js";
import { describe, it, expect, beforeEach } from "vitest";
import { PhysicsSystem } from "../../src/physix/PhysicsSystem.js";
import { Scene } from "../../src/core/Scene.js";
import { Object3D } from "../../src/core/Object3D.js";
import { RigidBody } from "../../src/physix/RigidBody.js";
import { BoundingSphere } from "../../src/physix/BoundingSphere.js";
import { BoundingBox } from "../../src/physix/BoundingBox.js";
import { Vector3D } from "../../src/math/index.js";
import { EventDispatcherImpl } from "../../src/core/events/EventDispatcherImpl.js";

describe("PhysicsSystem Resting Contact Convergence", () => {
  let system: PhysicsSystem;
  let scene: Scene;
  let events: EventDispatcherImpl;

  beforeEach(() => {
    events = new EventDispatcherImpl();
    system = new PhysicsSystem(events);
    system.gravity.set(0, -9.81, 0);
    scene = new Scene();
  });

  it("converges to a steady resting position without continuous oscillation", () => {
    // Static ground box with top surface at y = 0
    const ground = new Object3D();
    ground.rigidBody = new RigidBody(0); // static body (mass = 0)
    ground.bounds = new BoundingBox(new Vector3D(-100, -10, -100), new Vector3D(100, 0, 100));
    scene.add(ground);

    // Falling sphere (r = 1, mass = 1, no restitution)
    const sphere = new Object3D();
    sphere.position.set(0, 3, 0);
    sphere.bounds = new BoundingSphere(sphere.position, 1.0);
    const rb = new RigidBody(1.0);
    rb.restitution = 0.0;
    sphere.rigidBody = rb;
    scene.add(sphere);

    // Simulate 300 steps at 60Hz
    const dt = 1 / 60;
    const yHistory: number[] = [];

    for (let i = 0; i < 300; i++) {
      system.step(scene, dt);
      yHistory.push(sphere.position.y);
    }

    // Inspect last 30 frames: position should be at ground (y = 1.0) and steady
    const last30 = yHistory.slice(-30);
    const min = Math.min(...last30);
    const max = Math.max(...last30);

    // Sphere radius is 1.0, ground top is y = 0, so resting height is exactly 1.0
    // (the solver tolerates PENETRATION_SLOP of overlap by design, so it rests at 1 - slop).
    expect(sphere.position.y).toBeLessThanOrEqual(1.0 + 1e-6);
    expect(sphere.position.y).toBeGreaterThanOrEqual(1.0 - PENETRATION_SLOP - 1e-6);
    // Delta between min and max over 30 frames should be negligible (no bouncing/oscillating)
    expect(max - min).toBeLessThan(0.005);
  });
});
