import { ConvexHull } from "../../../src/physix/ConvexHull.js";
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

    // Replaces the old "starts inside -> always -1" pin, which let a body with residual
    // penetration tunnel through a thin target. A mover that starts overlapping is now only left
    // to the discrete resolver (-1) when it moves away; if its displacement drives it deeper than
    // the current penetration it gets TOI 0. Point projectiles (rays) that start inside have no
    // entry time and stay -1.
    const halfExtents = new Vector3D(0.5, 0.5, 0.5);
    const targetBox = new BoundingBox(new Vector3D(-2, -2, -2), new Vector3D(2, 2, 2));
    const targetSphere = new BoundingSphere(new Vector3D(0, 0, 0), 2.0);
    const targetObb = new OBB(new Vector3D(0, 0, 0), new Vector3D(2, 2, 2));
    const movingObb = new OBB(new Vector3D(0, 0, 0), new Vector3D(0.5, 0.5, 0.5));
    // Off-centre start inside every target, nearest exit face is +X.
    const origin = new Vector3D(0.5, 0, 0);

    const allKernels = (delta: Vector3D): number[] => [
      Collision.sweepSphereSphere(origin, delta, 1.0, targetSphere),
      Collision.sweepSphereBox(origin, delta, 1.0, targetBox),
      Collision.sweepSphereObb(origin, delta, 1.0, targetObb),
      Collision.sweepBoxBox(origin, delta, halfExtents, targetBox),
      Collision.sweepBoxSphere(origin, delta, halfExtents, targetSphere),
      Collision.sweepBoxObb(origin, delta, halfExtents, targetObb),
      Collision.sweepObbBox(origin, delta, movingObb, targetBox),
      Collision.sweepObbSphere(origin, delta, movingObb, targetSphere),
      Collision.sweepObbObb(origin, delta, movingObb, targetObb),
    ];

    it("returns -1 when a mover that starts overlapping the target moves away (nothing new to catch)", () => {
      for (const toi of allKernels(new Vector3D(10, 0, 0))) expect(toi).toBe(-1);
    });

    it("returns TOI 0 when a mover that starts overlapping is driven deeper through the target", () => {
      for (const toi of allKernels(new Vector3D(-10, 0, 0))) expect(toi).toBe(0);
    });

    it("does not freeze a resting/sliding mover whose inward drift stays within the tolerance", () => {
      // 0.002 of inward travel towards the centre while 5 m slide along Z.
      const slide = new Vector3D(-0.002, 0, 5);
      for (const toi of allKernels(slide)) expect(toi).toBe(-1);
    });

    it("catches a mover with partial penetration driven into a thin wall (no tunnelling)", () => {
      const wall = new BoundingBox(new Vector3D(-0.05, -5, -5), new Vector3D(0.05, 5, 5));
      // Sphere r=0.5 overlaps the wall by 0.1 (centre at x=-0.45) and flies 4 m through it.
      const toi = Collision.sweepSphereBox(
        new Vector3D(-0.45, 0, 0),
        new Vector3D(4, 0, 0),
        0.5,
        wall,
      );
      expect(toi).toBe(0);
      // Partial penetration of a box mover as well.
      const toiBox = Collision.sweepBoxBox(
        new Vector3D(-0.45, 0, 0),
        new Vector3D(4, 0, 0),
        new Vector3D(0.5, 0.5, 0.5),
        wall,
      );
      expect(toiBox).toBe(0);
    });

    it("sweeps nothing for rays that start inside a volume", () => {
      const delta = new Vector3D(10, 0, 0);
      expect(Collision.sweepRayVolume(origin, delta, targetBox)).toBe(-1);
      expect(Collision.sweepRayVolume(origin, delta, targetSphere)).toBe(-1);
      expect(Collision.sweepRayVolume(origin, delta, targetObb)).toBe(-1);
    });

    it("does not report a corner-region start of the inflated box as an overlap", () => {
      // Sphere r=1 at (1.8,1.8,0) sits inside the box [-1,1]^3 inflated by 1, but its distance to
      // the box edge is sqrt(2*0.8^2) = 1.13 > 1: it does not touch, so nothing to catch.
      const box = new BoundingBox(new Vector3D(-1, -1, -1), new Vector3D(1, 1, 1));
      const toi = Collision.sweepSphereBox(
        new Vector3D(1.8, 1.8, 0),
        new Vector3D(-0.01, -0.01, 0),
        1.0,
        box,
      );
      expect(toi).toBe(-1);
    });

    it("sweeps convex hulls conservatively instead of silently returning -1", () => {
      const verts = [
        new Vector3D(-1, -1, -1),
        new Vector3D(1, -1, -1),
        new Vector3D(1, 1, -1),
        new Vector3D(-1, 1, -1),
        new Vector3D(-1, -1, 1),
        new Vector3D(1, -1, 1),
        new Vector3D(1, 1, 1),
        new Vector3D(-1, 1, 1),
      ];
      const faces = [
        [0, 3, 2, 1],
        [4, 5, 6, 7],
        [0, 1, 5, 4],
        [3, 7, 6, 2],
        [0, 4, 7, 3],
        [1, 2, 6, 5],
      ];
      const hull = new ConvexHull(verts, faces);
      const wall = new BoundingBox(new Vector3D(10, -5, -5), new Vector3D(11, 5, 5));
      // Hull flying +X by 20 m must hit the wall at some TOI in (0, 1).
      const toi = Collision.sweep(hull, new Vector3D(20, 0, 0), wall);
      expect(toi).toBeGreaterThan(0);
      expect(toi).toBeLessThan(1);
      // The conservative TOI is never later than the exact contact (hull front face at x=1).
      expect(toi).toBeLessThanOrEqual((10 - 1) / 20 + 1e-9);
      // A box flying into a hull target is caught as well.
      const box = new BoundingBox(new Vector3D(-20.5, -0.5, -0.5), new Vector3D(-19.5, 0.5, 0.5));
      const toiBox = Collision.sweep(box, new Vector3D(40, 0, 0), hull);
      expect(toiBox).toBeGreaterThan(0);
      expect(toiBox).toBeLessThan(1);
    });

    it("sweepBoxSphere does not corrupt shared scratch between consecutive calls", () => {
      const sph = new BoundingSphere(new Vector3D(5, 0, 0), 1);
      const half = new Vector3D(0.5, 0.5, 0.5);
      const a = Collision.sweepBoxSphere(new Vector3D(0, 0, 0), new Vector3D(10, 0, 0), half, sph);
      // Interleave other sweeps that use the shared scratch box, then repeat.
      Collision.sweepSphereBox(
        new Vector3D(0, 0, 0),
        new Vector3D(9, 9, 9),
        3,
        new BoundingBox(new Vector3D(1, 1, 1), new Vector3D(2, 2, 2)),
      );
      const b = Collision.sweepBoxSphere(new Vector3D(0, 0, 0), new Vector3D(10, 0, 0), half, sph);
      expect(a).toBeCloseTo((5 - 1 - 0.5) / 10, 6);
      expect(b).toBe(a);
    });

    it("sweepRayVolume with an unnormalised delta returns the fraction of delta", () => {
      const sph = new BoundingSphere(new Vector3D(10, 0, 0), 1);
      const t = Collision.sweepRayVolume(new Vector3D(0, 0, 0), new Vector3D(20, 0, 0), sph);
      expect(t).toBeCloseTo(9 / 20, 9);
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
