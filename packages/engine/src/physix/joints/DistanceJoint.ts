import type { JointOptions } from "./Joint.js";
import { Joint } from "./Joint.js";
import { MathPool } from "../../math/MathPool.js";

/**
 * Configuration options for DistanceJoint.
 */
export interface DistanceJointOptions extends JointOptions {
  /** Target fixed distance between anchors (defaults to initial distance at creation). */
  distance?: number | undefined;
  /** Minimum allowable distance (for elastic/rope range constraints). */
  minDistance?: number | undefined;
  /** Maximum allowable distance (for elastic/rope range constraints). */
  maxDistance?: number | undefined;
}

/**
 * Distance Joint maintaining a fixed or bounded distance between two anchor points.
 */
export class DistanceJoint extends Joint {
  /** Target equilibrium distance. */
  public distance: number;
  /** Optional minimum distance bound. */
  public minDistance: number;
  /** Optional maximum distance bound. */
  public maxDistance: number;

  constructor(options: DistanceJointOptions) {
    super(options);

    const pA = MathPool.acquireVector();
    const pB = MathPool.acquireVector();
    this.getWorldAnchorA(pA);
    this.getWorldAnchorB(pB);
    const initialDist = pA.distanceTo(pB);
    MathPool.releaseVector(pA);
    MathPool.releaseVector(pB);

    this.distance = options.distance ?? initialDist;
    this.minDistance = options.minDistance ?? this.distance;
    this.maxDistance = options.maxDistance ?? this.distance;
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

    // Constraint error C
    let error: number;
    if (this.minDistance === this.maxDistance) {
      error = currentDist - this.distance;
    } else if (currentDist < this.minDistance) {
      error = currentDist - this.minDistance;
    } else if (currentDist > this.maxDistance) {
      error = currentDist - this.maxDistance;
    } else {
      MathPool.releaseVector(pA);
      MathPool.releaseVector(pB);
      return;
    }

    // Lever arms
    const rAx = pA.x - centerA.x;
    const rAy = pA.y - centerA.y;
    const rAz = pA.z - centerA.z;

    const rBx = pB.x - centerB.x;
    const rBy = pB.y - centerB.y;
    const rBz = pB.z - centerB.z;

    // Velocities at anchor points
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

    const relVAlongNormal = relVx * ux + relVy * uy + relVz * uz;

    // Effective rotational inertia term
    let kRot = 0;
    if (invMassA > 0 && rbA) {
      const tauAx = rAy * uz - rAz * uy;
      const tauAy = rAz * ux - rAx * uz;
      const tauAz = rAx * uy - rAy * ux;

      const dWx = tauAx * rbA.inverseInertiaTensor.x;
      const dWy = tauAy * rbA.inverseInertiaTensor.y;
      const dWz = tauAz * rbA.inverseInertiaTensor.z;

      const dVx = dWy * rAz - dWz * rAy;
      const dVy = dWz * rAx - dWx * rAz;
      const dVz = dWx * rAy - dWy * rAx;

      kRot += dVx * ux + dVy * uy + dVz * uz;
    }

    if (invMassB > 0 && rbB) {
      const tauBx = rBy * uz - rBz * uy;
      const tauBy = rBz * ux - rBx * uz;
      const tauBz = rBx * uy - rBy * ux;

      const dWx = tauBx * rbB.inverseInertiaTensor.x;
      const dWy = tauBy * rbB.inverseInertiaTensor.y;
      const dWz = tauBz * rbB.inverseInertiaTensor.z;

      const dVx = dWy * rBz - dWz * rBy;
      const dVy = dWz * rBx - dWx * rBz;
      const dVz = dWx * rBy - dWy * rBx;

      kRot += dVx * ux + dVy * uy + dVz * uz;
    }

    const effInvMass = totalInvMass + kRot;
    if (effInvMass <= 0) {
      MathPool.releaseVector(pA);
      MathPool.releaseVector(pB);
      return;
    }

    // Baumgarte stabilization factor (beta = 0.2)
    const bias = (0.2 / dt) * error;
    const jMag = (relVAlongNormal + bias) / effInvMass;

    if (Math.abs(jMag) > this.breakForce) {
      this.isBroken = true;
      this.enabled = false;
      MathPool.releaseVector(pA);
      MathPool.releaseVector(pB);
      return;
    }

    if (Math.abs(jMag) > 1e-8) {
      const impulse = MathPool.acquireVector().set(ux * jMag, uy * jMag, uz * jMag);

      if (invMassA > 0 && rbA) {
        rbA.applyImpulseAtPoint(impulse, pA, centerA);
      }
      if (invMassB > 0 && rbB) {
        impulse.scale(-1);
        rbB.applyImpulseAtPoint(impulse, pB, centerB);
      }

      MathPool.releaseVector(impulse);
    }

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

    const dx = pB.x - pA.x;
    const dy = pB.y - pA.y;
    const dz = pB.z - pA.z;
    const currentDist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (currentDist < 1e-6) {
      MathPool.releaseVector(pA);
      MathPool.releaseVector(pB);
      return;
    }

    let error = 0;
    if (this.minDistance === this.maxDistance) {
      error = currentDist - this.distance;
    } else if (currentDist < this.minDistance) {
      error = currentDist - this.minDistance;
    } else if (currentDist > this.maxDistance) {
      error = currentDist - this.maxDistance;
    }

    if (Math.abs(error) > 1e-4) {
      const correction = error / totalInvMass;
      const ux = dx / currentDist;
      const uy = dy / currentDist;
      const uz = dz / currentDist;

      if (invMassA > 0) {
        this.bodyA.position.x += ux * correction * invMassA;
        this.bodyA.position.y += uy * correction * invMassA;
        this.bodyA.position.z += uz * correction * invMassA;
        this.bodyA.updateMatrixWorld();
        this.bodyA.computeBounds();
      }

      if (invMassB > 0 && this.bodyB) {
        this.bodyB.position.x -= ux * correction * invMassB;
        this.bodyB.position.y -= uy * correction * invMassB;
        this.bodyB.position.z -= uz * correction * invMassB;
        this.bodyB.updateMatrixWorld();
        this.bodyB.computeBounds();
      }
    }

    MathPool.releaseVector(pA);
    MathPool.releaseVector(pB);
  }
}
