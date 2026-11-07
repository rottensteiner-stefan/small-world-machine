import { describe, it, expect } from "vitest";
import { RigidBody } from "../../src/physix/RigidBody.js";
import { Vector3D } from "../../src/math/index.js";

describe("RigidBody", () => {
  it("should initialize with default parameters", () => {
    const rb = new RigidBody();
    expect(rb.mass).toBe(1.0);
    expect(rb.inverseMass).toBe(1.0);
    expect(rb.inertia).toBe(1.0);
    expect(rb.inverseInertia).toBe(1.0);
    expect(rb.restitution).toBe(0.2);
    expect(rb.friction).toBe(0.5);
    expect(rb.linearDamping).toBe(1.0);
    expect(rb.angularDamping).toBe(0.98);
    expect(rb.velocity.lengthSq()).toBe(0);
    expect(rb.acceleration.lengthSq()).toBe(0);
    expect(rb.forces.lengthSq()).toBe(0);
    expect(rb.angularVelocity.lengthSq()).toBe(0);
    expect(rb.angularAcceleration.lengthSq()).toBe(0);
    expect(rb.torque.lengthSq()).toBe(0);
  });

  it("should handle static/kinematic bodies (mass = 0)", () => {
    const rb = new RigidBody(0, 0);
    expect(rb.mass).toBe(0);
    expect(rb.inverseMass).toBe(0);
    expect(rb.inertia).toBe(0);
    expect(rb.inverseInertia).toBe(0);
  });

  it("should accumulate forces correctly", () => {
    const rb = new RigidBody(2.0); // inverseMass = 0.5
    rb.applyForce(new Vector3D(10, 0, 0));
    rb.applyForce(new Vector3D(0, 5, -2));
    expect(rb.forces.x).toBe(10);
    expect(rb.forces.y).toBe(5);
    expect(rb.forces.z).toBe(-2);
  });

  it("should ignore forces if mass is 0", () => {
    const rb = new RigidBody(0);
    rb.applyForce(new Vector3D(10, 0, 0));
    expect(rb.forces.lengthSq()).toBe(0);
  });

  it("should accumulate torque correctly", () => {
    const rb = new RigidBody(1.0, 5.0); // inverseInertia = 0.2
    rb.applyTorque(new Vector3D(0, 10, 0));
    expect(rb.torque.y).toBe(10);
  });

  it("should ignore torque if inertia is 0", () => {
    const rb = new RigidBody(1.0, 0);
    rb.applyTorque(new Vector3D(0, 10, 0));
    expect(rb.torque.lengthSq()).toBe(0);
  });

  it("should apply impulses correctly (instant velocity change)", () => {
    const rb = new RigidBody(2.0); // mass = 2 -> inverseMass = 0.5
    rb.applyImpulse(new Vector3D(10, 0, 0));
    // dv = impulse * inverseMass = 10 * 0.5 = 5
    expect(rb.velocity.x).toBe(5);
    expect(rb.velocity.y).toBe(0);

    rb.applyImpulse(new Vector3D(0, 4, 0));
    expect(rb.velocity.y).toBe(2);
  });

  it("should ignore impulses if mass is 0", () => {
    const rb = new RigidBody(0);
    rb.applyImpulse(new Vector3D(10, 0, 0));
    expect(rb.velocity.lengthSq()).toBe(0);
  });

  it("should clear forces and torques", () => {
    const rb = new RigidBody();
    rb.applyForce(new Vector3D(10, 10, 10));
    rb.applyTorque(new Vector3D(5, 5, 5));
    rb.clearForces();
    expect(rb.forces.lengthSq()).toBe(0);
    expect(rb.torque.lengthSq()).toBe(0);
  });

  it("should treat negative mass and inertia as static (inverse = 0)", () => {
    const rb = new RigidBody(-5.0, -10.0);
    expect(rb.mass).toBe(-5.0);
    expect(rb.inverseMass).toBe(0); // Protected by mass > 0 check
    expect(rb.inertia).toBe(-10.0);
    expect(rb.inverseInertia).toBe(0);

    rb.applyForce(new Vector3D(10, 0, 0));
    expect(rb.forces.lengthSq()).toBe(0); // Ignored due to inverseMass == 0
  });
});
