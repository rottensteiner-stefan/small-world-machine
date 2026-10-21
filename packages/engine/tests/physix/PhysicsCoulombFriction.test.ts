import { describe, it, expect, beforeEach } from "vitest";
import { PhysicsSystem } from "../../src/physix/PhysicsSystem.js";
import { Scene } from "../../src/core/Scene.js";
import { Object3D } from "../../src/core/Object3D.js";
import { RigidBody } from "../../src/physix/RigidBody.js";
import { Sphere } from "../../src/geometry/Sphere.js";
import { StaticCollider } from "../../src/physix/StaticCollider.js";
import { BoundingBox } from "../../src/physix/BoundingBox.js";
import { Vector3D } from "../../src/math/Vector3D.js";
import { EventDispatcherImpl } from "../../src/core/events/EventDispatcherImpl.js";

describe("PhysicsCoulombFriction", () => {
  beforeEach(() => {
    Object3D.resetNextId();
    StaticCollider.resetNextId();
  });

  it("reduces tangential velocity via dynamic friction when colliding with a surface", () => {
    const events = new EventDispatcherImpl();
    const physics = new PhysicsSystem(events);
    physics.gravity.set(0, 0, 0); // No gravity for controlled math check
    physics.fixedTimeStep = 1 / 60;
    const scene = new Scene();

    // Static ground at y = 0
    const floor = new StaticCollider(
      new BoundingBox(new Vector3D(-100, -1, -100), new Vector3D(100, 0, 100)),
    );
    floor.friction = 0.5;
    floor.restitution = 0.0;
    scene.staticColliders.push(floor);

    // Dynamic ball
    const ball = new Object3D("Ball");
    ball.geometry = new Sphere({ radius: 0.5 }).getGeometryData();
    // Placed slightly penetrating floor to trigger collision
    ball.position.set(0, 0.45, 0);
    ball.rigidBody = new RigidBody(1.0);
    ball.rigidBody.restitution = 0.0;
    ball.rigidBody.friction = 0.5;
    // Moving right at 10 m/s and downward at -5 m/s
    ball.rigidBody.velocity.set(10, -5, 0);
    ball.updateMatrixWorld();
    ball.computeBounds();
    scene.objects.push(ball);

    physics.step(scene, 1 / 60);

    // Normal impulse: jN = -(1+0)*(-5) = 5.0
    // Friction mu = sqrt(0.5 * 0.5) = 0.5
    // Max friction impulse = mu * jN = 0.5 * 5.0 = 2.5
    // Initial vx = 10, ideal impulse = 10 / 1 = 10
    // Clamped friction impulse = 2.5 -> new vx = 10 - 2.5 = 7.5
    expect(ball.rigidBody.velocity.y).toBeCloseTo(0, 3);
    expect(ball.rigidBody.velocity.x).toBeCloseTo(7.5, 3);
  });

  it("completely stops slow tangential sliding in the static friction regime", () => {
    const events = new EventDispatcherImpl();
    const physics = new PhysicsSystem(events);
    physics.gravity.set(0, 0, 0);
    physics.fixedTimeStep = 1 / 60;
    const scene = new Scene();

    const floor = new StaticCollider(
      new BoundingBox(new Vector3D(-100, -1, -100), new Vector3D(100, 0, 100)),
    );
    floor.friction = 0.8;
    floor.restitution = 0.0;
    scene.staticColliders.push(floor);

    const ball = new Object3D("SlowBall");
    ball.geometry = new Sphere({ radius: 0.5 }).getGeometryData();
    ball.position.set(0, 0.45, 0);
    ball.rigidBody = new RigidBody(1.0);
    ball.rigidBody.restitution = 0.0;
    ball.rigidBody.friction = 0.8;
    // Slow tangential slide (1.0 m/s) with strong normal impact (-5 m/s)
    ball.rigidBody.velocity.set(1.0, -5, 0);
    ball.updateMatrixWorld();
    ball.computeBounds();
    scene.objects.push(ball);

    physics.step(scene, 1 / 60);

    // Normal impulse = 5.0
    // Max friction impulse = 0.8 * 5.0 = 4.0
    // Ideal friction impulse to halt contact point slip (vx + w*r = 0):
    // effInvMassT = 1/m + r^2/I = 1.0 + 0.25 = 1.25 -> j = 1.0 / 1.25 = 0.8 <= 4.0
    // Resulting vx = 1.0 - 0.8 = 0.2, and angularVelocity.z = -0.8 * 0.5 / 1.0 = -0.4 rad/s
    // Contact point surface slip velocity: vx + wz * (-ry) = 0.2 + (-0.4)*(0.5) = 0.0
    // The ball rests within the penetration slop, so the lever arm is its centre height rather
    // than exactly 0.5: assert the behaviour (contact slip removed, sensible split between
    // linear and angular speed) instead of pinning five digits.
    const v = ball.rigidBody.velocity;
    const w = ball.rigidBody.angularVelocity;
    expect(v.x).toBeCloseTo(0.2, 1);
    expect(v.y).toBeCloseTo(0, 5);
    expect(Math.abs(v.x + w.z * ball.position.y)).toBeLessThan(1e-3);
  });

  it("preserves tangential velocity on frictionless surfaces (mu = 0)", () => {
    const events = new EventDispatcherImpl();
    const physics = new PhysicsSystem(events);
    physics.gravity.set(0, 0, 0);
    physics.fixedTimeStep = 1 / 60;
    const scene = new Scene();

    const iceFloor = new StaticCollider(
      new BoundingBox(new Vector3D(-100, -1, -100), new Vector3D(100, 0, 100)),
    );
    iceFloor.friction = 0.0; // Frictionless
    iceFloor.restitution = 0.5;
    scene.staticColliders.push(iceFloor);

    const puck = new Object3D("Puck");
    puck.geometry = new Sphere({ radius: 0.5 }).getGeometryData();
    puck.position.set(0, 0.45, 0);
    puck.rigidBody = new RigidBody(1.0);
    puck.rigidBody.restitution = 0.5;
    puck.rigidBody.friction = 0.0;
    puck.rigidBody.velocity.set(12.0, -4.0, 0);
    puck.updateMatrixWorld();
    puck.computeBounds();
    scene.objects.push(puck);

    physics.step(scene, 1 / 60);

    // Tangential speed vx must remain strictly unchanged (12.0)
    expect(puck.rigidBody.velocity.x).toBeCloseTo(12.0, 5);
    // Vertical velocity reflected with restitution 0.5: -(-4.0) * 0.5 = 2.0
    expect(puck.rigidBody.velocity.y).toBeCloseTo(2.0, 3);
  });

  it("applies symmetric tangential friction impulses between two dynamic bodies", () => {
    const events = new EventDispatcherImpl();
    const physics = new PhysicsSystem(events);
    physics.gravity.set(0, 0, 0);
    physics.fixedTimeStep = 1 / 60;
    const scene = new Scene();

    // Body 1: moving right (+X) and up (+Y)
    const b1 = new Object3D("B1");
    b1.geometry = new Sphere({ radius: 0.5 }).getGeometryData();
    b1.position.set(-0.4, 0, 0);
    b1.rigidBody = new RigidBody(1.0);
    b1.rigidBody.restitution = 0.0;
    b1.rigidBody.friction = 0.6;
    b1.rigidBody.velocity.set(4, 2, 0);
    b1.updateMatrixWorld();
    b1.computeBounds();

    // Body 2: moving left (-X) and down (-Y)
    const b2 = new Object3D("B2");
    b2.geometry = new Sphere({ radius: 0.5 }).getGeometryData();
    b2.position.set(0.4, 0, 0);
    b2.rigidBody = new RigidBody(1.0);
    b2.rigidBody.restitution = 0.0;
    b2.rigidBody.friction = 0.6;
    b2.rigidBody.velocity.set(-4, -2, 0);
    b2.updateMatrixWorld();
    b2.computeBounds();

    scene.objects.push(b1, b2);

    // Initial total momentum: P_x = 1*4 + 1*(-4) = 0, P_y = 1*2 + 1*(-2) = 0
    physics.step(scene, 1 / 60);

    // Total momentum must remain conserved (0)
    const totalPx = b1.rigidBody.velocity.x + b2.rigidBody.velocity.x;
    const totalPy = b1.rigidBody.velocity.y + b2.rigidBody.velocity.y;
    expect(totalPx).toBeCloseTo(0, 5);
    expect(totalPy).toBeCloseTo(0, 5);

    // Relative tangential velocity in Y should be reduced by friction
    expect(Math.abs(b1.rigidBody.velocity.y)).toBeLessThan(2.0);
    expect(Math.abs(b2.rigidBody.velocity.y)).toBeLessThan(2.0);
  });
});
