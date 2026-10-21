import { describe, it, expect } from "vitest";
import { RigidBody } from "../../src/physix/RigidBody.js";
import { RigidBodyMath } from "../../src/physix/RigidBodyMath.js";
import { Vector3D, Matrix4 } from "../../src/math/index.js";

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

/**
 * Explicit world inverse inertia `R * diag(I^-1) * R^T` as a row-major 3x3, built from the
 * rotation *matrix* (Matrix4.compose, the path the renderer uses) instead of the quaternion path
 * under test.
 */
function worldInvInertia(rb: RigidBody, rotation: Vector3D): number[][] {
  const m = new Matrix4().compose(new Vector3D(0, 0, 0), rotation, new Vector3D(1, 1, 1));
  const cols = [new Vector3D(1, 0, 0), new Vector3D(0, 1, 0), new Vector3D(0, 0, 1)].map((e) =>
    m.transformVector(e, new Vector3D()),
  );
  const d = [rb.inverseInertiaTensor.x, rb.inverseInertiaTensor.y, rb.inverseInertiaTensor.z];
  const comp = (v: Vector3D, i: number): number => (i === 0 ? v.x : i === 1 ? v.y : v.z);
  const out: number[][] = [];
  for (let i = 0; i < 3; i++) {
    out.push([]);
    for (let j = 0; j < 3; j++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += comp(cols[k]!, i) * d[k]! * comp(cols[k]!, j);
      out[i]!.push(sum);
    }
  }
  return out;
}

function mulMat(m: number[][], v: Vector3D): Vector3D {
  return new Vector3D(
    m[0]![0]! * v.x + m[0]![1]! * v.y + m[0]![2]! * v.z,
    m[1]![0]! * v.x + m[1]![1]! * v.y + m[1]![2]! * v.z,
    m[2]![0]! * v.x + m[2]![1]! * v.y + m[2]![2]! * v.z,
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

  const ROTATIONS = [
    new Vector3D(0.4, -0.3, 0.2),
    new Vector3D(1.2, 0.7, -2.1),
    new Vector3D(0, 0, Math.PI / 2),
    new Vector3D(-0.9, 1.4, 0.05),
  ];

  it("applyImpulseAtPoint matches an explicit R*I^-1*R^T 3x3 for rotated bodies", () => {
    const r = new Vector3D(0.4, -0.7, 0.9);
    const J = new Vector3D(-3, 2, 5);
    const tau = new Vector3D().copyFrom(r).cross(J);
    for (const rotation of ROTATIONS) {
      const rb = new RigidBody(2);
      rb.inverseInertiaTensor.set(1 / 4, 1 / 6, 1 / 8);
      new RigidBodyMath().applyImpulseAtPoint(rb, rotation, J, r);
      const expected = mulMat(worldInvInertia(rb, rotation), tau);
      expect(rb.angularVelocity.x).toBeCloseTo(expected.x, 6);
      expect(rb.angularVelocity.y).toBeCloseTo(expected.y, 6);
      expect(rb.angularVelocity.z).toBeCloseTo(expected.z, 6);
    }
  });

  it("conserves angular momentum: I_world * dw equals r x J regardless of rotation", () => {
    const r = new Vector3D(0.4, -0.7, 0.9);
    const J = new Vector3D(-3, 2, 5);
    const tau = new Vector3D().copyFrom(r).cross(J);
    for (const rotation of ROTATIONS) {
      const rb = new RigidBody(2);
      rb.inverseInertiaTensor.set(1 / 4, 1 / 6, 1 / 8);
      new RigidBodyMath().applyImpulseAtPoint(rb, rotation, J, r);
      // Invert the explicit world inertia by solving I_world * dw = L numerically: apply the
      // *inverse* tensor to dw via I = R diag(1/invI) R^T.
      const invert = new RigidBody(2);
      invert.inverseInertiaTensor.set(4, 6, 8); // 1 / (1/4, 1/6, 1/8)
      const L = mulMat(worldInvInertia(invert, rotation), rb.angularVelocity);
      expect(L.x).toBeCloseTo(tau.x, 6);
      expect(L.y).toBeCloseTo(tau.y, 6);
      expect(L.z).toBeCloseTo(tau.z, 6);
    }
  });

  it("effectiveInvMass equals the explicit quadratic form", () => {
    const rb = new RigidBody(2);
    rb.inverseInertiaTensor.set(1 / 4, 1 / 6, 1 / 8);
    const math = new RigidBodyMath();
    const r = new Vector3D(0.4, -0.7, 0.9);
    const u = new Vector3D(0, 1, 0);
    for (const rotation of ROTATIONS) {
      const W = worldInvInertia(rb, rotation);
      // k = (r x u)^T W (r x u)
      const c = new Vector3D().copyFrom(r).cross(u);
      expect(math.effectiveInvMass(rb, rotation, r, u)).toBeCloseTo(c.dot(mulMat(W, c)), 6);
      // The effective mass must be positive for a physical body.
      expect(math.effectiveInvMass(rb, rotation, r, u)).toBeGreaterThan(0);
      // Pure angular axis form: u^T W u, and the applied angular momentum agrees with it.
      expect(math.angularInvMass(rb, rotation, u)).toBeCloseTo(u.dot(mulMat(W, u)), 6);
    }
  });

  it("applyAngularMomentum gives dw = R*I^-1*R^T*L and ignores static bodies", () => {
    const L = new Vector3D(1, -2, 0.5);
    const rb = new RigidBody(2);
    rb.inverseInertiaTensor.set(1 / 4, 1 / 6, 1 / 8);
    const rotation = ROTATIONS[1]!;
    new RigidBodyMath().applyAngularMomentum(rb, rotation, L);
    const expected = mulMat(worldInvInertia(rb, rotation), L);
    expect(rb.angularVelocity.x).toBeCloseTo(expected.x, 6);
    expect(rb.angularVelocity.y).toBeCloseTo(expected.y, 6);
    expect(rb.angularVelocity.z).toBeCloseTo(expected.z, 6);

    const stat = new RigidBody(0);
    new RigidBodyMath().applyAngularMomentum(stat, rotation, L);
    expect(stat.angularVelocity.length()).toBe(0);
  });
});
