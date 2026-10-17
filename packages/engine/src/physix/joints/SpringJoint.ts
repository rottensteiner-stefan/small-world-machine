import type { JointOptions } from "./Joint.js";
import { Joint } from "./Joint.js";
import { MathPool } from "../../math/MathPool.js";

/**
 * Configuration options for SpringJoint.
 */
export interface SpringJointOptions extends JointOptions {
  /** Spring stiffness coefficient k (N/m). Defaults to 50. */
  stiffness?: number | undefined;
  /** Damping coefficient c (N*s/m) suppressing oscillation. Defaults to 2. */
  damping?: number | undefined;
  /** Equilibrium rest length of the spring (defaults to initial distance at creation). */
  restLength?: number | undefined;
}

/**
 * Damped elastic spring constraint connecting two bodies or a body and a static anchor.
 */
export class SpringJoint extends Joint {
  /** Spring stiffness coefficient k (N/m). */
  public stiffness: number;
  /** Damping coefficient c (N*s/m). */
  public damping: number;
  /** Equilibrium rest length L0. */
  public restLength: number;

  constructor(options: SpringJointOptions) {
    super(options);

    const pA = MathPool.acquireVector();
    const pB = MathPool.acquireVector();
    this.getWorldAnchorA(pA);
    this.getWorldAnchorB(pB);
    const initialDist = pA.distanceTo(pB);
    MathPool.releaseVector(pA);
    MathPool.releaseVector(pB);

    this.stiffness = options.stiffness ?? 50.0;
    this.damping = options.damping ?? 2.0;
    this.restLength = options.restLength ?? initialDist;
  }

  /** @inheritdoc */
  public override applyForces(_dt: number): void {
    if (!this.enabled || this.isBroken) return;
    if (this.isFullyAsleep) return;

    const rbA = this.bodyA.rigidBody;
    const rbB = this.bodyB?.rigidBody;

    const invMassA = rbA && rbA.inverseMass > 0 ? rbA.inverseMass : 0;
    const invMassB = rbB && rbB.inverseMass > 0 ? rbB.inverseMass : 0;
    if (invMassA <= 0 && invMassB <= 0) return;

    const pA = MathPool.acquireVector();
    const pB = MathPool.acquireVector();
    this.getWorldAnchorA(pA);
    this.getWorldAnchorB(pB);

    const centerA = this.bodyA.position;
    const centerB = this.bodyB ? this.bodyB.position : pB;

    const dx = pB.x - pA.x;
    const dy = pB.y - pA.y;
    const dz = pB.z - pA.z;
    const currentDist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (currentDist < 1e-6) {
      MathPool.releaseVector(pA);
      MathPool.releaseVector(pB);
      return;
    }

    const ux = dx / currentDist;
    const uy = dy / currentDist;
    const uz = dz / currentDist;

    // Displacement from equilibrium rest length
    const deltaX = currentDist - this.restLength;

    // Lever arms
    const rAx = pA.x - centerA.x;
    const rAy = pA.y - centerA.y;
    const rAz = pA.z - centerA.z;

    const rBx = pB.x - centerB.x;
    const rBy = pB.y - centerB.y;
    const rBz = pB.z - centerB.z;

    // Anchor velocities: v + w x r
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

    const vRelNormal = relVx * ux + relVy * uy + relVz * uz;

    // Hooke's Law + viscous damping along spring axis
    const forceMag = this.stiffness * deltaX + this.damping * vRelNormal;

    if (Math.abs(forceMag) > this.breakForce) {
      this.isBroken = true;
      this.enabled = false;
      MathPool.releaseVector(pA);
      MathPool.releaseVector(pB);
      return;
    }

    if (Math.abs(forceMag) > 1e-8) {
      const force = MathPool.acquireVector().set(ux * forceMag, uy * forceMag, uz * forceMag);

      if (invMassA > 0 && rbA) {
        rbA.applyForceAtPoint(force, pA, centerA);
      }

      if (invMassB > 0 && rbB) {
        force.scale(-1);
        rbB.applyForceAtPoint(force, pB, centerB);
      }

      MathPool.releaseVector(force);
    }

    MathPool.releaseVector(pA);
    MathPool.releaseVector(pB);
  }

  /** @inheritdoc */
  public solveVelocity(_dt: number): void {
    // Spring forces are applied continuously during the force accumulation pass
  }

  /** @inheritdoc */
  public solvePosition(): void {
    // Elastic springs allow positional deformation by design
  }
}
