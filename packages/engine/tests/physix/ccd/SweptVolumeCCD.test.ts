import { describe, it, expect } from "vitest";
import { Object3D } from "../../../src/core/Object3D.js";
import { SweptVolumeCCD } from "../../../src/physix/ccd/SweptSphereCCD.js";
import { PhysicsBroadphase } from "../../../src/physix/broadphase/PhysicsBroadphase.js";
import { BoundingSphere } from "../../../src/physix/BoundingSphere.js";
import { BoundingBox } from "../../../src/physix/BoundingBox.js";
import { OBB } from "../../../src/physix/OBB.js";
import { Collision } from "../../../src/physix/Collision.js";
import { Vector3D } from "../../../src/math/index.js";
import { PhysicsSystem } from "../../../src/physix/PhysicsSystem.js";
import { EventDispatcherImpl } from "../../../src/core/events/EventDispatcherImpl.js";
import { Scene } from "../../../src/core/Scene.js";
import { RigidBody } from "../../../src/physix/RigidBody.js";
import { StaticCollider } from "../../../src/physix/StaticCollider.js";

describe("SweptVolumeCCD & Continuous Collision Detection Expansion", () => {
  describe("Collision.sweep* analytical geometric tests", () => {
    it("sweeps moving Box vs static Box (AABB vs AABB)", () => {
      const origin = new Vector3D(0, 0, 0);
      const delta = new Vector3D(10, 0, 0);
      const halfExtents = new Vector3D(0.5, 0.5, 0.5);

      // Static wall box at x=5 (from 4.9 to 5.1)
      const targetBox = new BoundingBox(new Vector3D(4.9, -5, -5), new Vector3D(5.1, 5, 5));

      const toi = Collision.sweepBoxBox(origin, delta, halfExtents, targetBox);
      expect(toi).toBeGreaterThanOrEqual(0);
      expect(toi).toBeLessThanOrEqual(1);

      // Contact occurs when box front (origin.x + delta.x * t + 0.5) hits wall min.x (4.9)
      // 10 * t + 0.5 = 4.9 => 10 * t = 4.4 => t = 0.44
      expect(toi).toBeCloseTo(0.44, 2);
    });

    it("sweeps moving Box vs static Sphere", () => {
      const origin = new Vector3D(0, 0, 0);
      const delta = new Vector3D(10, 0, 0);
      const halfExtents = new Vector3D(0.5, 0.5, 0.5);

      // Static sphere at (5, 0, 0) with radius 1.0
      const targetSphere = new BoundingSphere(new Vector3D(5, 0, 0), 1.0);

      const toi = Collision.sweepBoxSphere(origin, delta, halfExtents, targetSphere);
      expect(toi).toBeGreaterThanOrEqual(0);
      expect(toi).toBeLessThanOrEqual(1);

      // Sphere-box contact along X hits around 5 - (1.0 + 0.5) = 3.5 => t = 0.35
      expect(toi).toBeCloseTo(0.35, 2);
    });

    it("sweeps moving Box vs static OBB", () => {
      const origin = new Vector3D(0, 0, 0);
      const delta = new Vector3D(10, 0, 0);
      const halfExtents = new Vector3D(0.5, 0.5, 0.5);

      const targetObb = new OBB(new Vector3D(5, 0, 0), new Vector3D(0.5, 2, 2));

      const toi = Collision.sweepBoxObb(origin, delta, halfExtents, targetObb);
      expect(toi).toBeGreaterThanOrEqual(0);
      expect(toi).toBeLessThanOrEqual(1);
      // Contact when 10 * t + 0.5 = 4.5 => t = 0.40
      expect(toi).toBeCloseTo(0.4, 2);
    });

    it("sweeps moving OBB vs static Box", () => {
      const movingObb = new OBB(new Vector3D(0, 0, 0), new Vector3D(0.5, 0.5, 0.5));
      const delta = new Vector3D(10, 0, 0);
      const targetBox = new BoundingBox(new Vector3D(4.5, -5, -5), new Vector3D(5.5, 5, 5));

      const toi = Collision.sweepObbBox(movingObb.center, delta, movingObb, targetBox);
      expect(toi).toBeGreaterThanOrEqual(0);
      expect(toi).toBeLessThanOrEqual(1);
      expect(toi).toBeCloseTo(0.4, 2);
    });

    it("sweeps moving OBB vs static OBB", () => {
      const movingObb = new OBB(new Vector3D(0, 0, 0), new Vector3D(0.5, 0.5, 0.5));
      const delta = new Vector3D(10, 0, 0);
      const targetObb = new OBB(new Vector3D(5, 0, 0), new Vector3D(0.5, 2, 2));

      const toi = Collision.sweepObbObb(movingObb.center, delta, movingObb, targetObb);
      expect(toi).toBeGreaterThanOrEqual(0);
      expect(toi).toBeLessThanOrEqual(1);
      expect(toi).toBeCloseTo(0.4, 2);
    });

    it("sweeps fast ray against static volumes", () => {
      const origin = new Vector3D(0, 0, 0);
      const delta = new Vector3D(10, 0, 0);

      const targetBox = new BoundingBox(new Vector3D(4, -1, -1), new Vector3D(6, 1, 1));
      const toiBox = Collision.sweepRayVolume(origin, delta, targetBox);
      expect(toiBox).toBeCloseTo(0.4, 2);

      const targetSphere = new BoundingSphere(new Vector3D(5, 0, 0), 1.0);
      const toiSphere = Collision.sweepRayVolume(origin, delta, targetSphere);
      expect(toiSphere).toBeCloseTo(0.4, 2);
    });

    it("returns -1 for non-intersecting / missing sweeps", () => {
      const origin = new Vector3D(0, 0, 0);
      const delta = new Vector3D(10, 0, 0);
      const halfExtents = new Vector3D(0.5, 0.5, 0.5);

      // Wall far away on Y axis (miss)
      const targetBox = new BoundingBox(new Vector3D(4.9, 10, -5), new Vector3D(5.1, 20, 5));
      const toi = Collision.sweepBoxBox(origin, delta, halfExtents, targetBox);
      expect(toi).toBe(-1);
    });

    it("returns -1 when mover or ray starts inside target volume instead of returning exit TOI", () => {
      const origin = new Vector3D(0, 0, 0);
      const delta = new Vector3D(10, 0, 0);
      const halfExtents = new Vector3D(0.5, 0.5, 0.5);

      // Target volume surrounding origin [-2, 2]
      const targetBox = new BoundingBox(new Vector3D(-2, -2, -2), new Vector3D(2, 2, 2));
      const targetSphere = new BoundingSphere(new Vector3D(0, 0, 0), 2.0);
      const targetObb = new OBB(new Vector3D(0, 0, 0), new Vector3D(2, 2, 2));
      const movingObb = new OBB(new Vector3D(0, 0, 0), new Vector3D(0.5, 0.5, 0.5));

      // Sphere vs Box
      expect(Collision.sweepSphereBox(origin, delta, 1.0, targetBox)).toBe(-1);
      // Sphere vs OBB
      expect(Collision.sweepSphereObb(origin, delta, 1.0, targetObb)).toBe(-1);
      // Box vs Box
      expect(Collision.sweepBoxBox(origin, delta, halfExtents, targetBox)).toBe(-1);
      // Box vs Sphere
      expect(Collision.sweepBoxSphere(origin, delta, halfExtents, targetSphere)).toBe(-1);
      // Box vs OBB
      expect(Collision.sweepBoxObb(origin, delta, halfExtents, targetObb)).toBe(-1);
      // OBB vs Box
      expect(Collision.sweepObbBox(origin, delta, movingObb, targetBox)).toBe(-1);
      // OBB vs Sphere
      expect(Collision.sweepObbSphere(origin, delta, movingObb, targetSphere)).toBe(-1);
      // OBB vs OBB
      expect(Collision.sweepObbObb(origin, delta, movingObb, targetObb)).toBe(-1);
      // Ray vs Box / Sphere / OBB
      expect(Collision.sweepRayVolume(origin, delta, targetBox)).toBe(-1);
      expect(Collision.sweepRayVolume(origin, delta, targetSphere)).toBe(-1);
      expect(Collision.sweepRayVolume(origin, delta, targetObb)).toBe(-1);
    });
  });

  describe("SweptVolumeCCD resolver in physics step", () => {
    it("registers and clamps fast-moving Box tunneling through thin wall", () => {
      const ccd = new SweptVolumeCCD();
      const boxObj = new Object3D("FastBox");
      boxObj.position.set(0, 0, 0);
      boxObj.bounds = new BoundingBox(new Vector3D(-0.5, -0.5, -0.5), new Vector3D(0.5, 0.5, 0.5));

      const wall = new Object3D("ThinWall");
      wall.bounds = new BoundingBox(new Vector3D(4.9, -5, -5), new Vector3D(5.1, 5, 5));

      const broadphase = new PhysicsBroadphase();
      broadphase.update([wall]);

      // Fast bullet velocity = 20m/s -> displacement = 10m through thin wall at x=5
      const largeDelta = new Vector3D(10, 0, 0);
      ccd.checkCandidate(boxObj, largeDelta, 1.0);
      expect(ccd.hasCandidates).toBe(true);

      ccd.resolve(broadphase);

      // Box must not have tunneled past x=5
      expect(boxObj.position.x).toBeLessThan(5.0);
      expect(boxObj.position.x).toBeGreaterThan(4.0);
    });

    it("prevents box tunneling in full PhysicsSystem simulation step", () => {
      const events = new EventDispatcherImpl();
      const physics = new PhysicsSystem(events);
      physics.gravity.set(0, 0, 0);
      physics.ccdMotionThreshold = 1.0;
      const scene = new Scene();

      // Thin static wall at x = 5 (width 0.2)
      const wall = new StaticCollider(
        new BoundingBox(new Vector3D(4.9, -5, -5), new Vector3D(5.1, 5, 5)),
      );
      scene.staticColliders.push(wall);

      // Fast-moving box projectile at x = 0 with high velocity vx = 300 m/s (5m per 1/60 substep)
      const bullet = new Object3D("BulletBox");
      bullet.position.set(0, 0, 0);
      bullet.bounds = new BoundingBox(new Vector3D(-0.2, -0.2, -0.2), new Vector3D(0.2, 0.2, 0.2));
      bullet.rigidBody = new RigidBody(1.0);
      bullet.rigidBody.velocity.set(300, 0, 0);
      bullet.updateMatrixWorld();
      scene.objects.push(bullet);

      physics.step(scene, 1 / 60);

      // Bullet should be clamped at wall surface instead of tunneling to x=5+
      expect(bullet.position.x).toBeLessThan(5.0);
      expect(bullet.position.x).toBeGreaterThan(4.0);
    });
  });
});
