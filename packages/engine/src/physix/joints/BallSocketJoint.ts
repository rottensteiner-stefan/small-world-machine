import type { JointOptions } from "./Joint.js";
import { Joint } from "./Joint.js";
import { MathPool } from "../../math/MathPool.js";
import { RigidBodyMath } from "../RigidBodyMath.js";

/**
 * Configuration options for BallSocketJoint.
 */
export type BallSocketJointOptions = JointOptions;

/**
 * Spherical 3-DOF Point-to-Point constraint locking two anchor points together while permitting free 3D rotation.
 */
export class BallSocketJoint extends Joint {
  private readonly _math = new RigidBodyMath();

  private static readonly _scratchAxes = [
    { ux: 1, uy: 0, uz: 0, relV: 0, err: 0 },
    { ux: 0, uy: 1, uz: 0, relV: 0, err: 0 },
    { ux: 0, uy: 0, uz: 1, relV: 0, err: 0 },
  ];

  constructor(options: BallSocketJointOptions) {
    super(options);
  }

  /** @inheritdoc */
  public solveVelocity(dt: number): void {
    if (!this.enabled || this.isBroken) return;
    if (this.isFullyAsleep) return;

    const rbA = this.bodyA.rigidBody;
    const rbB = this.bodyB?.rigidBody;

    const invMassA = rbA && rbA.inverseMass > 0 ? rbA.inverseMass : 0;
    const invMassB = rbB && rbB.inverseMass > 0 ? rbB.inverseMass : 0;
    const totalInvMass = invMassA + invMassB;
    if (totalInvMass <= 0) return;

    const pA = MathPool.acquireVector();
    const pB = MathPool.acquireVector();
    this.getWorldAnchorA(pA);
    this.getWorldAnchorB(pB);

    const centerA = this.bodyA.position;
    const centerB = this.bodyB ? this.bodyB.position : pB;

    const rA = MathPool.acquireVector();
    const rB = MathPool.acquireVector();
    rA.set(pA.x - centerA.x, pA.y - centerA.y, pA.z - centerA.z);
    rB.set(pB.x - centerB.x, pB.y - centerB.y, pB.z - centerB.z);

    // Point velocities at the anchors: v + w x r (world-space kinematics)
    const velA = MathPool.acquireVector();
    const velB = MathPool.acquireVector();
    if (rbA && invMassA > 0) {
      this._math.pointVelocity(rbA, rA, velA);
    } else {
      velA.set(0, 0, 0);
    }
    if (rbB && invMassB > 0) {
      this._math.pointVelocity(rbB, rB, velB);
    } else {
      velB.set(0, 0, 0);
    }

    const relVx = velB.x - velA.x;
    const relVy = velB.y - velA.y;
    const relVz = velB.z - velA.z;

    // Positional error for Baumgarte stabilization
    const errX = pB.x - pA.x;
    const errY = pB.y - pA.y;
    const errZ = pB.z - pA.z;
    const betaDt = 0.2 / dt;

    // Solve for each coordinate axis without allocations
    const axes = BallSocketJoint._scratchAxes;
    axes[0]!.relV = relVx;
    axes[0]!.err = errX;
    axes[1]!.relV = relVy;
    axes[1]!.err = errY;
    axes[2]!.relV = relVz;
    axes[2]!.err = errZ;

    const dir = MathPool.acquireVector();
    let totalImpulseSq = 0;
    const impulse = MathPool.acquireVector();

    for (let i = 0; i < 3; i++) {
      const axis = axes[i]!;
      dir.set(axis.ux, axis.uy, axis.uz);

      // Rotational inverse mass through the body's world-rotated inertia (unchanged for axis-aligned bodies).
      let kRot = 0;
      if (invMassA > 0 && rbA) {
        kRot += this._math.effectiveInvMass(rbA, this.bodyA.rotation, rA, dir);
      }

      if (invMassB > 0 && rbB && this.bodyB) {
        kRot += this._math.effectiveInvMass(rbB, this.bodyB.rotation, rB, dir);
      }

      const effInvMass = totalInvMass + kRot;
      const j = effInvMass > 0 ? (axis.relV + betaDt * axis.err) / effInvMass : 0;
      if (effInvMass > 0 && Math.abs(j) > 1e-8) {
        totalImpulseSq += j * j;

        impulse.set(dir.x * j, dir.y * j, dir.z * j);
        if (invMassA > 0 && rbA) {
          rbA.applyImpulseAtPoint(impulse, pA, centerA, this.bodyA.rotation);
        }
        if (invMassB > 0 && rbB && this.bodyB) {
          impulse.scale(-1);
          rbB.applyImpulseAtPoint(impulse, pB, centerB, this.bodyB.rotation);
        }
      }
    }

    if (Math.sqrt(totalImpulseSq) > this.breakForce) {
      this.isBroken = true;
      this.enabled = false;
    }

    MathPool.releaseVector(dir);
    MathPool.releaseVector(impulse);
    MathPool.releaseVector(velB);
    MathPool.releaseVector(velA);
    MathPool.releaseVector(rB);
    MathPool.releaseVector(rA);
    MathPool.releaseVector(pA);
    MathPool.releaseVector(pB);
  }

  /** @inheritdoc */
  public solvePosition(): void {
    if (!this.enabled || this.isBroken) return;
    if (this.isFullyAsleep) return;

    const rbA = this.bodyA.rigidBody;
    const rbB = this.bodyB?.rigidBody;

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
      const factor = 0.8 / totalInvMass;
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
