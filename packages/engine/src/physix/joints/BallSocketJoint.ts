import type { JointOptions } from "./Joint.js";
import { Joint } from "./Joint.js";
import { MathPool } from "../../math/MathPool.js";

/**
 * Configuration options for BallSocketJoint.
 */
export type BallSocketJointOptions = JointOptions;

/**
 * Spherical 3-DOF Point-to-Point constraint locking two anchor points together while permitting free 3D rotation.
 */
export class BallSocketJoint extends Joint {
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

    // Lever arms
    const rAx = pA.x - centerA.x;
    const rAy = pA.y - centerA.y;
    const rAz = pA.z - centerA.z;

    const rBx = pB.x - centerB.x;
    const rBy = pB.y - centerB.y;
    const rBz = pB.z - centerB.z;

    // Point velocities: v + w x r
    const vAx = rbA && invMassA > 0 ? rbA.velocity.x : 0;
    const vAy = rbA && invMassA > 0 ? rbA.velocity.y : 0;
    const vAz = rbA && invMassA > 0 ? rbA.velocity.z : 0;

    const wAx = rbA && invMassA > 0 ? rbA.angularVelocity.x : 0;
    const wAy = rbA && invMassA > 0 ? rbA.angularVelocity.y : 0;
    const wAz = rbA && invMassA > 0 ? rbA.angularVelocity.z : 0;

    const vpAx = vAx + (wAy * rAz - wAz * rAy);
    const vpAy = vAy + (wAz * rAx - wAx * rAz);
    const vpAz = vAz + (wAx * rAy - wAy * rAx);

    const vBx = rbB && invMassB > 0 ? rbB.velocity.x : 0;
    const vBy = rbB && invMassB > 0 ? rbB.velocity.y : 0;
    const vBz = rbB && invMassB > 0 ? rbB.velocity.z : 0;

    const wBx = rbB && invMassB > 0 ? rbB.angularVelocity.x : 0;
    const wBy = rbB && invMassB > 0 ? rbB.angularVelocity.y : 0;
    const wBz = rbB && invMassB > 0 ? rbB.angularVelocity.z : 0;

    const vpBx = vBx + (wBy * rBz - wBz * rBy);
    const vpBy = vBy + (wBz * rBx - wBx * rBz);
    const vpBz = vBz + (wBx * rBy - wBy * rBx);

    const relVx = vpBx - vpAx;
    const relVy = vpBy - vpAy;
    const relVz = vpBz - vpAz;

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

    let totalImpulseSq = 0;
    const impulse = MathPool.acquireVector();

    for (let i = 0; i < 3; i++) {
      const axis = axes[i]!;
      let kRot = 0;

      if (invMassA > 0 && rbA) {
        const tauAx = rAy * axis.uz - rAz * axis.uy;
        const tauAy = rAz * axis.ux - rAx * axis.uz;
        const tauAz = rAx * axis.uy - rAy * axis.ux;

        const dWx = tauAx * rbA.inverseInertiaTensor.x;
        const dWy = tauAy * rbA.inverseInertiaTensor.y;
        const dWz = tauAz * rbA.inverseInertiaTensor.z;

        const dVx = dWy * rAz - dWz * rAy;
        const dVy = dWz * rAx - dWx * rAz;
        const dVz = dWx * rAy - dWy * rAx;

        kRot += dVx * axis.ux + dVy * axis.uy + dVz * axis.uz;
      }

      if (invMassB > 0 && rbB) {
        const tauBx = rBy * axis.uz - rBz * axis.uy;
        const tauBy = rBz * axis.ux - rBx * axis.uz;
        const tauBz = rBx * axis.uy - rBy * axis.ux;

        const dWx = tauBx * rbB.inverseInertiaTensor.x;
        const dWy = tauBy * rbB.inverseInertiaTensor.y;
        const dWz = tauBz * rbB.inverseInertiaTensor.z;

        const dVx = dWy * rBz - dWz * rBy;
        const dVy = dWz * rBx - dWx * rBz;
        const dVz = dWx * rBy - dWy * rBx;

        kRot += dVx * axis.ux + dVy * axis.uy + dVz * axis.uz;
      }

      const effInvMass = totalInvMass + kRot;
      const j = effInvMass > 0 ? (axis.relV + betaDt * axis.err) / effInvMass : 0;
      if (effInvMass > 0 && Math.abs(j) > 1e-8) {
        totalImpulseSq += j * j;

        impulse.set(axis.ux * j, axis.uy * j, axis.uz * j);
        if (invMassA > 0 && rbA) {
          rbA.applyImpulseAtPoint(impulse, pA, centerA);
        }
        if (invMassB > 0 && rbB) {
          impulse.scale(-1);
          rbB.applyImpulseAtPoint(impulse, pB, centerB);
        }
      }
    }

    if (Math.sqrt(totalImpulseSq) > this.breakForce) {
      this.isBroken = true;
      this.enabled = false;
    }

    MathPool.releaseVector(impulse);
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
