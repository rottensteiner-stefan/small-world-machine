import { describe, it, expect, beforeEach } from "vitest";
import { PhysicsSystem } from "../../src/physix/PhysicsSystem.js";
import { Scene } from "../../src/core/Scene.js";
import { Object3D } from "../../src/core/Object3D.js";
import { RigidBody } from "../../src/physix/RigidBody.js";
import { Sphere } from "../../src/geometry/Sphere.js";
import { StaticCollider } from "../../src/physix/StaticCollider.js";
import { BallSocketJoint } from "../../src/physix/joints/BallSocketJoint.js";
import { Vector3D } from "../../src/math/Vector3D.js";
import { EventDispatcherImpl } from "../../src/core/events/EventDispatcherImpl.js";

describe("PhysicsSleeping", () => {
  beforeEach(() => {
    Object3D.resetNextId();
    StaticCollider.resetNextId();
  });

  it("puts stationary bodies to sleep after inactivity duration", () => {
    const events = new EventDispatcherImpl();
    let sleepDispatched = false;
    events.addEventListener("physics:sleep", () => {
      sleepDispatched = true;
    });

    const physics = new PhysicsSystem(events);
    physics.gravity.set(0, 0, 0); // No gravity
    physics.fixedTimeStep = 0.1;
    const scene = new Scene();

    const ball = new Object3D("RestingBall");
    ball.geometry = new Sphere({ radius: 0.5 }).getGeometryData();
    ball.position.set(0, 0, 0);
    ball.rigidBody = new RigidBody(1.0);
    ball.rigidBody.sleepTimeThreshold = 0.3; // Sleep after 300ms
    ball.rigidBody.velocity.set(0.01, 0, 0); // Below sleepLinearThreshold (0.05)
    ball.updateMatrixWorld();
    ball.computeBounds();
    scene.objects.push(ball);

    // Step 1: 0.1s
    physics.step(scene, 0.1);
    expect(ball.rigidBody.isSleeping).toBe(false);

    // Step 2: 0.2s
    physics.step(scene, 0.1);
    expect(ball.rigidBody.isSleeping).toBe(false);

    // Step 3: 0.3s -> should enter sleep
    physics.step(scene, 0.1);
    expect(ball.rigidBody.isSleeping).toBe(true);
    expect(sleepDispatched).toBe(true);
    expect(ball.rigidBody.velocity.lengthSq()).toBe(0);
  });

  it("wakes up a sleeping body when hit by a moving body", () => {
    const events = new EventDispatcherImpl();
    let wakeupDispatched = false;
    events.addEventListener("physics:wakeup", () => {
      wakeupDispatched = true;
    });

    const physics = new PhysicsSystem(events);
    physics.gravity.set(0, 0, 0);
    physics.fixedTimeStep = 1 / 60;
    const scene = new Scene();

    // Sleeping ball resting at (1.0, 0, 0)
    const sleepingBall = new Object3D("SleepingBall");
    sleepingBall.geometry = new Sphere({ radius: 0.5 }).getGeometryData();
    sleepingBall.position.set(1.0, 0, 0);
    sleepingBall.rigidBody = new RigidBody(1.0);
    sleepingBall.rigidBody.putToSleep();
    sleepingBall.updateMatrixWorld();
    sleepingBall.computeBounds();
    scene.objects.push(sleepingBall);

    expect(sleepingBall.rigidBody.isSleeping).toBe(true);

    // Moving projectile starting at (0.2, 0, 0) moving fast right towards sleeping ball
    const bullet = new Object3D("Bullet");
    bullet.geometry = new Sphere({ radius: 0.5 }).getGeometryData();
    bullet.position.set(0.2, 0, 0);
    bullet.rigidBody = new RigidBody(1.0);
    bullet.rigidBody.velocity.set(5.0, 0, 0);
    bullet.updateMatrixWorld();
    bullet.computeBounds();
    scene.objects.push(bullet);

    // Step physics: bullet impacts sleepingBall
    physics.step(scene, 1 / 60);

    // Sleeping ball should be awakened and receive velocity impulse
    expect(sleepingBall.rigidBody.isSleeping).toBe(false);
    expect(wakeupDispatched).toBe(true);
    expect(sleepingBall.rigidBody.velocity.x).toBeGreaterThan(0);
  });

  it("wakes up when forces, impulses, or torques are applied", () => {
    const rb = new RigidBody(1.0);
    rb.putToSleep();
    expect(rb.isSleeping).toBe(true);

    // applyForce wakes up
    rb.applyForce(new Vector3D(10, 0, 0));
    expect(rb.isSleeping).toBe(false);

    // applyImpulse wakes up
    rb.putToSleep();
    expect(rb.isSleeping).toBe(true);
    rb.applyImpulse(new Vector3D(5, 0, 0));
    expect(rb.isSleeping).toBe(false);

    // applyTorque wakes up
    rb.putToSleep();
    expect(rb.isSleeping).toBe(true);
    rb.applyTorque(new Vector3D(0, 5, 0));
    expect(rb.isSleeping).toBe(false);
  });

  it("never puts bodies to sleep when allowSleep is false", () => {
    const events = new EventDispatcherImpl();
    const physics = new PhysicsSystem(events);
    physics.gravity.set(0, 0, 0);
    physics.fixedTimeStep = 0.5;
    const scene = new Scene();

    const ball = new Object3D("ImmortalBall");
    ball.geometry = new Sphere({ radius: 0.5 }).getGeometryData();
    ball.position.set(0, 0, 0);
    ball.rigidBody = new RigidBody(1.0);
    ball.rigidBody.allowSleep = false;
    ball.rigidBody.velocity.set(0, 0, 0);
    ball.updateMatrixWorld();
    ball.computeBounds();
    scene.objects.push(ball);

    // Run for 5 seconds
    for (let i = 0; i < 10; i++) {
      physics.step(scene, 0.5);
    }

    expect(ball.rigidBody.isSleeping).toBe(false);
  });

  it("does not wake resting joint-connected bodies (regression: joints re-woke sleepers)", () => {
    const events = new EventDispatcherImpl();
    const physics = new PhysicsSystem(events);
    physics.gravity.set(0, 0, 0);
    physics.fixedTimeStep = 1 / 60;
    const scene = new Scene();

    const a = new Object3D("JointA");
    a.geometry = new Sphere({ radius: 0.5 }).getGeometryData();
    a.position.set(0, 0, 0);
    a.rigidBody = new RigidBody(1.0);
    a.updateMatrixWorld();
    a.computeBounds();
    scene.objects.push(a);

    const b = new Object3D("JointB");
    b.geometry = new Sphere({ radius: 0.5 }).getGeometryData();
    b.position.set(2, 0, 0);
    b.rigidBody = new RigidBody(1.0);
    b.updateMatrixWorld();
    b.computeBounds();
    scene.objects.push(b);

    const joint = new BallSocketJoint({
      bodyA: a,
      bodyB: b,
      anchorA: new Vector3D(1, 0, 0),
      anchorB: new Vector3D(-1, 0, 0),
    });
    physics.addJoint(joint);

    // Put both connected bodies to sleep at rest.
    a.rigidBody!.putToSleep();
    b.rigidBody!.putToSleep();
    expect(a.rigidBody!.isSleeping).toBe(true);
    expect(b.rigidBody!.isSleeping).toBe(true);

    // The solver must not wake them with near-zero constraint impulses.
    for (let i = 0; i < 20; i++) {
      physics.step(scene, 1 / 60);
      expect(a.rigidBody!.isSleeping).toBe(true);
      expect(b.rigidBody!.isSleeping).toBe(true);
    }
  });
});
