import { describe, expect, it } from "vitest";
import { PhysicsSystem } from "../../src/physix/PhysicsSystem.js";
import { Scene } from "../../src/core/Scene.js";
import { Object3D } from "../../src/core/Object3D.js";
import { RigidBody } from "../../src/physix/RigidBody.js";
import { BoundingSphere } from "../../src/physix/BoundingSphere.js";
import { EventDispatcherImpl } from "../../src/core/events/EventDispatcherImpl.js";

/**
 * Integrated-system invariants. The direct solver tests prove single impulses in isolation; these
 * drive the *whole* `PhysicsSystem.step()` pipeline (integration + broadphase + contact solver)
 * over many frames and assert conservation laws the engine must not violate:
 *   - total linear momentum of an isolated elastic collision,
 *   - kinetic energy across the collision (restitution = 1 => elastic),
 *   - that the collision actually happened (velocities swapped).
 */
describe("PhysicsSystem multi-frame invariants", () => {
  function setupPair(): { system: PhysicsSystem; scene: Scene; a: Object3D; b: Object3D } {
    const events = new EventDispatcherImpl();
    const system = new PhysicsSystem(events);
    system.gravity.set(0, 0, 0);
    system.maxDeltaTime = 1000.0;
    const scene = new Scene();

    const a = new Object3D();
    a.position.set(-2, 0, 0);
    a.rigidBody = new RigidBody(1.0);
    a.rigidBody!.restitution = 1.0;
    a.rigidBody!.friction = 1.0;
    a.bounds = new BoundingSphere(a.position, 1.0);
    a.rigidBody!.velocity.set(1, 0, 0);

    const b = new Object3D();
    b.position.set(2, 0, 0);
    b.rigidBody = new RigidBody(1.0);
    b.rigidBody!.restitution = 1.0;
    b.rigidBody!.friction = 1.0;
    b.bounds = new BoundingSphere(b.position, 1.0);
    b.rigidBody!.velocity.set(-1, 0, 0);

    scene.add(a, b);
    return { system, scene, a, b };
  }

  it("conserves total linear momentum across a head-on elastic collision", () => {
    const { system, scene, a, b } = setupPair();
    const momentumX = (): number => a.rigidBody!.velocity.x + b.rigidBody!.velocity.x;

    // Both bodies are committed to the contact solver by frame symmetry: equal mass, head-on,
    // restitution 1. The total momentum must stay ~0 (it starts at 0 and gravity/damping are off)
    // before, during and after the collision -- a solver that leaks or invents momentum would drift.
    let progressed = false;
    for (let frame = 0; frame < 240; frame++) {
      system.step(scene, 1 / 60);
      // Once the velocities have swapped, the collision demonstrably happened.
      if (a.rigidBody!.velocity.x < 0 && b.rigidBody!.velocity.x > 0) progressed = true;
      expect(Math.abs(momentumX()), `momentum not conserved at frame ${frame}`).toBeLessThan(1e-6);
    }
    expect(progressed, "the bodies never collided and bounced").toBe(true);
  });

  it("conserves kinetic energy through the elastic collision (restitution 1)", () => {
    const { system, scene, a, b } = setupPair();
    const kineticEnergy = (): number => a.rigidBody!.velocity.x ** 2 + b.rigidBody!.velocity.x ** 2;

    // Elastic collision of equal masses: speeds swap, total kinetic energy (mass 1 each, 1D) is 2.
    let bounced = false;
    for (let frame = 0; frame < 240; frame++) {
      system.step(scene, 1 / 60);
      if (a.rigidBody!.velocity.x < 0 && b.rigidBody!.velocity.x > 0) bounced = true;
      // Allow solver-iteration slop, but a materially non-elastic result (energy gain or a third
      // lost) must fail. 1e-2 is deliberately loose at the frame level -- the invariant is the
      // absence of gross drift, not per-iteration convergence.
      expect(Math.abs(kineticEnergy() - 2)).toBeLessThan(1e-2);
    }
    expect(bounced).toBe(true);
  });
});
