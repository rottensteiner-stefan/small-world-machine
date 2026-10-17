import { describe, it, expect } from "vitest";
import { RigidBody } from "../../src/physix/RigidBody.js";
import { RigidBodyMath } from "../../src/physix/RigidBodyMath.js";
import { Vector3D, Quaternion } from "../../src/math/index.js";

// Reference: legacy per-axis (body-frame) angular response: dW = invI * (r x J).
function legacyAngularResponse(rb: RigidBody, r: Vector3D, J: Vector3D): Vector3D {
  const tauX = r.y * J.z - r.z * J.y;
  const tauY = r.z * J.x - r.x * J.z;
  const tauZ = r.x * J.y - r.y * J.x;
  return new Vector3D(
    tauX * rb.inverseInertiaTensor.x,
    tauY * rb.inverseInertiaTensor.y,
    tauZ * rb.inverseInertiaTensor.z,
  );
}

// Independent reference for the world-space response: dW = R * I^-1 * R^T * (r x J) via quaternions.
function worldAngularResponse(
  rb: RigidBody,
  rotation: Vector3D,
  r: Vector3D,
  J: Vector3D,
): Vector3D {
  const tauX = r.y * J.z - r.z * J.y;
  const tauY = r.z * J.x - r.x * J.z;
  const tauZ = r.x * J.y - r.y * J.x;
  const q = new Quaternion(0, 0, 0, 1).setFromEuler(rotation);
  const local = new Vector3D(tauX, tauY, tauZ).applyQuaternion(
    new Quaternion(-q.x, -q.y, -q.z, q.w),
  );
  local.x *= rb.inverseInertiaTensor.x;
  local.y *= rb.inverseInertiaTensor.y;
  local.z *= rb.inverseInertiaTensor.z;
  local.applyQuaternion(q);
  return local;
}

// Reference kRot (per axis) for the legacy body-frame formula: ((I^-1 * (r x u)) x r) * u.
function legacyKRot(rb: RigidBody, r: Vector3D, u: Vector3D): number {
  const tauX = r.y * u.z - r.z * u.y;
  const tauY = r.z * u.x - r.x * u.z;
  const tauZ = r.x * u.y - r.y * u.x;
  const dWx = tauX * rb.inverseInertiaTensor.x;
  const dWy = tauY * rb.inverseInertiaTensor.y;
  const dWz = tauZ * rb.inverseInertiaTensor.z;
  const dVx = dWy * r.z - dWz * r.y;
  const dVy = dWz * r.x - dWx * r.z;
  const dVz = dWx * r.y - dWy * r.x;
  return dVx * u.x + dVy * u.y + dVz * u.z;
}

// Reference kRot through the world-rotated inertia.
function worldKRot(rb: RigidBody, rotation: Vector3D, r: Vector3D, u: Vector3D): number {
  const dW = worldAngularResponse(rb, rotation, r, u);
  return (
    (dW.y * r.z - dW.z * r.y) * u.x +
    (dW.z * r.x - dW.x * r.z) * u.y +
    (dW.x * r.y - dW.y * r.x) * u.z
  );
}

describe("RigidBodyMath", () => {
  it("pointVelocity computes v + w x r", () => {
    const rb = new RigidBody(2);
    rb.velocity.set(1, 2, 3);
    rb.angularVelocity.set(4, 5, 6);
    const r = new Vector3D(0.5, -1, 2);
    const out = new Vector3D();
    new RigidBodyMath().pointVelocity(rb, r, out);

    const ex = new Vector3D()
      .copyFrom(rb.velocity)
      .add(new Vector3D().copyFrom(rb.angularVelocity).cross(r));
    expect(out.x).toBeCloseTo(ex.x, 9);
    expect(out.y).toBeCloseTo(ex.y, 9);
    expect(out.z).toBeCloseTo(ex.z, 9);
  });

  it("keeps the exact legacy per-axis angular response for an axis-aligned non-uniform body", () => {
    const rb = new RigidBody(2);
    rb.inverseInertiaTensor.set(1 / 4, 1 / 6, 1 / 8);
    const r = new Vector3D(0.4, -0.7, 0.9);
    const J = new Vector3D(-3, 2, 5);

    rb.angularVelocity.set(0, 0, 0);
    new RigidBodyMath().applyImpulseAtPoint(rb, new Vector3D(0, 0, 0), J, r);

    const legacy = legacyAngularResponse(rb, r, J);
    expect(rb.angularVelocity.x).toBeCloseTo(legacy.x, 9);
    expect(rb.angularVelocity.y).toBeCloseTo(legacy.y, 9);
    expect(rb.angularVelocity.z).toBeCloseTo(legacy.z, 9);

    expect(rb.velocity.x).toBeCloseTo(J.x * rb.inverseMass, 9);
    expect(rb.velocity.y).toBeCloseTo(J.y * rb.inverseMass, 9);
    expect(rb.velocity.z).toBeCloseTo(J.z * rb.inverseMass, 9);
  });

  it("effectiveInvMass matches the legacy per-axis kRot for an axis-aligned body", () => {
    const rb = new RigidBody(2);
    rb.inverseInertiaTensor.set(1 / 4, 1 / 6, 1 / 8);
    const r = new Vector3D(0.4, -0.7, 0.9);
    const u = new Vector3D(0, 1, 0);

    const k = new RigidBodyMath().effectiveInvMass(rb, new Vector3D(0, 0, 0), r, u);
    expect(k).toBeCloseTo(legacyKRot(rb, r, u), 9);
  });

  it("applies the world-rotated inertia for a rotated non-uniform body", () => {
    const rb = new RigidBody(2);
    rb.inverseInertiaTensor.set(1 / 4, 1 / 6, 1 / 8);
    const rotation = new Vector3D(0.4, -0.3, 0.2);
    const r = new Vector3D(0.4, -0.7, 0.9);
    const J = new Vector3D(-3, 2, 5);

    rb.angularVelocity.set(0, 0, 0);
    new RigidBodyMath().applyImpulseAtPoint(rb, rotation, J, r);

    const world = worldAngularResponse(rb, rotation, r, J);
    expect(rb.angularVelocity.x).toBeCloseTo(world.x, 9);
    expect(rb.angularVelocity.y).toBeCloseTo(world.y, 9);
    expect(rb.angularVelocity.z).toBeCloseTo(world.z, 9);

    // The world response must differ from the legacy body-frame response (this is the fix,
    // not just a rename): at least one component deviates clearly.
    const legacy = legacyAngularResponse(rb, r, J);
    const differs =
      Math.abs(rb.angularVelocity.x - legacy.x) > 1e-6 ||
      Math.abs(rb.angularVelocity.y - legacy.y) > 1e-6 ||
      Math.abs(rb.angularVelocity.z - legacy.z) > 1e-6;
    expect(differs).toBe(true);
  });

  it("effectiveInvMass follows the world-rotated inertia for a rotated body", () => {
    const rb = new RigidBody(2);
    rb.inverseInertiaTensor.set(1 / 4, 1 / 6, 1 / 8);
    const rotation = new Vector3D(0.4, -0.3, 0.2);
    const r = new Vector3D(0.4, -0.7, 0.9);
    const u = new Vector3D(0, 1, 0);

    const k = new RigidBodyMath().effectiveInvMass(rb, rotation, r, u);
    expect(k).toBeCloseTo(worldKRot(rb, rotation, r, u), 9);
    expect(k).not.toBeCloseTo(legacyKRot(rb, r, u), 6);
  });
});
