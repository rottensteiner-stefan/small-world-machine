import type { JointOptions } from "./Joint.js";
import { Joint } from "./Joint.js";
import { Vector3D } from "../../math/Vector3D.js";
import { MathPool } from "../../math/MathPool.js";
import { sharedRigidBodyMath } from "../RigidBodyMath.js";
import { solveAnchorVelocity } from "./AnchorConstraint.js";
import type { Object3D } from "../../core/Object3D.js";

/**
 * Configuration options for HingeJoint.
 */
export interface HingeJointOptions extends JointOptions {
  /** Local hinge axis on bodyA (automatically normalized; defaults to Y-axis). */
  axisA?: Vector3D | undefined;
  /** Local hinge axis on bodyB (automatically normalized; defaults to Y-axis). */
  axisB?: Vector3D | undefined;
  /** Enables the rotational angle limits. */
  enableLimit?: boolean | undefined;
  /** Minimum allowed rotation angle, in radians. */
  minAngle?: number | undefined;
  /** Maximum allowed rotation angle, in radians. */
  maxAngle?: number | undefined;
  /** Enables the motor. */
  enableMotor?: boolean | undefined;
  /** Target angular velocity of the hinge, in radians per second. */
  motorSpeed?: number | undefined;
  /** Maximum torque the motor may apply, in Newton-meters. */
  maxMotorTorque?: number | undefined;
}

/** Angular-impulse magnitude below which the constraint is considered satisfied (no-op). */
const ANGULAR_EPSILON = 1e-6;
/** Canonical reference axes tried (in order) when measuring the hinge angle. */
const CANDIDATE_AXES: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
/** Baumgarte stabilisation factor for the angular position terms. */
const BAUMGARTE = 0.2;

/**
 * A revolute hinge connecting two bodies at a shared anchor point. The hinge keeps the anchors
 * coincident (3 linear DOFs) and keeps both hinge axes parallel (2 rotational DOFs), leaving
 * a single rotational DOF around the hinge axis. A torque-capped motor can drive that DOF, and
 * optional min/max angle limits bound it.
 *
 * The hinge angle is measured geometrically from the current body frames (never accumulated),
 * so it stays correct even after many full rotations and never drifts. Relative angular speeds
 * in this file always use `angVel = (omegaB - omegaA) dot axis`, i.e. the rate at which
 * `getRelativeAngle()` grows.
 */
export class HingeJoint extends Joint {
  private readonly _math = sharedRigidBodyMath;

  /** Local hinge axis on bodyA. */
  public axisA: Vector3D;
  /** Local hinge axis on bodyB. */
  public axisB: Vector3D;
  /** Whether the rotational angle limits are enforced. */
  public enableLimit: boolean;
  /** Lower rotation limit in radians. */
  public minAngle: number;
  /** Upper rotation limit in radians. */
  public maxAngle: number;
  /** Whether the motor is active. */
  public enableMotor: boolean;
  /** Target rotation speed in rad/s. */
  public motorSpeed: number;
  /** Maximum motor torque in N*m. */
  public maxMotorTorque: number;

  constructor(options: HingeJointOptions) {
    super(options);
    this.axisA = options.axisA?.clone().normalize() ?? new Vector3D(0, 1, 0);
    this.axisB = options.axisB?.clone().normalize() ?? new Vector3D(0, 1, 0);
    this.enableLimit = options.enableLimit ?? false;
    this.minAngle = options.minAngle ?? -Math.PI;
    this.maxAngle = options.maxAngle ?? Math.PI;
    this.enableMotor = options.enableMotor ?? false;
    this.motorSpeed = options.motorSpeed ?? 0;
    this.maxMotorTorque = options.maxMotorTorque ?? Infinity;
  }

  /** World-space hinge axis of bodyA. */
  public getWorldAxisA(out: Vector3D): Vector3D {
    this.bodyA.worldMatrix.transformVector(this.axisA, out);
    out.sub(this.bodyA.position).normalize();
    return out;
  }

  /** World-space hinge axis of bodyB, or the local axisB when bodyB is absent (world-anchored). */
  public getWorldAxisB(out: Vector3D): Vector3D {
    if (this.bodyB) {
      this.bodyB.worldMatrix.transformVector(this.axisB, out);
      out.sub(this.bodyB.position).normalize();
    } else {
      out.copyFrom(this.axisB).normalize();
    }
    return out;
  }

  /** Effective inverse rotational inertia of one body along world axis `u` (world-rotated inertia). */
  private _axialInvInertia(body: Object3D | null, u: Vector3D): number {
    const rb = body?.rigidBody;
    if (!rb || rb.inverseMass <= 0) return 0;
    return this._math.angularInvMass(rb, body!.rotation, u);
  }

  /** Applies an angular impulse `j` along world axis `u`: +j to bodyA, -j to bodyB. */
  private _applyAngularImpulse(u: Vector3D, j: number): void {
    const torque = MathPool.acquireVector();
    try {
      const rbA = this.bodyA.rigidBody;
      if (rbA && rbA.inverseMass > 0) {
        torque.set(u.x * j, u.y * j, u.z * j);
        this._math.applyAngularMomentum(rbA, this.bodyA.rotation, torque);
      }
      const rbB = this.bodyB?.rigidBody;
      if (rbB && rbB.inverseMass > 0) {
        torque.set(-u.x * j, -u.y * j, -u.z * j);
        this._math.applyAngularMomentum(rbB, this.bodyB!.rotation, torque);
      }
    } finally {
      MathPool.releaseVector(torque);
    }
  }

  /**
   * Projects world vector `v` onto the plane perpendicular to `axis` and stores the unit
   * result in `out`. Returns the pre-normalization length, or 0 if the projection vanished
   * (v parallel to axis: the caller should pick a different reference).
   */
  private _projectOntoHingePlane(v: Vector3D, axis: Vector3D, out: Vector3D): number {
    const d = v.dot(axis);
    out.copyFrom(v);
    out.x -= axis.x * d;
    out.y -= axis.y * d;
    out.z -= axis.z * d;
    const len = out.length();
    if (len > 1e-6) {
      out.scale(1 / len);
    }
    return len;
  }

  private _rotatedRef(body: Object3D, local: Vector3D, out: Vector3D): void {
    body.worldMatrix.transformVector(local, out);
    out.sub(body.position);
  }

  /**
   * Measured hinge angle between bodyB and bodyA around the hinge axis, in [-PI, PI].
   * Built fresh from the current body frames each call: no accumulation, so the value is
   * always the actual relative rotation (mod 2-PI) and never drifts.
   *
   * When bodyB is absent the hinge is anchored to a fixed world frame and this returns the
   * rotation of bodyA relative to that frame. Returns NaN if no usable reference could be
   * built (every canonical axis is parallel to the hinge axis).
   */
  public getRelativeAngle(): number {
    const axis = MathPool.acquireVector();
    const axisB = MathPool.acquireVector();
    this.getWorldAxisA(axis);
    this.getWorldAxisB(axisB);

    const work = MathPool.acquireVector();
    const refA = MathPool.acquireVector();
    const refB = MathPool.acquireVector();
    const localCanonical = MathPool.acquireVector();
    const worldCanonical = MathPool.acquireVector();

    let angle = Number.NaN;
    for (let i = 0; i < CANDIDATE_AXES.length; i++) {
      const cand = CANDIDATE_AXES[i]!;
      localCanonical.set(cand[0], cand[1], cand[2]);

      // Rotate the canonical axis into bodyA's world frame; degenerate if parallel to hinge axis.
      this._rotatedRef(this.bodyA, localCanonical, work);
      if (this._projectOntoHingePlane(work, axis, refA) === 0) continue;

      if (this.bodyB) {
        this._rotatedRef(this.bodyB, localCanonical, work);
        if (this._projectOntoHingePlane(work, axisB, refB) === 0) continue;
      } else {
        // Anchor to a fixed world frame: bodyB does not rotate, so a canonical world direction
        // projected on the hinge plane is a fixed reference for bodyA's rotation.
        worldCanonical.set(cand[0], cand[1], cand[2]);
        if (this._projectOntoHingePlane(worldCanonical, axis, refB) === 0) continue;
      }

      const cx = refA.y * refB.z - refA.z * refB.y;
      const cy = refA.z * refB.x - refA.x * refB.z;
      const cz = refA.x * refB.y - refA.y * refB.x;
      const sin = cx * axis.x + cy * axis.y + cz * axis.z;
      const cos = refA.x * refB.x + refA.y * refB.y + refA.z * refB.z;
      angle = Math.atan2(sin, cos);
      break;
    }

    MathPool.releaseVector(axis);
    MathPool.releaseVector(axisB);
    MathPool.releaseVector(work);
    MathPool.releaseVector(refA);
    MathPool.releaseVector(refB);
    MathPool.releaseVector(localCanonical);
    MathPool.releaseVector(worldCanonical);
    return angle;
  }

  /** @inheritdoc */
  public solveVelocity(dt: number): void {
    if (!this.enabled || this.isBroken) return;
    if (this.isFullyAsleep) return;

    const rbA = this.bodyA.rigidBody;
    const rbB = this.bodyB ? this.bodyB.rigidBody : undefined;
    const invMassA = rbA && rbA.inverseMass > 0 ? rbA.inverseMass : 0;
    const invMassB = rbB && rbB.inverseMass > 0 ? rbB.inverseMass : 0;
    const totalInvMass = invMassA + invMassB;
    if (totalInvMass <= 0) return;

    if (solveAnchorVelocity(this, dt) > this.breakForce) {
      this.isBroken = true;
      this.enabled = false;
      return;
    }

    // --- Axis alignment: remove the 2 rotational DOFs so both axes stay parallel. ---
    const axisA = MathPool.acquireVector();
    const axisB = MathPool.acquireVector();
    this.getWorldAxisA(axisA);
    this.getWorldAxisB(axisB);

    const u1 = MathPool.acquireVector();
    const u2 = MathPool.acquireVector();

    // Build two orthonormal perpendicular directions from the hinge axis.
    const ref = MathPool.acquireVector().set(1, 0, 0);
    if (Math.abs(axisA.dot(ref)) > 0.98) ref.set(0, 1, 0);
    if (Math.abs(axisA.dot(ref)) > 0.98) ref.set(0, 0, 1);
    u1.copyFrom(axisA).cross(ref).normalize();
    u2.copyFrom(axisA).cross(u1).normalize();

    for (let ui = 0; ui < 2; ui++) {
      const u = ui === 0 ? u1 : u2;
      const k = this._axialInvInertia(this.bodyA, u) + this._axialInvInertia(this.bodyB, u);
      if (k <= 0) continue;

      const relVel =
        (rbA && invMassA > 0 ? rbA.angularVelocity.dot(u) : 0) -
        (rbB && invMassB > 0 ? rbB.angularVelocity.dot(u) : 0);
      // Position error: misalignment component along u equal to (axisA x axisB) . u.
      const cx = axisA.y * axisB.z - axisA.z * axisB.y;
      const cy = axisA.z * axisB.x - axisA.x * axisB.z;
      const cz = axisA.x * axisB.y - axisA.y * axisB.x;
      const cU = u.x * cx + u.y * cy + u.z * cz;

      const j = -(relVel + (BAUMGARTE / dt) * cU) / k;
      if (Math.abs(j) < ANGULAR_EPSILON) continue;
      this._applyAngularImpulse(u, j);
    }

    MathPool.releaseVector(ref);
    MathPool.releaseVector(u1);
    MathPool.releaseVector(u2);
    MathPool.releaseVector(axisA);
    MathPool.releaseVector(axisB);

    // --- Motor and limit on the single remaining DOF (rotation around the hinge axis). ---
    // angVel = (omegaB - omegaA) . axis is the rate at which getRelativeAngle() grows.
    const axis = MathPool.acquireVector();
    this.getWorldAxisA(axis);
    const k = this._axialInvInertia(this.bodyA, axis) + this._axialInvInertia(this.bodyB, axis);
    if (k > 0) {
      // angVel = (omegaB - omegaA) . axis is the rate at which getRelativeAngle() grows.
      const angVelA = rbA && invMassA > 0 ? rbA.angularVelocity.dot(axis) : 0;
      const angVelB = rbB && invMassB > 0 ? rbB.angularVelocity.dot(axis) : 0;
      // Motor convention: a positive motorSpeed turns bodyA counter-clockwise relative to bodyB
      // around the axis, so the motor targets (omegaA - omegaB) . axis = motorSpeed.
      const motorRel = angVelA - angVelB;

      const limit = this.enableLimit ? this.getRelativeAngle() : Number.NaN;
      const beyond =
        this.enableLimit && Number.isFinite(limit)
          ? limit > this.maxAngle
            ? 1
            : limit < this.minAngle
              ? -1
              : 0
          : 0;

      if (this.enableMotor) {
        // Never fight an active hard-stop: a motor spins the angle toward -motorSpeed,
        // so while past a limit it would only push further out when its target direction
        // points outward. In that case hold off so the limit can actually stop the hinge.
        const drivesIntoUpper = beyond === 1 && this.motorSpeed < 0;
        const drivesIntoLower = beyond === -1 && this.motorSpeed > 0;
        if (!drivesIntoUpper && !drivesIntoLower) {
          // Impulse drives motorRel toward motorSpeed: j = (motorSpeed - motorRel) / k
          // increases motorRel by j*k (see _applyAngularImpulse convention).
          let j = (this.motorSpeed - motorRel) / k;
          const maxImpulse = this.maxMotorTorque * dt;
          if (Number.isFinite(maxImpulse)) {
            j = Math.max(-maxImpulse, Math.min(maxImpulse, j));
          }
          if (Math.abs(j) > ANGULAR_EPSILON) {
            this._applyAngularImpulse(axis, j);
          }
        }
      }

      if (beyond !== 0) {
        // Re-measure: the motor impulse above changed the relative speed.
        const angleVel =
          (rbB && invMassB > 0 ? rbB.angularVelocity.dot(axis) : 0) -
          (rbA && invMassA > 0 ? rbA.angularVelocity.dot(axis) : 0);
        const violation = beyond > 0 ? limit - this.maxAngle : this.minAngle - limit;
        // One-sided pull-back. A positive impulse on bodyA lowers `angleVel`, a negative one
        // raises it. Above the upper limit we need j >= 0 (lower angleVel); below the lower limit
        // we need j <= 0 (raise angleVel). The magnitude drives angleVel to the Baumgarte target.
        let j: number;
        if (beyond > 0) {
          j = Math.max(0, (angleVel + (BAUMGARTE / dt) * violation) / k);
        } else {
          j = Math.min(0, (angleVel - (BAUMGARTE / dt) * violation) / k);
        }
        if (Math.abs(j) > ANGULAR_EPSILON) {
          this._applyAngularImpulse(axis, j);
        }
      }
    }
    MathPool.releaseVector(axis);
  }

  /** @inheritdoc */
  public solvePosition(): void {
    if (!this.enabled || this.isBroken) return;
    if (this.isFullyAsleep) return;

    const rbA = this.bodyA.rigidBody;
    const rbB = this.bodyB ? this.bodyB.rigidBody : undefined;
    const invMassA = rbA && rbA.inverseMass > 0 ? rbA.inverseMass : 0;
    const invMassB = rbB && rbB.inverseMass > 0 ? rbB.inverseMass : 0;
    const totalInvMass = invMassA + invMassB;
    if (totalInvMass <= 0) return;

    const pA = MathPool.acquireVector();
    const pB = MathPool.acquireVector();
    this.getWorldAnchorA(pA);
    this.getWorldAnchorB(pB);

    const errX = pB.x - pA.x;
    const errY = pB.y - pA.y;
    const errZ = pB.z - pA.z;
    const errSq = errX * errX + errY * errY + errZ * errZ;

    if (errSq > 1e-6) {
      const factor = 0.8 / Math.max(totalInvMass, 1e-8);
      const corrX = errX * factor;
      const corrY = errY * factor;
      const corrZ = errZ * factor;

      if (invMassA > 0) {
        this.bodyA.position.x += corrX * invMassA;
        this.bodyA.position.y += corrY * invMassA;
        this.bodyA.position.z += corrZ * invMassA;
        this.bodyA.updateMatrixWorld();
        this.bodyA.computeBounds();
      }
      if (invMassB > 0 && this.bodyB) {
        this.bodyB.position.x -= corrX * invMassB;
        this.bodyB.position.y -= corrY * invMassB;
        this.bodyB.position.z -= corrZ * invMassB;
        this.bodyB.updateMatrixWorld();
        this.bodyB.computeBounds();
      }
    }

    MathPool.releaseVector(pA);
    MathPool.releaseVector(pB);
  }
}
