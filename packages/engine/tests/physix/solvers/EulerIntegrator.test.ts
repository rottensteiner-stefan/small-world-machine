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

  it("transforms world-space torque through rotated world inverse inertia tensor R * I^-1 * R^T (B5)", () => {
    const obj = new Object3D("AnisotropicRod");
    obj.rigidBody = new RigidBody(1.0);
    obj.rigidBody.angularDamping = 1.0;
    // Local X has invInertia = 2, Local Y has invInertia = 10
    obj.rigidBody.inverseInertiaTensor.set(2, 10, 2);
    // Rotate 90 degrees around Z so Local Y aligns with World -X (and Local X aligns with World +Y)
    obj.setRotation(0, 0, Math.PI / 2);
    // Apply world torque along World X (which is aligned with Local -Y -> invInertia = 10)
    obj.rigidBody.torque.set(5, 0, 0);

    EulerIntegrator.integrateAngular(obj, 1.0, 0.1);

    // World X angular velocity must use Local Y inverse inertia (10): 5 * 10 * 0.1 = 5.0
    expect(obj.rigidBody.angularVelocity.x).toBeCloseTo(5.0, 5);
  });

  it("applies timestep-independent damping identically across 60 Hz and 120 Hz substeps (S3)", () => {
    const obj60 = new Object3D("Body60");
    obj60.rigidBody = new RigidBody(1.0);
    obj60.rigidBody.linearDamping = 0.9;
    obj60.rigidBody.velocity.set(10, 0, 0);

    const obj120 = new Object3D("Body120");
    obj120.rigidBody = new RigidBody(1.0);
    obj120.rigidBody.linearDamping = 0.9;
    obj120.rigidBody.velocity.set(10, 0, 0);

    const zeroG = new Vector3D(0, 0, 0);
    const dp = new Vector3D();
    const refDt = 1 / 60;

    EulerIntegrator.integrateVelocity(obj60, zeroG, 1.0, 1 / 60, dp, refDt);
    EulerIntegrator.integrateVelocity(obj120, zeroG, 1.0, 1 / 120, dp, refDt);
    EulerIntegrator.integrateVelocity(obj120, zeroG, 1.0, 1 / 120, dp, refDt);

    expect(obj120.rigidBody.velocity.x).toBeCloseTo(obj60.rigidBody.velocity.x, 6);
  });

  it("stably integrates gyroscopic motion for an asymmetric body without energy blowup", () => {
    const obj = new Object3D("TennisRacket");
    obj.rigidBody = new RigidBody(1.0);
    obj.rigidBody.angularDamping = 1.0; // zero damping
    // Asymmetric inertia tensor (I1 < I2 < I3)
    obj.rigidBody.inertiaTensor.set(1.0, 2.0, 3.0);
    obj.rigidBody.inverseInertiaTensor.set(1.0, 0.5, 1.0 / 3.0);

    // Initial spin primarily around intermediate axis (Y) with small perturbation on X
    obj.rigidBody.angularVelocity.set(0.1, 5.0, 0.0);

    const dt = 1 / 120;
    for (let step = 0; step < 120; step++) {
      EulerIntegrator.integrateAngular(obj, 1.0, dt);
    }

    // Angular velocity magnitude must remain strictly bounded (no exponential divergence)
    const wLen = obj.rigidBody.angularVelocity.length();
    expect(wLen).toBeLessThan(10.0);
    // Gyroscopic coupling must have transferred angular velocity into the Z axis
    expect(Math.abs(obj.rigidBody.angularVelocity.z)).toBeGreaterThan(0.001);
  });
});
