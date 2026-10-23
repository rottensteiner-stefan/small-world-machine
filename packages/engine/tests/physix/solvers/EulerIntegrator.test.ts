import { describe, it, expect } from "vitest";
import { Object3D } from "../../../src/core/Object3D.js";
import { RigidBody } from "../../../src/physix/RigidBody.js";
import { EulerIntegrator } from "../../../src/physix/solvers/EulerIntegrator.js";
import { Vector3D } from "../../../src/math/index.js";

describe("EulerIntegrator", () => {
  it("integrates linear motion under gravity and external forces", () => {
    const obj = new Object3D("FallingApple");
    obj.rigidBody = new RigidBody(1.0); // 1kg
    obj.rigidBody.linearDamping = 0.98;
    const gravity = new Vector3D(0, -10, 0);
    const deltaP = new Vector3D();

    EulerIntegrator.integrateVelocity(obj, gravity, 1.0, 0.1, deltaP);
    EulerIntegrator.applyDisplacement(obj, deltaP);

    // v = 0 + (-10) * 0.1 * 0.98 = -0.98
    // deltaP = -0.98 * 0.1 = -0.098
    expect(obj.rigidBody.velocity.y).toBeCloseTo(-0.98);
    expect(obj.position.y).toBeCloseTo(-0.098);
    expect(deltaP.y).toBeCloseTo(-0.098);
  });

  it("interpolates blend position/rotation and restores the true state after", () => {
    const obj = new Object3D("InterpolatedEntity");
    obj.rigidBody = new RigidBody(1.0);
    obj.rigidBody.prevPosition.set(0, 0, 0);
    obj.position.set(10, 0, 0);

    const truePos = new Vector3D();
    const trueRot = new Vector3D();
    const blendPos = new Vector3D();
    const blendRot = new Vector3D();

    EulerIntegrator.interpolateTransform(obj, 0.5, truePos, trueRot, blendPos, blendRot);

    // The actual function output: midpoint between previous and true state.
    expect(blendPos.x).toBeCloseTo(5);
    expect(blendPos.y).toBe(0);
    expect(blendPos.z).toBe(0);
    expect(truePos.x).toBe(10);
    // The object is rendered from the blend but its authoritative state is restored.
    expect(obj.position.x).toBe(10);
  });

  it("interpolates rotation along the shortest path", () => {
    const obj = new Object3D("WrappedEntity");
    obj.rigidBody = new RigidBody(1.0);
    // Previous rotation at PI - 0.2; true rotation at -PI + 0.2 (~ +PI + 0.2 after wrapping).
    // The shortest arc is +0.4 forward through the PI/-PI seam -- NOT the 2*PI - 0.4 long way.
    obj.rigidBody.prevRotation.set(Math.PI - 0.2, 0, 0);
    obj.rotation.set(-Math.PI + 0.2, 0, 0);

    const truePos = new Vector3D();
    const trueRot = new Vector3D();
    const blendPos = new Vector3D();
    const blendRot = new Vector3D();

    EulerIntegrator.interpolateTransform(obj, 0.5, truePos, trueRot, blendPos, blendRot);

    // Midpoint of the shortest arc: (PI - 0.2) + 0.4 * 0.5 = PI. The long way would yield ~5.883.
    expect(blendRot.x).toBeCloseTo(Math.PI, 5);
  });

  it("produces exact angular results for a known torque/inertia/damping step", () => {
    const obj = new Object3D("SpinningTop");
    obj.rigidBody = new RigidBody(1.0);
    obj.rigidBody.angularDamping = 0.98; // explicit, for a closed-form expectation
    obj.rigidBody.torque.set(0, 10, 0); // Torque around Y

    EulerIntegrator.integrateAngular(obj, 1.0, 0.1);

    // angularAcceleration.y = torque.y * inverseInertia.y = 10 * 1 = 10
    // angularVelocity.y = 10 * 0.1 * 0.98 = 0.98
    expect(obj.rigidBody.angularVelocity.y).toBeCloseTo(0.98, 6);
    expect(obj.rotation.y).toBeGreaterThan(0);
  });
});
