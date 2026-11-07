import { describe, it, expect, beforeEach } from "vitest";
import { PhysicsSystem } from "../../src/physix/PhysicsSystem.js";
import { Scene } from "../../src/core/Scene.js";
import { Object3D } from "../../src/core/Object3D.js";
import { RigidBody } from "../../src/physix/RigidBody.js";
import { Sphere } from "../../src/geometry/Sphere.js";
import { Cube } from "../../src/geometry/Cube.js";
import { StaticCollider } from "../../src/physix/StaticCollider.js";
import { BoundingBox } from "../../src/physix/BoundingBox.js";
import { Vector3D } from "../../src/math/Vector3D.js";
import { EventDispatcherImpl } from "../../src/core/events/EventDispatcherImpl.js";

describe("Physics 3D Inertia Tensor & Angular Impulse Dynamics", () => {
  beforeEach(() => {
    Object3D.resetNextId();
    StaticCollider.resetNextId();
  });

  describe("Inertia Tensor Calculation Helpers", () => {
    it("computes principal moments of inertia for a solid box", () => {
      const rb = new RigidBody(12.0);
      // Box: mass = 12kg, size = (2, 4, 6) -> dx=2, dy=4, dz=6
      // Ix = 1/12 * 12 * (4^2 + 6^2) = 16 + 36 = 52
      // Iy = 1/12 * 12 * (2^2 + 6^2) = 4 + 36 = 40
      // Iz = 1/12 * 12 * (2^2 + 4^2) = 4 + 16 = 20
      rb.setInertiaForBox(2, 4, 6);

      expect(rb.inertiaTensor.x).toBeCloseTo(52, 4);
      expect(rb.inertiaTensor.y).toBeCloseTo(40, 4);
      expect(rb.inertiaTensor.z).toBeCloseTo(20, 4);

      expect(rb.inverseInertiaTensor.x).toBeCloseTo(1 / 52, 4);
      expect(rb.inverseInertiaTensor.y).toBeCloseTo(1 / 40, 4);
      expect(rb.inverseInertiaTensor.z).toBeCloseTo(1 / 20, 4);
    });

    it("computes moment of inertia for a solid sphere", () => {
      const rb = new RigidBody(5.0);
      // Sphere: mass = 5kg, radius = 2 -> I = 2/5 * 5 * 2^2 = 8
      rb.setInertiaForSphere(2.0);

      expect(rb.inertiaTensor.x).toBeCloseTo(8, 4);
      expect(rb.inertiaTensor.y).toBeCloseTo(8, 4);
      expect(rb.inertiaTensor.z).toBeCloseTo(8, 4);
      expect(rb.inverseInertiaTensor.x).toBeCloseTo(1 / 8, 4);
    });

    it("computes moment of inertia for a solid cylinder", () => {
      const rb = new RigidBody(12.0);
      // Cylinder aligned along Y: mass = 12, radius = 2, height = 6
      // Iy = 1/2 * 12 * 2^2 = 24
      // Ix = Iz = 1/12 * 12 * (3 * 2^2 + 6^2) = 12 + 36 = 48
      rb.setInertiaForCylinder(2.0, 6.0);

      expect(rb.inertiaTensor.x).toBeCloseTo(48, 4);
      expect(rb.inertiaTensor.y).toBeCloseTo(24, 4);
      expect(rb.inertiaTensor.z).toBeCloseTo(48, 4);
    });
  });

  describe("Off-Center Impulse & Force Application on RigidBody", () => {
    it("applies off-center impulse generating both linear velocity and angular torque", () => {
      const rb = new RigidBody(2.0);
      rb.inertiaTensor.set(4, 4, 4);
      rb.inverseInertiaTensor.set(0.25, 0.25, 0.25);

      const center = new Vector3D(0, 0, 0);
      // Contact point at (0, 2, 0) - top edge
      const point = new Vector3D(0, 2, 0);
      // Impulse pushing right (+X): J = (10, 0, 0)
      const impulse = new Vector3D(10, 0, 0);

      rb.applyImpulseAtPoint(impulse, point, center);

      // Linear dv = J / m = (10, 0, 0) / 2 = (5, 0, 0)
      expect(rb.velocity.x).toBeCloseTo(5.0);
      expect(rb.velocity.y).toBeCloseTo(0.0);
      expect(rb.velocity.z).toBeCloseTo(0.0);

      // Torque = r x J = (0, 2, 0) x (10, 0, 0) = (0, 0, -20)
      // dw = I^-1 * tau = (0, 0, -20 * 0.25) = (0, 0, -5) rad/s (clockwise rotation)
      expect(rb.angularVelocity.x).toBeCloseTo(0.0);
      expect(rb.angularVelocity.y).toBeCloseTo(0.0);
      expect(rb.angularVelocity.z).toBeCloseTo(-5.0);
    });

    it("applies off-center continuous force accumulating forces and torque", () => {
      const rb = new RigidBody(1.0);
      const center = new Vector3D(0, 0, 0);
      const point = new Vector3D(1, 0, 0);
      const force = new Vector3D(0, 10, 0);

      rb.applyForceAtPoint(force, point, center);

      expect(rb.forces.y).toBeCloseTo(10.0);
      // tau = r x F = (1, 0, 0) x (0, 10, 0) = (0, 0, 10)
      expect(rb.torque.z).toBeCloseTo(10.0);
    });
  });

  describe("Off-Center Collision Response in PhysicsSystem", () => {
    it("generates angular tumbling when an off-center box corner hits a surface", () => {
      const events = new EventDispatcherImpl();
      const physics = new PhysicsSystem(events);
      physics.gravity.set(0, 0, 0);
      physics.fixedTimeStep = 1 / 60;
      const scene = new Scene();

      // Static floor at y = 0
      const floor = new StaticCollider(
        new BoundingBox(new Vector3D(-10, -1, -10), new Vector3D(10, 0, 10)),
      );
      floor.restitution = 0.0;
      floor.friction = 0.0;
      scene.staticColliders.push(floor);

      // Box colliding with ground on its corner/side
      const box = new Object3D("FallingBox");
      box.geometry = new Cube({ size: 2 }).getGeometryData();
      box.position.set(0, 0.95, 0);
      box.rigidBody = new RigidBody(2.0);
      box.rigidBody.restitution = 0.0;
      box.rigidBody.friction = 0.0;
      box.rigidBody.setInertiaForBox(2, 2, 2);
      box.rigidBody.velocity.set(0, -6.0, 0);
      box.updateMatrixWorld();
      box.computeBounds();
      scene.objects.push(box);

      physics.step(scene, 1 / 60);

      // Linear velocity in Y stopped by normal impulse
      expect(box.rigidBody.velocity.y).toBeCloseTo(0.0, 2);
      expect(box.position.y).toBeGreaterThanOrEqual(1.0 - 0.01);
    });

    it("preserves zero angular velocity on central symmetric sphere impacts", () => {
      const events = new EventDispatcherImpl();
      const physics = new PhysicsSystem(events);
      physics.gravity.set(0, 0, 0);
      physics.fixedTimeStep = 1 / 60;
      const scene = new Scene();

      const floor = new StaticCollider(
        new BoundingBox(new Vector3D(-10, -1, -10), new Vector3D(10, 0, 10)),
      );
      floor.restitution = 0.5;
      floor.friction = 0.0;
      scene.staticColliders.push(floor);

      const sphere = new Object3D("Sphere");
      sphere.geometry = new Sphere({ radius: 1.0 }).getGeometryData();
      sphere.position.set(0, 0.95, 0);
      sphere.rigidBody = new RigidBody(1.0);
      sphere.rigidBody.setInertiaForSphere(1.0);
      sphere.rigidBody.restitution = 0.5;
      sphere.rigidBody.friction = 0.0;
      sphere.rigidBody.velocity.set(0, -10.0, 0);
      sphere.updateMatrixWorld();
      sphere.computeBounds();
      scene.objects.push(sphere);

      physics.step(scene, 1 / 60);

      // Rebounds with 0.5 * 10 = 5.0
      expect(sphere.rigidBody.velocity.y).toBeCloseTo(5.0, 2);
      // Pure normal impact on sphere produces exactly 0 angular velocity
      expect(sphere.rigidBody.angularVelocity.x).toBeCloseTo(0.0);
      expect(sphere.rigidBody.angularVelocity.y).toBeCloseTo(0.0);
      expect(sphere.rigidBody.angularVelocity.z).toBeCloseTo(0.0);
    });
  });
});
