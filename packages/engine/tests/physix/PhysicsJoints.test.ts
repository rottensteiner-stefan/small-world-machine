import { describe, it, expect, beforeEach } from "vitest";
import { PhysicsSystem } from "../../src/physix/PhysicsSystem.js";
import { Scene } from "../../src/core/Scene.js";
import { Object3D } from "../../src/core/Object3D.js";
import { RigidBody } from "../../src/physix/RigidBody.js";
import { Sphere } from "../../src/geometry/Sphere.js";
import { Cube } from "../../src/geometry/Cube.js";
import { Vector3D } from "../../src/math/Vector3D.js";
import { EventDispatcherImpl } from "../../src/core/events/EventDispatcherImpl.js";
import {
  DistanceJoint,
  SpringJoint,
  BallSocketJoint,
  HingeJoint,
} from "../../src/physix/joints/index.js";

describe("Physics Constraints & Joint System", () => {
  beforeEach(() => {
    Object3D.resetNextId();
  });

  describe("DistanceJoint", () => {
    it("maintains fixed distance between a dynamic body and a static anchor (pendulum)", () => {
      const events = new EventDispatcherImpl();
      const physics = new PhysicsSystem(events);
      physics.gravity.set(0, -10, 0);
      physics.fixedTimeStep = 1 / 60;
      const scene = new Scene();

      // Bob starting horizontally at (3, 0, 0), anchor at (0, 0, 0)
      const bob = new Object3D("Bob");
      bob.geometry = new Sphere({ radius: 0.5 }).getGeometryData();
      bob.position.set(3, 0, 0);
      bob.rigidBody = new RigidBody(1.0);
      bob.rigidBody.restitution = 0.0;
      bob.updateMatrixWorld();
      bob.computeBounds();
      scene.objects.push(bob);

      // Distance joint with length 3.0 to world anchor (0, 0, 0)
      const joint = new DistanceJoint({
        bodyA: bob,
        anchorA: new Vector3D(0, 0, 0),
        anchorB: new Vector3D(0, 0, 0),
        distance: 3.0,
      });
      scene.joints.push(joint);

      // Simulate pendulum swinging down under gravity for 30 steps
      for (let i = 0; i < 30; i++) {
        physics.step(scene, 1 / 60);
      }

      // Distance to anchor (0,0,0) must remain strictly constrained to 3.0
      const currentDist = bob.position.length();
      expect(currentDist).toBeCloseTo(3.0, 2);

      // Bob should have swung downwards (+X decreases, -Y decreases)
      expect(bob.position.y).toBeLessThan(0);
      expect(bob.position.x).toBeLessThan(3.0);
    });

    it("maintains fixed distance between two dynamic bodies", () => {
      const events = new EventDispatcherImpl();
      const physics = new PhysicsSystem(events);
      physics.gravity.set(0, 0, 0);
      physics.fixedTimeStep = 1 / 60;
      const scene = new Scene();

      const b1 = new Object3D("B1");
      b1.position.set(-2, 0, 0);
      b1.rigidBody = new RigidBody(1.0);
      b1.updateMatrixWorld();
      b1.computeBounds();

      const b2 = new Object3D("B2");
      b2.position.set(2, 0, 0);
      b2.rigidBody = new RigidBody(1.0);
      b2.updateMatrixWorld();
      b2.computeBounds();

      scene.objects.push(b1, b2);

      const joint = new DistanceJoint({
        bodyA: b1,
        bodyB: b2,
        distance: 4.0,
      });
      scene.joints.push(joint);

      // Pull B1 to the left with velocity (-10, 0, 0)
      b1.rigidBody.velocity.set(-10, 0, 0);

      // Step physics
      physics.step(scene, 1 / 60);

      // Distance between B1 and B2 must remain 4.0
      const dist = b1.position.distanceTo(b2.position);
      expect(dist).toBeCloseTo(4.0, 2);

      // B2 should have been pulled left by the constraint
      expect(b2.rigidBody.velocity.x).toBeLessThan(0);
    });

    it("breaks and disables when tensile impulse exceeds breakForce", () => {
      const events = new EventDispatcherImpl();
      const physics = new PhysicsSystem(events);
      physics.gravity.set(0, 0, 0);
      physics.fixedTimeStep = 1 / 60;
      const scene = new Scene();

      const b1 = new Object3D("B1");
      b1.position.set(0, 0, 0);
      b1.rigidBody = new RigidBody(1.0);
      b1.rigidBody.velocity.set(100, 0, 0); // huge pulling velocity
      b1.updateMatrixWorld();
      b1.computeBounds();
      scene.objects.push(b1);

      const joint = new DistanceJoint({
        bodyA: b1,
        anchorB: new Vector3D(0, 0, 0),
        distance: 1.0,
        breakForce: 10.0, // Low breaking threshold
      });
      scene.joints.push(joint);

      physics.step(scene, 1 / 60);

      expect(joint.isBroken).toBe(true);
      expect(joint.enabled).toBe(false);
    });
  });

  describe("SpringJoint", () => {
    it("exerts Hookean elastic forces and dampens oscillation towards rest length", () => {
      const events = new EventDispatcherImpl();
      const physics = new PhysicsSystem(events);
      physics.gravity.set(0, 0, 0);
      physics.fixedTimeStep = 1 / 60;
      const scene = new Scene();

      // Body attached to a spring anchored at (0, 0, 0) with rest length 2.0
      // Placed stretched at (5, 0, 0)
      const bob = new Object3D("SpringBob");
      bob.position.set(5, 0, 0);
      bob.rigidBody = new RigidBody(1.0);
      bob.rigidBody.linearDamping = 0.99;
      bob.updateMatrixWorld();
      bob.computeBounds();
      scene.objects.push(bob);

      const spring = new SpringJoint({
        bodyA: bob,
        anchorB: new Vector3D(0, 0, 0),
        restLength: 2.0,
        stiffness: 100.0,
        damping: 5.0,
      });
      scene.joints.push(spring);

      // Run simulation for 2 seconds (120 steps)
      for (let i = 0; i < 120; i++) {
        physics.step(scene, 1 / 60);
      }

      // Spring should have pulled the bob towards rest length (2.0)
      expect(bob.position.x).toBeCloseTo(2.0, 1);
      expect(Math.abs(bob.rigidBody.velocity.x)).toBeLessThan(1.0);
    });
  });

  describe("BallSocketJoint", () => {
    it("locks 3D positional anchor points while permitting free rotation", () => {
      const events = new EventDispatcherImpl();
      const physics = new PhysicsSystem(events);
      physics.gravity.set(0, -9.81, 0);
      physics.fixedTimeStep = 1 / 60;
      const scene = new Scene();

      const arm = new Object3D("Arm");
      arm.geometry = new Cube({ size: 1 }).getGeometryData();
      arm.position.set(2, 0, 0);
      arm.rigidBody = new RigidBody(1.0);
      arm.updateMatrixWorld();
      arm.computeBounds();
      scene.objects.push(arm);

      // Ball socket anchoring arm at local offset (-1, 0, 0) to world (1, 0, 0)
      const socket = new BallSocketJoint({
        bodyA: arm,
        anchorA: new Vector3D(-1, 0, 0),
        anchorB: new Vector3D(1, 0, 0),
      });
      scene.joints.push(socket);

      // Simulate
      for (let i = 0; i < 20; i++) {
        physics.step(scene, 1 / 60);
      }

      const pA = new Vector3D();
      socket.getWorldAnchorA(pA);

      // Anchor point must remain exactly at (1, 0, 0) in world space
      expect(pA.x).toBeCloseTo(1.0, 2);
      expect(pA.y).toBeCloseTo(0.0, 2);
      expect(pA.z).toBeCloseTo(0.0, 2);
    });
  });

  describe("HingeJoint", () => {
    it("drives angular rotation around hinge axis using its motor", () => {
      const events = new EventDispatcherImpl();
      const physics = new PhysicsSystem(events);
      physics.gravity.set(0, 0, 0);
      physics.fixedTimeStep = 1 / 60;
      const scene = new Scene();

      const wheel = new Object3D("Wheel");
      wheel.geometry = new Cube({ size: 1 }).getGeometryData();
      wheel.position.set(0, 0, 0);
      wheel.rigidBody = new RigidBody(1.0);
      wheel.rigidBody.setInertiaForBox(1, 1, 1);
      wheel.updateMatrixWorld();
      wheel.computeBounds();
      scene.objects.push(wheel);

      const hinge = new HingeJoint({
        bodyA: wheel,
        axisA: new Vector3D(0, 1, 0), // Rotate around Y
        enableMotor: true,
        motorSpeed: 5.0, // 5 rad/s
        maxMotorTorque: 50.0,
      });
      scene.joints.push(hinge);

      for (let i = 0; i < 30; i++) {
        physics.step(scene, 1 / 60);
      }

      // Angular velocity along Y axis should match motor speed (5.0 rad/s)
      expect(wheel.rigidBody.angularVelocity.y).toBeCloseTo(5.0, 1);
      expect(wheel.rigidBody.angularVelocity.x).toBeCloseTo(0.0);
      expect(wheel.rigidBody.angularVelocity.z).toBeCloseTo(0.0);
    });

    it("bounds the relative hinge angle with limits (regression: limits were inert)", () => {
      const events = new EventDispatcherImpl();
      const physics = new PhysicsSystem(events);
      physics.gravity.set(0, 0, 0);
      physics.fixedTimeStep = 1 / 60;
      const scene = new Scene();

      const a = new Object3D("A");
      a.geometry = new Cube({ size: 1 }).getGeometryData();
      a.rigidBody = new RigidBody(1.0);
      a.updateMatrixWorld();
      a.computeBounds();
      scene.objects.push(a);

      const b = new Object3D("B");
      b.geometry = new Cube({ size: 1 }).getGeometryData();
      b.rigidBody = new RigidBody(1.0);
      b.updateMatrixWorld();
      b.computeBounds();
      scene.objects.push(b);

      const hinge = new HingeJoint({
        bodyA: a,
        bodyB: b,
        axisA: new Vector3D(0, 1, 0),
        axisB: new Vector3D(0, 1, 0),
        enableLimit: true,
        minAngle: -0.3,
        maxAngle: 0.3,
      });
      physics.addJoint(hinge);

      // Drive a strong relative counter-rotation to slam into the limits.
      a.rigidBody!.angularVelocity.set(0, -8, 0);
      b.rigidBody!.angularVelocity.set(0, 8, 0);

      let maxAbs = 0;
      for (let i = 0; i < 60; i++) {
        physics.step(scene, 1 / 60);
        maxAbs = Math.max(maxAbs, Math.abs(hinge.getRelativeAngle()));
      }

      // With inert limits the pair spun apart to ~6 rad; the limit must keep it bounded.
      // A small overshoot (~1 frame of relative rotation at the initial speed) is tolerated.
      expect(maxAbs).toBeLessThan(1.0);
    });
  });

  describe("Joint System Registration & CollideConnected Filtering", () => {
    it("suppresses collision between joined bodies when collideConnected is false", () => {
      const events = new EventDispatcherImpl();
      const physics = new PhysicsSystem(events);
      physics.gravity.set(0, 0, 0);
      physics.fixedTimeStep = 1 / 60;
      const scene = new Scene();

      let collisionDispatched = false;
      events.addEventListener("physics:collision", () => {
        collisionDispatched = true;
      });

      const o1 = new Object3D("O1");
      o1.geometry = new Sphere({ radius: 1 }).getGeometryData();
      o1.position.set(0, 0, 0);
      o1.rigidBody = new RigidBody(1.0);
      o1.updateMatrixWorld();
      o1.computeBounds();

      const o2 = new Object3D("O2");
      o2.geometry = new Sphere({ radius: 1 }).getGeometryData();
      o2.position.set(0.5, 0, 0); // Overlapping
      o2.rigidBody = new RigidBody(1.0);
      o2.updateMatrixWorld();
      o2.computeBounds();

      scene.objects.push(o1, o2);

      const joint = new DistanceJoint({
        bodyA: o1,
        bodyB: o2,
        collideConnected: false,
      });
      physics.addJoint(joint);

      physics.step(scene, 1 / 60);

      expect(collisionDispatched).toBe(false);
    });
  });
});
