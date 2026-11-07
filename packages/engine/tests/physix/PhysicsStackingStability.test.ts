import { describe, it, expect, beforeEach } from "vitest";
import { PhysicsSystem } from "../../src/physix/PhysicsSystem.js";
import { Scene } from "../../src/core/Scene.js";
import { Object3D } from "../../src/core/Object3D.js";
import { RigidBody } from "../../src/physix/RigidBody.js";
import { BoundingBox } from "../../src/physix/BoundingBox.js";
import { Vector3D } from "../../src/math/index.js";
import { EventDispatcherImpl } from "../../src/core/events/EventDispatcherImpl.js";
import { Cube } from "../../src/geometry/Cube.js";

describe("PhysicsSystem Multi-Iteration Stacking Stability & PGS Relaxation", () => {
  let system: PhysicsSystem;
  let scene: Scene;
  let events: EventDispatcherImpl;

  beforeEach(() => {
    events = new EventDispatcherImpl();
    system = new PhysicsSystem(events);
    system.gravity.set(0, -9.81, 0);
    system.fixedTimeStep = 1 / 60;
    scene = new Scene();
  });

  it("maintains a stable vertical stack of 3 boxes on static ground without sinking", () => {
    system.solverIterations = 4;

    // Static ground (top surface at y = 0)
    const ground = new Object3D("Ground");
    ground.rigidBody = new RigidBody(0);
    ground.bounds = new BoundingBox(new Vector3D(-50, -10, -50), new Vector3D(50, 0, 50));
    scene.add(ground);

    // Box 1 (y: 0 to 1, center at y = 0.5)
    const box1 = new Object3D("Box1");
    box1.geometry = new Cube({ size: 1 }).getGeometryData();
    box1.position.set(0, 0.5, 0);
    box1.rigidBody = new RigidBody(1.0);
    box1.rigidBody.restitution = 0.0;
    box1.rigidBody.friction = 0.5;
    box1.updateMatrixWorld();
    box1.computeBounds();
    scene.add(box1);

    // Box 2 (y: 1 to 2, center at y = 1.5)
    const box2 = new Object3D("Box2");
    box2.geometry = new Cube({ size: 1 }).getGeometryData();
    box2.position.set(0, 1.5, 0);
    box2.rigidBody = new RigidBody(1.0);
    box2.rigidBody.restitution = 0.0;
    box2.rigidBody.friction = 0.5;
    box2.updateMatrixWorld();
    box2.computeBounds();
    scene.add(box2);

    // Box 3 (y: 2 to 3, center at y = 2.5)
    const box3 = new Object3D("Box3");
    box3.geometry = new Cube({ size: 1 }).getGeometryData();
    box3.position.set(0, 2.5, 0);
    box3.rigidBody = new RigidBody(1.0);
    box3.rigidBody.restitution = 0.0;
    box3.rigidBody.friction = 0.5;
    box3.updateMatrixWorld();
    box3.computeBounds();
    scene.add(box3);

    // Simulate 180 frames (3 seconds at 60Hz)
    for (let i = 0; i < 180; i++) {
      system.step(scene, 1 / 60);
    }

    // Box 1 should rest at y = 0.5
    expect(box1.position.y).toBeCloseTo(0.5, 1);
    // Box 2 should rest at y = 1.5
    expect(box2.position.y).toBeCloseTo(1.5, 1);
    // Box 3 should rest at y = 2.5
    expect(box3.position.y).toBeCloseTo(2.5, 1);

    // Velocities should be near zero (settled stack)
    expect(Math.abs(box1.rigidBody!.velocity.y)).toBeLessThan(0.05);
    expect(Math.abs(box2.rigidBody!.velocity.y)).toBeLessThan(0.05);
    expect(Math.abs(box3.rigidBody!.velocity.y)).toBeLessThan(0.05);
  });

  it("higher solverIterations yield tighter stacking constraint satisfaction", () => {
    // Helper to simulate a stack under a given solver iteration count
    function simulateStack(iterations: number): { y1: number; y2: number; y3: number } {
      const s = new PhysicsSystem(new EventDispatcherImpl());
      s.gravity.set(0, -9.81, 0);
      s.fixedTimeStep = 1 / 60;
      s.solverIterations = iterations;

      const sc = new Scene();

      const g = new Object3D("Ground");
      g.rigidBody = new RigidBody(0);
      g.bounds = new BoundingBox(new Vector3D(-50, -10, -50), new Vector3D(50, 0, 50));
      sc.add(g);

      const b1 = new Object3D("B1");
      b1.geometry = new Cube({ size: 1 }).getGeometryData();
      b1.position.set(0, 0.5, 0);
      b1.rigidBody = new RigidBody(1.0);
      b1.rigidBody.restitution = 0.0;
      b1.updateMatrixWorld();
      b1.computeBounds();
      sc.add(b1);

      const b2 = new Object3D("B2");
      b2.geometry = new Cube({ size: 1 }).getGeometryData();
      b2.position.set(0, 1.5, 0);
      b2.rigidBody = new RigidBody(1.0);
      b2.rigidBody.restitution = 0.0;
      b2.updateMatrixWorld();
      b2.computeBounds();
      sc.add(b2);

      const b3 = new Object3D("B3");
      b3.geometry = new Cube({ size: 1 }).getGeometryData();
      b3.position.set(0, 2.5, 0);
      b3.rigidBody = new RigidBody(1.0);
      b3.rigidBody.restitution = 0.0;
      b3.updateMatrixWorld();
      b3.computeBounds();
      sc.add(b3);

      for (let i = 0; i < 60; i++) {
        s.step(sc, 1 / 60);
      }

      return { y1: b1.position.y, y2: b2.position.y, y3: b3.position.y };
    }

    const res1Iter = simulateStack(1);
    const res8Iter = simulateStack(8);

    // Under 8 iterations, the bottom box penetration error (|0.5 - y|) is significantly smaller
    const error1 = Math.abs(0.5 - res1Iter.y1);
    const error8 = Math.abs(0.5 - res8Iter.y1);

    expect(error8).toBeLessThanOrEqual(error1);
    expect(res8Iter.y1).toBeCloseTo(0.5, 1);
  });

  it("stacked boxes transition to sleeping state when undisturbed", () => {
    system.solverIterations = 4;

    const ground = new Object3D("Ground");
    ground.rigidBody = new RigidBody(0);
    ground.bounds = new BoundingBox(new Vector3D(-50, -10, -50), new Vector3D(50, 0, 50));
    scene.add(ground);

    const box1 = new Object3D("Box1");
    box1.geometry = new Cube({ size: 1 }).getGeometryData();
    box1.position.set(0, 0.5, 0);
    box1.rigidBody = new RigidBody(1.0);
    box1.rigidBody.restitution = 0.0;
    box1.rigidBody.sleepTimeThreshold = 0.3;
    box1.updateMatrixWorld();
    box1.computeBounds();
    scene.add(box1);

    const box2 = new Object3D("Box2");
    box2.geometry = new Cube({ size: 1 }).getGeometryData();
    box2.position.set(0, 1.5, 0);
    box2.rigidBody = new RigidBody(1.0);
    box2.rigidBody.restitution = 0.0;
    box2.rigidBody.sleepTimeThreshold = 0.3;
    box2.updateMatrixWorld();
    box2.computeBounds();
    scene.add(box2);

    // Simulate for 60 frames (1 second, well over 0.3s sleep threshold)
    for (let i = 0; i < 60; i++) {
      system.step(scene, 1 / 60);
    }

    // Both stacked boxes should be asleep
    expect(box1.rigidBody!.isSleeping).toBe(true);
    expect(box2.rigidBody!.isSleeping).toBe(true);
  });

  it("impact on sleeping stack wakes up affected bodies", () => {
    system.solverIterations = 4;

    const ground = new Object3D("Ground");
    ground.rigidBody = new RigidBody(0);
    ground.bounds = new BoundingBox(new Vector3D(-50, -10, -50), new Vector3D(50, 0, 50));
    scene.add(ground);

    const box1 = new Object3D("Box1");
    box1.geometry = new Cube({ size: 1 }).getGeometryData();
    box1.position.set(0, 0.5, 0);
    box1.rigidBody = new RigidBody(1.0);
    box1.rigidBody.restitution = 0.0;
    box1.updateMatrixWorld();
    box1.computeBounds();
    scene.add(box1);

    // Put box1 to sleep
    box1.rigidBody!.putToSleep();
    expect(box1.rigidBody!.isSleeping).toBe(true);

    // Fast projectile falling onto box1
    const projectile = new Object3D("Projectile");
    projectile.geometry = new Cube({ size: 0.5 }).getGeometryData();
    projectile.position.set(0, 1.2, 0);
    projectile.rigidBody = new RigidBody(2.0);
    projectile.rigidBody.velocity.set(0, -5.0, 0);
    projectile.updateMatrixWorld();
    projectile.computeBounds();
    scene.add(projectile);

    // Step physics: collision occurs
    system.step(scene, 1 / 60);

    // Box 1 should be woken up by the impact
    expect(box1.rigidBody!.isSleeping).toBe(false);
  });
});
