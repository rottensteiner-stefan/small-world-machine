import type { Joint } from "./Joint.js";
import { MathPool } from "../../math/MathPool.js";
import { sharedRigidBodyMath } from "../RigidBodyMath.js";

/**
 * Solves the 3-DOF point-to-point anchor constraint shared by {@link BallSocketJoint} and
 * {@link HingeJoint} with one Gauss-Seidel sweep over the world axes.
 *
 * The anchor velocity is re-measured before every axis: an impulse along X changes the anchor
 * velocity along Y/Z through the lever arm, so using a single snapshot (block-Jacobi) overshoots
 * for long levers relative to the inertia.
 *
 * @returns The norm of the applied impulse (for break-force checks), or 0 when nothing was solved.
 */
export function solveAnchorVelocity(joint: Joint, dt: number): number {
  const math = sharedRigidBodyMath;
  const rbA = joint.bodyA.rigidBody;
  const rbB = joint.bodyB?.rigidBody;
  const invMassA = rbA && rbA.inverseMass > 0 ? rbA.inverseMass : 0;
  const invMassB = rbB && rbB.inverseMass > 0 ? rbB.inverseMass : 0;
  const totalInvMass = invMassA + invMassB;
  if (totalInvMass <= 0) return 0;

  const pA = MathPool.acquireVector();
  const pB = MathPool.acquireVector();
  const rA = MathPool.acquireVector();
  const rB = MathPool.acquireVector();
  const velA = MathPool.acquireVector();
  const velB = MathPool.acquireVector();
  const dir = MathPool.acquireVector();
  const impulse = MathPool.acquireVector();
  try {
    joint.getWorldAnchorA(pA);
    joint.getWorldAnchorB(pB);
    const centerA = joint.bodyA.position;
    const centerB = joint.bodyB ? joint.bodyB.position : pB;
    rA.set(pA.x - centerA.x, pA.y - centerA.y, pA.z - centerA.z);
    rB.set(pB.x - centerB.x, pB.y - centerB.y, pB.z - centerB.z);

    const betaDt = 0.2 / dt;
    let totalImpulseSq = 0;

    for (let i = 0; i < 3; i++) {
      dir.set(i === 0 ? 1 : 0, i === 1 ? 1 : 0, i === 2 ? 1 : 0);

      if (rbA && invMassA > 0) math.pointVelocity(rbA, rA, velA);
      else velA.set(0, 0, 0);
      if (rbB && invMassB > 0) math.pointVelocity(rbB, rB, velB);
      else velB.set(0, 0, 0);

      const relV = i === 0 ? velB.x - velA.x : i === 1 ? velB.y - velA.y : velB.z - velA.z;
      const err = i === 0 ? pB.x - pA.x : i === 1 ? pB.y - pA.y : pB.z - pA.z;

      let kRot = 0;
      if (invMassA > 0 && rbA) {
        kRot += math.effectiveInvMass(rbA, joint.bodyA.rotation, rA, dir);
      }
      if (invMassB > 0 && rbB && joint.bodyB) {
        kRot += math.effectiveInvMass(rbB, joint.bodyB.rotation, rB, dir);
      }

      const effInvMass = totalInvMass + kRot;
      if (effInvMass <= 0) continue;
      const j = (relV + betaDt * err) / effInvMass;
      if (Math.abs(j) < 1e-8) continue;
      totalImpulseSq += j * j;

      impulse.set(dir.x * j, dir.y * j, dir.z * j);
      if (invMassA > 0 && rbA) {
        rbA.applyImpulseAtPoint(impulse, pA, centerA, joint.bodyA.rotation);
      }
      if (invMassB > 0 && rbB && joint.bodyB) {
        impulse.scale(-1);
        rbB.applyImpulseAtPoint(impulse, pB, centerB, joint.bodyB.rotation);
      }
    }
    return Math.sqrt(totalImpulseSq);
  } finally {
    MathPool.releaseVector(impulse);
    MathPool.releaseVector(dir);
    MathPool.releaseVector(velB);
    MathPool.releaseVector(velA);
    MathPool.releaseVector(rB);
    MathPool.releaseVector(rA);
    MathPool.releaseVector(pB);
    MathPool.releaseVector(pA);
  }
}
