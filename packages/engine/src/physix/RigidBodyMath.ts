import { Vector3D, Quaternion } from "../math/index.js";
import type { RigidBody } from "./RigidBody.js";

/**
 * World-space impulse and single-body constraint math for rigid bodies.
 *
 * `RigidBody.inverseInertiaTensor` holds the *principal* (local-frame, diagonal) inverse
 * moments of inertia. Applying them directly to a world torque like `dω = τ * invI` is only
 * correct for axis-aligned bodies and isotropic ones (spheres): for a rotated uniform box or
 * cylinder it returns a wrong angular response in world space. This module applies the inertia
 * in the body frame and rotates the result back:
 *
 *   dω = R · I⁻¹ · Rᵀ · (r × J)
 *
 * For a body whose world rotation is zero — or whose inverse inertia is isotropic — `R` is the
 * identity and the computation degenerates to the exact legacy per-axis scaling, so the solver
 * behaviour for non-rotated and spherical bodies is numerically unchanged.
 *
 * An instance owns small scratch buffers (not re-entrant, stateless between calls): the contact
 * solver shares one, joints and bodies may share one too.
 *
 * Orientation assumption (M6): `rotation` is the body's Euler rotation as integrated by
 * `EulerIntegrator` (which treats `Object3D.rotation`/`position` as the simulated state, i.e. the
 * body is parented to an identity frame, like every scene root object). Dynamic bodies nested
 * under a rotated parent are unsupported; `PhysicsSystem` warns once about them.
 */
export class RigidBodyMath {
  private readonly _q = new Quaternion(0, 0, 0, 1);
  private readonly _qc = new Quaternion(0, 0, 0, 1);
  private readonly _l = new Vector3D();
  private readonly _tau = new Vector3D();
  private readonly _dW = new Vector3D();
  private readonly _dV = new Vector3D();

  /**
   * Contact-point velocity of a body at world lever arm `r`: `v + ω × r`.
   * Pure kinematics — independent of orientation and inertia.
   */
  public pointVelocity(rb: RigidBody, r: Vector3D, out: Vector3D): void {
    out.set(
      rb.velocity.x + (rb.angularVelocity.y * r.z - rb.angularVelocity.z * r.y),
      rb.velocity.y + (rb.angularVelocity.z * r.x - rb.angularVelocity.x * r.z),
      rb.velocity.z + (rb.angularVelocity.x * r.y - rb.angularVelocity.y * r.x),
    );
  }

  /**
   * Rotational effective inverse mass of one body about world direction `dir` at lever arm `r`:
   *
   *   k = (R · I⁻¹ · Rᵀ · (r × dir)) × r) · dir
   *
   * Callers add the linear `1/m` term themselves and sum this over both bodies.
   * @param rb The body; only its inverse inertia is read.
   * @param rotation The body's world rotation (Euler radians, e.g. `obj.rotation`).
   * @param r World-space lever arm from the body's center of mass to the contact/anchor point.
   * @param dir World-space constraint or contact direction (unit).
   */
  public effectiveInvMass(rb: RigidBody, rotation: Vector3D, r: Vector3D, dir: Vector3D): number {
    this._tau.set(r.y * dir.z - r.z * dir.y, r.z * dir.x - r.x * dir.z, r.x * dir.y - r.y * dir.x);
    this._applyInvInertiaWorld(rb, rotation, this._tau, this._dW);
    // dV = dW × r  (linear velocity delta at the contact point caused by the angular impulse)
    this._dV.set(
      this._dW.y * r.z - this._dW.z * r.y,
      this._dW.z * r.x - this._dW.x * r.z,
      this._dW.x * r.y - this._dW.y * r.x,
    );
    return this._dV.x * dir.x + this._dV.y * dir.y + this._dV.z * dir.z;
  }

  /**
   * Pure angular effective inverse mass about world axis `u` (unit): `uᵀ · R · I⁻¹ · Rᵀ · u`.
   * Used by constraints that act on a rotation axis only (hinge alignment, motor, limits).
   */
  public angularInvMass(rb: RigidBody, rotation: Vector3D, u: Vector3D): number {
    this._applyInvInertiaWorld(rb, rotation, u, this._dW);
    return this._dW.x * u.x + this._dW.y * u.y + this._dW.z * u.z;
  }

  /**
   * Adds a pure angular impulse `L` (world vector, no linear part): `ω += R · I⁻¹ · Rᵀ · L`.
   * Skipped for static bodies.
   */
  public applyAngularMomentum(rb: RigidBody, rotation: Vector3D, angular: Vector3D): void {
    if (rb.inverseMass <= 0) return;
    this._applyInvInertiaWorld(rb, rotation, angular, this._dW);
    rb.angularVelocity.x += this._dW.x;
    rb.angularVelocity.y += this._dW.y;
    rb.angularVelocity.z += this._dW.z;
  }

  /**
   * Applies an instantaneous impulse `J` at a world lever arm `r`, altering the body's linear
   * and (with world-rotated inertia) angular velocity:
   *
   *   dv = J / m        dω = R · I⁻¹ · Rᵀ · (r × J)
   *
   * @param rb The body to modify (skipped when static, `inverseMass <= 0`).
   * @param rotation The body's world rotation (Euler radians, e.g. `obj.rotation`).
   * @param impulse The world-space impulse vector.
   * @param r World-space lever arm from the body's center of mass to the application point.
   */
  public applyImpulseAtPoint(
    rb: RigidBody,
    rotation: Vector3D,
    impulse: Vector3D,
    r: Vector3D,
  ): void {
    if (rb.inverseMass <= 0) return;
    if (rb.isSleeping) {
      rb.wakeUp();
    }
    rb.velocity.x += impulse.x * rb.inverseMass;
    rb.velocity.y += impulse.y * rb.inverseMass;
    rb.velocity.z += impulse.z * rb.inverseMass;
    this.applyAngularImpulse(rb, rotation, r, impulse);
  }

  /**
   * Applies the rotational part of an impulse at a lever arm: `dω = R · I⁻¹ · Rᵀ · (r × J)`.
   * For spheres and non-rotated bodies this is the plain per-axis scaling (unchanged).
   */
  public applyAngularImpulse(
    rb: RigidBody,
    rotation: Vector3D,
    r: Vector3D,
    impulse: Vector3D,
  ): void {
    this._tau.set(
      r.y * impulse.z - r.z * impulse.y,
      r.z * impulse.x - r.x * impulse.z,
      r.x * impulse.y - r.y * impulse.x,
    );
    this._applyInvInertiaWorld(rb, rotation, this._tau, this._dW);
    rb.angularVelocity.x += this._dW.x;
    rb.angularVelocity.y += this._dW.y;
    rb.angularVelocity.z += this._dW.z;
  }

  /**
   * `out = R · I⁻¹ · Rᵀ · x` for a world vector `x`. With a zero world rotation (R = I) or an
   * isotropic inverse inertia this reduces to the legacy per-axis scaling, keeping those paths
   * bit-identical to the original solver.
   */
  private _applyInvInertiaWorld(
    rb: RigidBody,
    rotation: Vector3D,
    x: Vector3D,
    out: Vector3D,
  ): void {
    const ix = rb.inverseInertiaTensor.x;
    const iy = rb.inverseInertiaTensor.y;
    const iz = rb.inverseInertiaTensor.z;
    if ((rotation.x === 0 && rotation.y === 0 && rotation.z === 0) || (ix === iy && iy === iz)) {
      out.set(x.x * ix, x.y * iy, x.z * iz);
      return;
    }
    this._q.setFromEuler(rotation);
    // Unit quaternion -> conjugate is the inverse: rotate the world vector into the body frame.
    this._qc.set(-this._q.x, -this._q.y, -this._q.z, this._q.w);
    this._l.copyFrom(x).applyQuaternion(this._qc);
    this._l.x *= ix;
    this._l.y *= iy;
    this._l.z *= iz;
    out.copyFrom(this._l).applyQuaternion(this._q);
  }
}

/**
 * Process-wide scratch instance. `RigidBodyMath` holds no state between calls (every method fully
 * overwrites its scratch before reading it), so bodies, joints and the contact solver share this
 * one instead of owning ~1 KB each. This is scratch memory, not engine state: multiple engine
 * instances on one page remain independent.
 */
export const sharedRigidBodyMath = new RigidBodyMath();
