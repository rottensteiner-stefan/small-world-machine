import type { JointOptions } from "./Joint.js";
import { Joint } from "./Joint.js";
import { MathPool } from "../../math/MathPool.js";
import { solveAnchorVelocity } from "./AnchorConstraint.js";

/**
 * Configuration options for BallSocketJoint.
 */
export type BallSocketJointOptions = JointOptions;

/**
 * Spherical 3-DOF Point-to-Point constraint locking two anchor points together while permitting free 3D rotation.
 */
export class BallSocketJoint extends Joint {
  constructor(options: BallSocketJointOptions) {
    super(options);
  }

  /** @inheritdoc */
  public solveVelocity(dt: number): void {
    if (!this.enabled || this.isBroken) return;
    if (this.isFullyAsleep) return;
    if (solveAnchorVelocity(this, dt) > this.breakForce) {
      this.isBroken = true;
      this.enabled = false;
    }
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
