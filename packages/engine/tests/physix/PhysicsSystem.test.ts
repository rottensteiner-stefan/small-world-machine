import { describe, it, expect, beforeEach } from "vitest";
import { PhysicsSystem } from "../../src/physix/PhysicsSystem.js";
import { Scene } from "../../src/core/Scene.js";
import { Object3D } from "../../src/core/Object3D.js";
import { RigidBody } from "../../src/physix/RigidBody.js";
import { Vector3D } from "../../src/math/index.js";
import { Cube, Sphere } from "../../src/geometry/index.js";
import { BoundingSphere } from "../../src/physix/BoundingSphere.js";
import { BoundingBox } from "../../src/physix/BoundingBox.js";
import { OBB } from "../../src/physix/OBB.js";
import { StaticCollider } from "../../src/physix/StaticCollider.js";
import { EventDispatcherImpl } from "../../src/core/events/EventDispatcherImpl.js";
import { pairKey } from "../../src/physix/solvers/ContactSolver.js";

describe("PhysicsSystem", () => {
  let system: PhysicsSystem;
  let scene: Scene;
  let events: EventDispatcherImpl;

  beforeEach(() => {
    events = new EventDispatcherImpl();
    system = new PhysicsSystem(events);
    // Default gravity is -9.81 on Y, set to 0 for controlled tests
    system.gravity.set(0, 0, 0);
    system.maxDeltaTime = 1000.0;
    system.maxDeltaTime = 1000.0;
    scene = new Scene();
  });

  it("should integrate linear velocity and position", () => {
    const obj = new Object3D();
    const rb = new RigidBody(1.0);
    rb.friction = 1.0; // no damping
    obj.rigidBody = rb;
    scene.add(obj);

    rb.applyForce(new Vector3D(10, 0, 0));

    // dt = 1.0s
    system.fixedTimeStep = 1.0;
    system.fixedTimeStep = 1.0;
    system.step(scene, 1.0);

    // a = 10 / 1 = 10
    // v = v + a*dt = 10
    // p = p + v*dt = 10
    expect(rb.acceleration.x).toBe(10);
    expect(rb.velocity.x).toBe(10);
    expect(obj.position.x).toBe(10);

    // Forces should be cleared
    expect(rb.forces.x).toBe(0);
  });

  it("should apply global gravity", () => {
    const obj = new Object3D();
    const rb = new RigidBody(2.0);
    rb.friction = 1.0;
    obj.rigidBody = rb;
    scene.add(obj);

    system.gravity.set(0, -10, 0);

    system.fixedTimeStep = 0.5;
    system.fixedTimeStep = 0.5;
    system.step(scene, 0.5);

    // Force = mass * gravity = 2 * -10 = -20
    // a = -20 / 2 = -10
    // v = 0 + (-10) * 0.5 = -5
    // p = 0 + (-5) * 0.5 = -2.5
    expect(rb.velocity.y).toBe(-5);
    expect(obj.position.y).toBe(-2.5);
  });

  it("should apply linear damping", () => {
    const obj = new Object3D();
    const rb = new RigidBody(1.0);
    rb.linearDamping = 0.5;
    obj.rigidBody = rb;
    scene.add(obj);

    rb.velocity.set(10, 0, 0);

    system.fixedTimeStep = 1.0;
    system.step(scene, 1.0);

    // After linear damping, velocity should be 10 * 0.5 = 5
    expect(rb.velocity.x).toBe(5);
    // position = p + v * dt = 0 + 5 * 1 = 5
    expect(obj.position.x).toBe(5);
  });

  it("should integrate angular velocity and apply rotation via Quaternions", () => {
    const obj = new Object3D();
    const rb = new RigidBody(1.0, 1.0);
    rb.angularDamping = 1.0; // no damping
    obj.rigidBody = rb;
    scene.add(obj);

    // Apply torque on Y axis
    rb.applyTorque(new Vector3D(0, Math.PI, 0));

    // step 0.5s
    system.fixedTimeStep = 0.5;
    system.fixedTimeStep = 0.5;
    system.step(scene, 0.5);

    // a_angular = PI / 1 = PI
    // w = 0 + PI * 0.5 = PI/2 (90 degrees)
    expect(rb.angularVelocity.y).toBeCloseTo(Math.PI / 2);

    // object rotation around Y should be approx PI/2 * dt = PI/4 (45 degrees)
    // Wait, step does: deltaW = a_angular * dt -> w += deltaW -> apply w * dt
    // w = PI/2. Then angle = w * dt = (PI/2) * 0.5 = PI/4.
    expect(obj.rotation.y).toBeCloseTo(Math.PI / 4, 5);

    // Torque should be cleared
    expect(rb.torque.lengthSq()).toBe(0);
  });

  it("should not move static bodies (mass = 0)", () => {
    const obj = new Object3D();
    const rb = new RigidBody(0);
    obj.rigidBody = rb;
    scene.add(obj);

    system.gravity.set(0, -10, 0);
    rb.applyForce(new Vector3D(100, 100, 100));
    rb.applyTorque(new Vector3D(100, 100, 100));

    system.fixedTimeStep = 1.0;
    system.fixedTimeStep = 1.0;
    system.step(scene, 1.0);

    expect(rb.velocity.lengthSq()).toBe(0);
    expect(rb.angularVelocity.lengthSq()).toBe(0);
    expect(obj.position.lengthSq()).toBe(0);
    expect(obj.rotation.lengthSq()).toBe(0);
  });

  it("should safely ignore dt <= 0 without modifying anything", () => {
    const obj = new Object3D();
    const rb = new RigidBody(1.0);
    obj.rigidBody = rb;
    scene.add(obj);

    rb.applyForce(new Vector3D(100, 100, 100));
    rb.velocity.set(10, 10, 10);
    obj.position.set(5, 5, 5);

    system.fixedTimeStep = 0;
    system.fixedTimeStep = 0;
    system.step(scene, 0);
    expect(rb.forces.lengthSq()).toBe(30000); // not cleared
    expect(rb.velocity.x).toBe(10);
    expect(obj.position.x).toBe(5);

    system.step(scene, -1.0);
    expect(rb.forces.lengthSq()).toBe(30000);
  });

  it("should not crash if objects have no RigidBody", () => {
    const obj1 = new Object3D();
    const obj2 = new Object3D();
    obj2.rigidBody = new RigidBody(1.0);
    scene.add(obj1, obj2);

    expect(() => system.step(scene, 1.0)).not.toThrow();
  });

  it("should handle extremely small angular velocities gracefully (wLength < epsilon)", () => {
    const obj = new Object3D();
    const rb = new RigidBody(1.0, 1.0);
    obj.rigidBody = rb;
    scene.add(obj);

    rb.applyTorque(new Vector3D(0.0000001, 0, 0));

    expect(() => system.step(scene, 1.0)).not.toThrow();
    expect(obj.rotation.x).toBeCloseTo(0, 5);
  });

  it("should handle large impulses without NaNing out (stability check)", () => {
    const obj = new Object3D();
    const rb = new RigidBody(1.0);
    obj.rigidBody = rb;
    scene.add(obj);

    rb.applyImpulse(new Vector3D(1e10, -1e10, 1e10));

    expect(Number.isNaN(rb.velocity.x)).toBe(false);
    expect(rb.velocity.x).toBe(1e10);

    system.fixedTimeStep = 1.0;
    system.fixedTimeStep = 1.0;
    system.step(scene, 1.0);

    expect(Number.isNaN(obj.position.x)).toBe(false);
    expect(obj.position.x).toBeCloseTo(1e10, -8);
  });

  it("should resolve Sphere-Sphere collisions (push apart and bounce)", async () => {
    const { BoundingSphere } = await import("../../src/physix/BoundingSphere.js");

    const sphere1 = new Object3D();
    sphere1.position.set(0, 0, 0);
    const rb1 = new RigidBody(1.0);
    rb1.restitution = 1.0;
    rb1.friction = 1.0;
    sphere1.rigidBody = rb1;
    sphere1.bounds = new BoundingSphere(sphere1.position, 1.0);

    const sphere2 = new Object3D();
    sphere2.position.set(1.5, 0, 0); // Penetrating by 0.5
    const rb2 = new RigidBody(1.0);
    rb2.restitution = 1.0;
    rb2.friction = 1.0;
    sphere2.rigidBody = rb2;
    sphere2.bounds = new BoundingSphere(sphere2.position, 1.0);

    scene.add(sphere1, sphere2);

    // We want them to bounce back.
    // They are already penetrating, so let's set velocities so they bounce.
    rb1.velocity.set(1, 0, 0);
    rb2.velocity.set(-1, 0, 0);

    // Call resolveCollisions directly by casting to any to avoid integration step tunneling
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (system as any)._resolveCollisions([sphere1, sphere2], [sphere1, sphere2]);

    // After positional correction:
    // depth is 0.5. totalInvMass is 2. correction is 0.25.
    // normal points from s2(1.5) to s1(0) -> (-1, 0, 0).
    // so s1 is pushed left by 0.25 -> x = -0.25
    // so s2 is pushed right by 0.25 -> x = 1.75
    expect(sphere1.position.x).toBeCloseTo(-0.25, 1);
    expect(sphere2.position.x).toBeCloseTo(1.75, 1);

    // After impulse:
    // normal = (-1, 0, 0)
    // velA = 1, velB = -1. rv = (2, 0, 0)
    // velAlongNormal = -2
    // e = 1.0. jMag = -(2) * -2 / 2 = 2.
    // impulse = normal * jMag = (-2, 0, 0)
    // rb1 gets (-2, 0, 0). new vel = (1 - 2) = -1.
    // rb2 gets (2, 0, 0). new vel = (-1 + 2) = 1.
    expect(rb1.velocity.x).toBeCloseTo(-1);
    expect(rb2.velocity.x).toBeCloseTo(1);
  });
  it("should resolve Box-Box collisions (push apart and bounce)", () => {
    const box1 = new Object3D();
    box1.position.set(0, 0, 0);
    const rb1 = new RigidBody(1.0);
    rb1.restitution = 1.0;
    rb1.friction = 1.0;
    box1.rigidBody = rb1;
    box1.bounds = new BoundingBox(new Vector3D(-1, -1, -1), new Vector3D(1, 1, 1));

    const box2 = new Object3D();
    box2.position.set(1.5, 0, 0);
    const rb2 = new RigidBody(1.0);
    rb2.restitution = 1.0;
    rb2.friction = 1.0;
    box2.rigidBody = rb2;
    box2.bounds = new BoundingBox(new Vector3D(0.5, -1, -1), new Vector3D(2.5, 1, 1));

    scene.add(box1, box2);

    rb1.velocity.set(1, 0, 0);
    rb2.velocity.set(-1, 0, 0);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (system as any)._resolveCollisions([box1, box2], [box1, box2]);

    // Overlap on X is 0.5 (box1 max.x=1, box2 min.x=0.5), Y/Z fully overlap -> X is least penetration.
    // Same depth/mass/velocity setup as the Sphere-Sphere test above, so the correction and
    // impulse math resolve identically: box1 pushed left, box2 pushed right, velocities reverse.
    expect(box1.position.x).toBeCloseTo(-0.25, 1);
    expect(box2.position.x).toBeCloseTo(1.75, 1);
    expect(rb1.velocity.x).toBeCloseTo(-1);
    expect(rb2.velocity.x).toBeCloseTo(1);
  });

  it("should resolve OBB-OBB collisions (push apart and bounce)", () => {
    const obb1 = new Object3D();
    obb1.position.set(0, 0, 0);
    const rb1 = new RigidBody(1.0);
    rb1.restitution = 1.0;
    rb1.friction = 1.0;
    obb1.rigidBody = rb1;
    const bounds1 = new OBB();
    bounds1.center.set(0, 0, 0);
    bounds1.halfExtents.set(1, 1, 1);
    obb1.bounds = bounds1;

    const obb2 = new Object3D();
    obb2.position.set(1.5, 0, 0);
    const rb2 = new RigidBody(1.0);
    rb2.restitution = 1.0;
    rb2.friction = 1.0;
    obb2.rigidBody = rb2;
    const bounds2 = new OBB();
    bounds2.center.set(1.5, 0, 0);
    bounds2.halfExtents.set(1, 1, 1);
    obb2.bounds = bounds2;

    scene.add(obb1, obb2);

    rb1.velocity.set(1, 0, 0);
    rb2.velocity.set(-1, 0, 0);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (system as any)._resolveCollisions([obb1, obb2], [obb1, obb2]);

    // Same depth/mass/velocity setup as the axis-aligned Box-Box test above -> identical math.
    expect(obb1.position.x).toBeCloseTo(-0.25, 1);
    expect(obb2.position.x).toBeCloseTo(1.75, 1);
    expect(rb1.velocity.x).toBeCloseTo(-1);
    expect(rb2.velocity.x).toBeCloseTo(1);
  });

  it("should resolve collisions against Scene.staticColliders (colliders outside the Object3D graph)", () => {
    const dynObj = new Object3D();
    dynObj.rigidBody = new RigidBody(1);
    dynObj.position.set(0, 0, 0);
    dynObj.bounds = new BoundingSphere(dynObj.position, 1.0);
    scene.add(dynObj);

    // A static wall that lives entirely outside the Object3D scene graph.
    const wallBounds = new BoundingBox(new Vector3D(0.5, -1, -1), new Vector3D(2.5, 1, 1));
    const wall = new StaticCollider(wallBounds);
    scene.staticColliders.push(wall);

    dynObj.rigidBody.velocity.set(1, 0, 0);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (system as any)._resolveCollisions([dynObj], [dynObj, wall]);

    // Sphere (r=1 at x=0) overlaps the wall (box x=0.5..2.5) by 0.5. The wall has no RigidBody
    // (infinite mass), so all positional correction lands on dynObj, pushing it left of x=0.
    expect(dynObj.position.x).toBeLessThan(0);
  });

  it("should not crash with NaN if an object lacks a RigidBody (restitution bug)", () => {
    // Dynamic object
    const dynObj = new Object3D();
    dynObj.geometry = new Sphere({ radius: 1 }).getGeometryData();
    dynObj.rigidBody = new RigidBody(1.0);
    dynObj.position.set(0, 1, 0); // slightly overlapping the static object
    scene.add(dynObj);

    // Static object WITHOUT a rigid body
    const staticObj = new Object3D();
    staticObj.geometry = new Sphere({ radius: 1 }).getGeometryData();
    staticObj.position.set(0, 0, 0);
    scene.add(staticObj);

    // Initial bounds
    scene.update();
    for (const obj of scene.objects) {
      obj.computeBounds();
    }

    // Step physics
    system.gravity.set(0, -10, 0);
    expect(() => {
      system.fixedTimeStep = 0.1;
      system.fixedTimeStep = 0.1;
      system.step(scene, 0.1);
    }).not.toThrow();

    // The dynamic object should not have NaN velocity
    expect(Number.isNaN(dynObj.rigidBody.velocity.y)).toBe(false);
  });

  it("should correctly resolve Sphere vs Box collision (Tunneling regression)", () => {
    // Large static floor
    const floor = new Object3D("Floor");
    floor.geometry = new Cube({ size: 1 }).getGeometryData();
    floor.setScale(40, 10, 40);
    floor.position.set(0, -5, 0);
    floor.rigidBody = new RigidBody(0);
    scene.add(floor);

    // Dynamic marble
    const marble = new Object3D("Marble");
    marble.geometry = new Sphere({ radius: 1 }).getGeometryData();
    marble.position.set(0, 5, 0); // Drop from Y=5
    marble.rigidBody = new RigidBody(1);
    scene.add(marble);

    // Initial setup
    scene.update();
    for (const obj of scene.objects) {
      obj.computeBounds();
    }

    // Gravity
    system.gravity.set(0, -9.81, 0);

    // Step for 100 frames
    for (let i = 0; i < 100; i++) {
      system.fixedTimeStep = 0.016;
      system.fixedTimeStep = 0.016;
      system.step(scene, 0.016);
      scene.update();
    }

    // Marble should have bounced and come to rest around Y=1.0 (radius)
    // Floating point math might not be exactly 1.0, but it should be above 0.
    expect(marble.position.y).toBeGreaterThan(0.9);
  });

  it("should correctly identify collisions in a dispersed scene (Broadphase Equivalence)", () => {
    // 30 scattered bodies.
    const bodies: Object3D[] = [];
    for (let i = 0; i < 30; i++) {
      const obj = new Object3D();
      obj.rigidBody = new RigidBody(1);
      // Place them far apart
      obj.position.set(i * 10, 0, i * 10);
      obj.bounds = new BoundingSphere(obj.position, 1.0);
      scene.add(obj);
      bodies.push(obj);
    }

    // Pair 1: explicitly colliding
    bodies[0]!.position.set(0, 0, 0);
    bodies[1]!.position.set(0.5, 0, 0);
    bodies[0]!.rigidBody!.velocity.set(1, 0, 0);
    bodies[1]!.rigidBody!.velocity.set(-1, 0, 0);

    // Pair 2: explicitly colliding far away
    bodies[20]!.position.set(200, 0, 200);
    bodies[21]!.position.set(200.5, 0, 200);
    bodies[20]!.rigidBody!.velocity.set(1, 0, 0);
    bodies[21]!.rigidBody!.velocity.set(-1, 0, 0);

    // Only these 2 pairs should be processed and bounce.
    system.fixedTimeStep = 0.1;
    system.fixedTimeStep = 0.1;
    system.step(scene, 0.1);

    // Check Pair 1
    expect(bodies[0]!.position.x).toBeLessThan(0); // bounced left
    expect(bodies[1]!.position.x).toBeGreaterThan(0.5); // bounced right

    // Check Pair 2
    expect(bodies[20]!.position.x).toBeLessThan(200);
    expect(bodies[21]!.position.x).toBeGreaterThan(200.5);

    // Check others didn't move (e.g. index 10)
    expect(bodies[10]!.position.x).toBe(100);
  });

  describe("CCD (fast-moving sphere bodies)", () => {
    // Dynamic bodies going through the full `step()` pipeline must have real geometry: unlike
    // the direct-`_resolveCollisions()` tests above, `step()`'s integration loop calls
    // `obj.computeBounds()` on every dynamic body every substep, which *derives* bounds from
    // geometry + world matrix -- a manually-assigned `.bounds` with no geometry behind it gets
    // wiped back to `undefined` the moment that runs. Static bodies (mass 0) are never touched by
    // that loop, so they can keep the simpler manual-bounds shortcut used elsewhere in this file.
    function makeDynamicMarble(radius: number): Object3D {
      const marble = new Object3D("Marble");
      marble.geometry = new Sphere({ radius }).getGeometryData();
      marble.rigidBody = new RigidBody(1);
      marble.rigidBody.friction = 1.0; // no damping -- keeps the velocity/displacement math exact
      return marble;
    }

    it("should prevent a fast sphere from tunneling through a thin wall in a single substep", () => {
      // A thin wall a fast marble would otherwise sail straight through in one substep without CCD.
      const wall = new Object3D("Wall");
      wall.rigidBody = new RigidBody(0);
      wall.bounds = new BoundingBox(new Vector3D(4.9, -5, -5), new Vector3D(5.1, 5, 5));
      scene.add(wall);

      const marble = makeDynamicMarble(0.5);
      marble.position.set(0, 0, 0);
      marble.rigidBody!.restitution = 0;
      scene.add(marble);
      scene.update();
      marble.computeBounds();

      // 1000 units/sec straight at the wall -- at dt=1/60 that's ~16.7 units of travel, more
      // than three times the distance to the wall, so an unprotected discrete check would never
      // see an overlap at all.
      marble.rigidBody!.velocity.set(1000, 0, 0);

      system.fixedTimeStep = 1 / 60;
      system.step(scene, 1 / 60);

      // Without CCD this would land around x=16.7 (tunneled clean through). With CCD it must be
      // stopped at/just past the wall's near face (x=4.9), well short of the far side.
      expect(marble.position.x).toBeLessThan(5.1);
      expect(marble.position.x).toBeGreaterThan(3.5);
    });

    it("should stop a fast sphere at a thin static sphere obstacle via CCD", () => {
      const obstacle = new Object3D("Obstacle");
      obstacle.rigidBody = new RigidBody(0);
      obstacle.bounds = new BoundingSphere(new Vector3D(5, 0, 0), 0.5);
      scene.add(obstacle);

      const marble = makeDynamicMarble(0.5);
      marble.position.set(0, 0, 0);
      marble.rigidBody!.restitution = 0;
      scene.add(marble);
      scene.update();
      marble.computeBounds();

      marble.rigidBody!.velocity.set(1000, 0, 0);

      system.fixedTimeStep = 1 / 60;
      system.step(scene, 1 / 60);

      // Combined radius is 1.0, so contact happens with centers 1 unit apart, i.e. around x=4.
      expect(marble.position.x).toBeLessThan(4.5);
      expect(marble.position.x).toBeGreaterThan(2.0);
    });

    it("should not alter slow-moving bodies that never cross the CCD threshold", () => {
      const marble = makeDynamicMarble(0.5);
      marble.position.set(0, 0, 0);
      scene.add(marble);
      scene.update();
      marble.computeBounds();

      marble.rigidBody!.velocity.set(1, 0, 0); // Well under the radius-per-substep CCD threshold.

      system.fixedTimeStep = 1 / 60;
      system.step(scene, 1 / 60);

      // Plain, un-swept integration: p = v * dt.
      expect(marble.position.x).toBeCloseTo(1 * (1 / 60));
    });

    it("should let a fast sphere tunnel through when CCD is disabled via ccdMotionThreshold = Infinity", () => {
      system.ccdMotionThreshold = Infinity;

      const wall = new Object3D("Wall");
      wall.rigidBody = new RigidBody(0);
      wall.bounds = new BoundingBox(new Vector3D(4.9, -5, -5), new Vector3D(5.1, 5, 5));
      scene.add(wall);

      const marble = makeDynamicMarble(0.5);
      marble.position.set(0, 0, 0);
      scene.add(marble);
      scene.update();
      marble.computeBounds();

      marble.rigidBody!.velocity.set(1000, 0, 0);

      system.fixedTimeStep = 1 / 60;
      system.step(scene, 1 / 60);

      // With CCD off, the marble simply integrates straight through the wall this substep.
      expect(marble.position.x).toBeCloseTo(1000 * (1 / 60));
      expect(marble.position.x).toBeGreaterThan(5.1);
    });

    it("should sweep fast box bodies and prevent them from tunneling", () => {
      const wall = new Object3D("Wall");
      wall.rigidBody = new RigidBody(0);
      wall.bounds = new BoundingBox(new Vector3D(4.9, -5, -5), new Vector3D(5.1, 5, 5));
      scene.add(wall);

      const fastBox = new Object3D("FastBox");
      fastBox.geometry = new Cube({ size: 1 }).getGeometryData();
      fastBox.position.set(0, 0, 0);
      fastBox.rigidBody = new RigidBody(1);
      fastBox.rigidBody.friction = 1.0;
      scene.add(fastBox);
      scene.update();
      fastBox.computeBounds();

      fastBox.rigidBody.velocity.set(1000, 0, 0);

      system.fixedTimeStep = 1 / 60;
      system.step(scene, 1 / 60);

      // Fast box is now swept via SweptVolumeCCD and clamped before tunneling past x=4.9
      expect(fastBox.position.x).toBeLessThan(4.9);
      expect(fastBox.position.x).toBeGreaterThan(4.0);
    });
  });

  it("should correctly resolve objects that fall into the broadphase fallback list (Boundary Edge Case)", async () => {
    const s1 = new Object3D();
    s1.rigidBody = new RigidBody(1);
    s1.position.set(0, 0, 0);
    s1.bounds = new BoundingSphere(s1.position, 1.0);

    const s2 = new Object3D();
    s2.rigidBody = new RigidBody(1);
    s2.position.set(0.5, 0, 0);
    s2.bounds = new BoundingSphere(s2.position, 1.0);

    scene.add(s1, s2);

    s1.rigidBody.velocity.set(1, 0, 0);
    s2.rigidBody.velocity.set(-1, 0, 0);

    // Mock Octree to reject s2, forcing it into _broadphaseFallback
    const { Octree } = await import("../../src/core/culling/Octree.js");
    const originalInsert = Octree.prototype.insert;
    Octree.prototype.insert = function (
      obj: import("../../src/interfaces/index.js").Collidable,
    ): boolean {
      if (obj === s2) return false;
      return originalInsert.call(this, obj);
    };

    system.fixedTimeStep = 0.1;
    system.fixedTimeStep = 0.1;
    system.step(scene, 0.1);

    Octree.prototype.insert = originalInsert;

    // The collision should still resolve because s2 is in the fallback list!
    expect(s1.position.x).toBeLessThan(0);
    expect(s2.position.x).toBeGreaterThan(0.5);
  });

  describe("Render Interpolation", () => {
    it("exposes interpolationAlpha as the accumulator's progress into the next fixed step", () => {
      const obj = new Object3D();
      const rb = new RigidBody(1.0);
      rb.friction = 1.0;
      obj.rigidBody = rb;
      scene.add(obj);
      rb.velocity.set(10, 0, 0);

      system.fixedTimeStep = 1.0;
      system.step(scene, 1.0); // exactly one substep; accumulator back to 0
      expect(system.interpolationAlpha).toBeCloseTo(0, 10);

      system.step(scene, 0.25); // no new substep fires; accumulator -> 0.25
      expect(system.interpolationAlpha).toBeCloseTo(0.25, 10);
    });

    it("renders a position blended between the previous and current physics state, then restores the true state", () => {
      const obj = new Object3D();
      const rb = new RigidBody(1.0);
      rb.friction = 1.0;
      obj.rigidBody = rb;
      scene.add(obj);
      rb.velocity.set(10, 0, 0);

      system.fixedTimeStep = 1.0;
      system.step(scene, 1.0); // substep: position 0 -> 10, prevPosition stays at 0
      system.step(scene, 0.5); // no new substep; alpha = 0.5

      system.applyRenderInterpolation();

      const pos = new Vector3D();
      const rot = new Vector3D();
      const scale = new Vector3D();
      obj.worldMatrix.decompose(pos, rot, scale);
      expect(pos.x).toBeCloseTo(5, 5);

      // The true, simulation-facing position must be unaffected afterward.
      expect(obj.position.x).toBe(10);
    });

    it("interpolates rotation via the shortest path across the +-PI wraparound", () => {
      const obj = new Object3D();
      const rb = new RigidBody(1.0);
      obj.rigidBody = rb;
      scene.add(obj);

      system.fixedTimeStep = 1.0;
      system.step(scene, 1.0); // populate the tracked-bodies list

      // Simulate a body that just crossed the +-PI seam between two physics states.
      rb.prevRotation.set(0, Math.PI - 0.3, 0);
      obj.rotation.set(0, -Math.PI + 0.1, 0);

      system.step(scene, 0.5); // no new substep this call; alpha = 0.5
      system.applyRenderInterpolation();

      const pos = new Vector3D();
      const rot = new Vector3D();
      const scale = new Vector3D();
      obj.worldMatrix.decompose(pos, rot, scale);

      // Shortest path from (PI - 0.3) to (-PI + 0.1) continues forward through PI (delta = +0.4),
      // so halfway should land near (PI - 0.1) -- not near the naive average (~-0.1), which is
      // what a plain (non-shortest-path) lerp would incorrectly produce.
      expect(rot.y).toBeCloseTo(Math.PI - 0.1, 2);

      // True rotation must be restored afterward.
      expect(obj.rotation.y).toBeCloseTo(-Math.PI + 0.1, 10);
    });

    it("discards leftover accumulator beyond maxSubSteps to prevent extrapolation (alpha < 1)", () => {
      system.fixedTimeStep = 1 / 60;
      system.maxSubSteps = 3;
      system.maxDeltaTime = 1.0;

      // Pass large dt that would require 10 steps (exceeding maxSubSteps=3)
      system.step(scene, 10 * (1 / 60) + 0.5 * (1 / 60));

      // After stepping, interpolationAlpha must be strictly in [0, 1)
      expect(system.interpolationAlpha).toBeLessThan(1.0);
      expect(system.interpolationAlpha).toBeGreaterThanOrEqual(0.0);
    });

    it("generates collision-free, symmetric pair keys for IDs above 2^21", () => {
      const idA = 100000000;
      const idB = 100000001;
      const key1 = pairKey(idA, idB);
      const key2 = pairKey(idB, idA);
      expect(key1).toBe(key2);

      const idC = 100000002;
      const key3 = pairKey(idA, idC);
      expect(key1).not.toBe(key3);

      const map = new Map<bigint, string>();
      map.set(key1, "AB");
      map.set(key3, "AC");
      expect(map.get(key2)).toBe("AB");
      expect(map.size).toBe(2);
    });
  });
});
