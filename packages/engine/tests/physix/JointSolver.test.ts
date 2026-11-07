import { describe, it, expect, beforeEach } from "vitest";
import { Object3D } from "../../src/core/Object3D.js";
import { RigidBody } from "../../src/physix/RigidBody.js";
import { RigidBodyMath } from "../../src/physix/RigidBodyMath.js";
import { Vector3D, Matrix4 } from "../../src/math/index.js";
import { BallSocketJoint, HingeJoint } from "../../src/physix/joints/index.js";

function makeBody(mass: number, position: Vector3D, rotation?: Vector3D): Object3D {
  const o = new Object3D("body");
  o.position.copyFrom(position);
  if (rotation) o.rotation.copyFrom(rotation);
  o.rigidBody = new RigidBody(mass);
  o.updateMatrixWorld(true);
  return o;
}

/** Explicit world inverse inertia R*diag*R^T from the rotation matrix, applied to `v`. */
function worldInertiaTimes(diag: Vector3D, rotation: Vector3D, v: Vector3D): Vector3D {
  const m = new Matrix4().compose(new Vector3D(0, 0, 0), rotation, new Vector3D(1, 1, 1));
  const cols = [new Vector3D(1, 0, 0), new Vector3D(0, 1, 0), new Vector3D(0, 0, 1)].map((e) =>
    m.transformVector(e, new Vector3D()),
  );
  const d = [diag.x, diag.y, diag.z];
  const out = new Vector3D();
  for (let k = 0; k < 3; k++) {
    const c = cols[k]!;
    const s = d[k]! * c.dot(v);
    out.x += c.x * s;
    out.y += c.y * s;
    out.z += c.z * s;
  }
  return out;
}

describe("Joint solvers", () => {
  beforeEach(() => {
    Object3D.resetNextId();
  });

  it("BallSocket: one sweep re-measures the anchor velocity per axis (Gauss-Seidel, not block-Jacobi)", () => {
    // Long lever arm + small inertia => the three axes are strongly coupled.
    const body = makeBody(1, new Vector3D(0, 0, 0));
    body.rigidBody!.inverseInertiaTensor.set(4, 4, 4);
    body.rigidBody!.velocity.set(0.3, -0.2, 0.5);
    body.rigidBody!.angularVelocity.set(2, -1, 3);
    const anchorLocal = new Vector3D(1, 1, 1);
    const worldAnchor = new Vector3D(1, 1, 1);
    const joint = new BallSocketJoint({
      bodyA: body,
      bodyB: null,
      anchorA: anchorLocal,
      anchorB: worldAnchor,
    });

    const anchorVel = (): Vector3D => {
      const v = new Vector3D();
      new RigidBodyMath().pointVelocity(body.rigidBody!, anchorLocal, v);
      return v;
    };
    const before = anchorVel().length();
    joint.solveVelocity(1 / 60);
    const after = anchorVel().length();
    // A single exact sweep of the coupled system must remove most of the anchor motion; the
    // stale-snapshot variant removes only a fraction (and can overshoot).
    expect(after).toBeLessThan(0.25 * before);
  });

  it("Hinge alignment applies angular impulses through the world-rotated inertia (angular momentum change stays perpendicular to the axis)", () => {
    const rotation = new Vector3D(0, 0, 0.6);
    const inv = new Vector3D(1 / 2, 1 / 8, 1 / 20);
    const bodyB = makeBody(1, new Vector3D(0, 0, 0), rotation);
    bodyB.rigidBody!.inverseInertiaTensor.copyFrom(inv);
    const bodyA = makeBody(0, new Vector3D(0, 0, 0));

    // bodyB's local Y axis in world space is the common hinge axis.
    const axisWorld = bodyB.worldMatrix.transformVector(new Vector3D(0, 1, 0), new Vector3D());
    axisWorld.normalize();
    const hinge = new HingeJoint({
      bodyA,
      bodyB,
      axisA: axisWorld,
      axisB: new Vector3D(0, 1, 0),
    });

    // Spin purely about a world axis perpendicular to the hinge axis.
    const perp = new Vector3D(axisWorld.y, -axisWorld.x, 0).normalize();
    bodyB.rigidBody!.angularVelocity.set(perp.x * 3, perp.y * 3, 2);
    const w0 = new Vector3D().copyFrom(bodyB.rigidBody!.angularVelocity);

    hinge.solveVelocity(1 / 60);

    const dw = new Vector3D().copyFrom(bodyB.rigidBody!.angularVelocity).sub(w0);
    expect(dw.length()).toBeGreaterThan(0.1); // the hinge really acted
    // dL = I_world * dw, with I = inverse of the inverse tensor.
    const invOfInv = new Vector3D(1 / inv.x, 1 / inv.y, 1 / inv.z);
    const dL = worldInertiaTimes(invOfInv, rotation, dw);
    // The hinge may only exchange angular momentum perpendicular to its axis.
    expect(Math.abs(dL.dot(axisWorld))).toBeLessThan(1e-3 * dL.length());
  });

  function limitBody(): { a: Object3D; b: Object3D; hinge: HingeJoint } {
    const a = makeBody(1, new Vector3D(0, 0, 0));
    const b = makeBody(1, new Vector3D(0, 0, 0));
    const hinge = new HingeJoint({
      bodyA: a,
      bodyB: b,
      axisA: new Vector3D(0, 1, 0),
      axisB: new Vector3D(0, 1, 0),
      enableLimit: true,
      minAngle: -0.3,
      maxAngle: 0.3,
    });
    return { a, b, hinge };
  }

  function relativeSpeed(a: Object3D, b: Object3D): number {
    return b.rigidBody!.angularVelocity.y - a.rigidBody!.angularVelocity.y;
  }

  it("Hinge limit: a body past the LOWER limit moving further out is stopped", () => {
    const { a, b, hinge } = limitBody();
    // Rotate B so the relative angle is below minAngle, still moving further negative.
    b.rotation.set(0, -0.5, 0);
    b.updateMatrixWorld(true);
    expect(hinge.getRelativeAngle()).toBeLessThan(-0.3);
    // The angle grows with (omegaB - omegaA): spin in the direction that grows |angle|.
    const dir = Math.sign(hinge.getRelativeAngle());
    a.rigidBody!.angularVelocity.set(0, 0, 0);
    b.rigidBody!.angularVelocity.set(0, 2 * dir, 0);
    hinge.solveVelocity(1 / 60);
    // Relative speed must no longer push further out (it may even point back inside).
    expect(relativeSpeed(a, b) * dir).toBeLessThanOrEqual(1e-6);
  });

  it("Hinge limit: a body past the UPPER limit moving further out is stopped", () => {
    const { a, b, hinge } = limitBody();
    b.rotation.set(0, 0.5, 0);
    b.updateMatrixWorld(true);
    const angle = hinge.getRelativeAngle();
    expect(Math.abs(angle)).toBeGreaterThan(0.3);
    const dir = Math.sign(angle);
    a.rigidBody!.angularVelocity.set(0, 0, 0);
    b.rigidBody!.angularVelocity.set(0, 2 * dir, 0);
    hinge.solveVelocity(1 / 60);
    expect(relativeSpeed(a, b) * dir).toBeLessThanOrEqual(1e-6);
  });
});
