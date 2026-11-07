import type { JointOptions } from "./Joint.js";
import { Joint } from "./Joint.js";
import { MathPool } from "../../math/MathPool.js";
import { sharedRigidBodyMath } from "../RigidBodyMath.js";

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
  private readonly _math = sharedRigidBodyMath;

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

    const relVAlongNormal = relVx * ux + relVy * uy + relVz * uz;

    // Effective rotational inertia term, through the body's world-rotated inertia
    // (unchanged for axis-aligned bodies).
    const dir = MathPool.acquireVector().set(ux, uy, uz);
    let kRot = 0;
    if (invMassA > 0 && rbA) {
      kRot += this._math.effectiveInvMass(rbA, this.bodyA.rotation, rA, dir);
    }

    if (invMassB > 0 && rbB && this.bodyB) {
      kRot += this._math.effectiveInvMass(rbB, this.bodyB.rotation, rB, dir);
    }

    const effInvMass = totalInvMass + kRot;
    if (effInvMass <= 0) {
      MathPool.releaseVector(dir);
      MathPool.releaseVector(velB);
      MathPool.releaseVector(velA);
      MathPool.releaseVector(rB);
      MathPool.releaseVector(rA);
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
      MathPool.releaseVector(dir);
      MathPool.releaseVector(velB);
      MathPool.releaseVector(velA);
      MathPool.releaseVector(rB);
      MathPool.releaseVector(rA);
      MathPool.releaseVector(pA);
      MathPool.releaseVector(pB);
      return;
    }

    if (Math.abs(jMag) > 1e-8) {
      const impulse = MathPool.acquireVector().set(ux * jMag, uy * jMag, uz * jMag);

      if (invMassA > 0 && rbA) {
        rbA.applyImpulseAtPoint(impulse, pA, centerA, this.bodyA.rotation);
      }
      if (invMassB > 0 && rbB && this.bodyB) {
        impulse.scale(-1);
        rbB.applyImpulseAtPoint(impulse, pB, centerB, this.bodyB.rotation);
      }

      MathPool.releaseVector(impulse);
    }

    MathPool.releaseVector(dir);
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
