import { Object3D } from "../../core/Object3D.js";
import { Vector3D, MathPool } from "../../math/index.js";
import { Collision } from "../Collision.js";
import { EventDispatcherImpl } from "../../core/events/EventDispatcherImpl.js";
import { Collidable } from "../../interfaces/index.js";
import { BoundingType } from "../../enums/index.js";
import { BoundingBox } from "../BoundingBox.js";
import { BoundingSphere } from "../BoundingSphere.js";
import { StaticCollider } from "../StaticCollider.js";
import { Joint } from "../joints/Joint.js";

/** A resolved contact pair between two world colliders. */
export interface ContactPair {
  first: Collidable;
  second: Collidable;
  idA: number;
  idB: number;
  colliding: boolean;
  normal: Vector3D;
  depth: number;
}

/** A persistent pair state used to derive enter/stay/exit events across frames. */
export interface ContactPairState {
  objectA: Collidable;
  objectB: Collidable;
  normal: Vector3D;
  depth: number;
  impulse: number;
}

/** Per-step dependencies injected by the owner system (keeps the public API surface there). */
export interface ContactSolverContext {
  events: EventDispatcherImpl;
  fixedTimeStep: number;
  gravityLength: number;
  solverIterations: number;
  /** Applies a positional correction to a dynamic body and refreshes its transform/bounds. */
  syncTransform: (obj: Object3D, posCorr: Vector3D) => void;
}

/** 64-bit pair key combining two ids using BigInt to prevent precision loss above 2^21. */
export function pairKey(idA: number, idB: number): bigint {
  const a = idA < idB ? idA : idB;
  const b = idA < idB ? idB : idA;
  return (BigInt(a) << 32n) | BigInt(b);
}

/**
 * Iterative contact solver: penetration separation, normal/friction impulse resolution with
 * angular response, trigger/collision bookkeeping and resting-contact stabilization.
 *
 * Owns the per-frame pair state maps and the small object pool backing them, keeping the state
 * lifecycle and the mathpool-discipline of the hot loop in one place. The broadphase pair
 * discovery and spatial queries stay with the owner system; only the *solve* step is here.
 */
export class ContactSolver {
  private readonly _pairStatePool: ContactPairState[] = [];

  private _currentTriggerPairs = new Map<bigint, ContactPairState>();
  private _prevTriggerPairs = new Map<bigint, ContactPairState>();

  private _currentCollisionPairs = new Map<bigint, ContactPairState>();
  private _prevCollisionPairs = new Map<bigint, ContactPairState>();

  private _acquirePairState(): ContactPairState {
    const s = this._pairStatePool.pop();
    if (s) {
      s.depth = 0;
      s.impulse = 0;
      s.normal.set(0, 0, 0);
      return s;
    }
    return {
      objectA: undefined as unknown as Collidable,
      objectB: undefined as unknown as Collidable,
      normal: new Vector3D(),
      depth: 0,
      impulse: 0,
    };
  }

  private _releasePairState(state: ContactPairState): void {
    state.objectA = undefined as unknown as Collidable;
    state.objectB = undefined as unknown as Collidable;
    this._pairStatePool.push(state);
  }

  /**
   * Releases all tracked pair states and resets the enter/stay/exit bookkeeping.
   */
  public clear(): void {
    for (const [, state] of this._prevTriggerPairs) {
      this._releasePairState(state);
    }
    this._prevTriggerPairs.clear();
    for (const [, state] of this._currentTriggerPairs) {
      this._releasePairState(state);
    }
    this._currentTriggerPairs.clear();
    for (const [, state] of this._prevCollisionPairs) {
      this._releasePairState(state);
    }
    this._prevCollisionPairs.clear();
    for (const [, state] of this._currentCollisionPairs) {
      this._releasePairState(state);
    }
    this._currentCollisionPairs.clear();
  }

  /**
   * Solves all active contact pairs, then dispatches the resulting collision/trigger life-cycle
   * events (enter/stay/exit) for this step.
   * @param pairs Active collision pairs discovered this step (mutated in place).
   * @param joints Joints to solve during each PGS iteration and in the positional pass.
   * @param ctx Per-step configuration and dependencies.
   */
  public solve(pairs: ContactPair[], joints: Joint[], ctx: ContactSolverContext): void {
    const events = ctx.events;
    const iterationCount = Math.max(1, ctx.solverIterations);

    const result = MathPool.acquireVector();
    const rv = MathPool.acquireVector();
    const zeroVel = MathPool.acquireVector().set(0, 0, 0);
    const posCorr = MathPool.acquireVector();
    const impulse = MathPool.acquireVector();
    const vt = MathPool.acquireVector();
    const relTangent = MathPool.acquireVector();
    const impulseT = MathPool.acquireVector();
    const contactPt = MathPool.acquireVector();
    const velA = MathPool.acquireVector();
    const velB = MathPool.acquireVector();

    const gravStep = ctx.gravityLength * ctx.fixedTimeStep;

    for (let iter = 0; iter < iterationCount; iter++) {
      // Symmetric Gauss-Seidel: alternate forward and backward passes for bidirectional constraint propagation
      const isForward = iter % 2 === 0;
      const start = isForward ? 0 : pairs.length - 1;
      const end = isForward ? pairs.length : -1;
      const stepDir = isForward ? 1 : -1;

      for (let i = start; i !== end; i += stepDir) {
        const pair = pairs[i]!;
        const first = pair.first;
        const second = pair.second;

        const firstObj = first instanceof Object3D ? first : undefined;
        const secondObj = second instanceof Object3D ? second : undefined;

        const rbA = firstObj?.rigidBody;
        const rbB = secondObj?.rigidBody;

        const invMassA = rbA && rbA.inverseMass > 0 ? rbA.inverseMass : 0;
        const invMassB = rbB && rbB.inverseMass > 0 ? rbB.inverseMass : 0;
        const totalInvMass = invMassA + invMassB;

        // Skip static-static collisions
        if (totalInvMass <= 0) continue;

        const collisionFound = Collision.resolve(first.bounds!, second.bounds!, result);

        if (!collisionFound) {
          pair.colliding = false;
          continue;
        }

        pair.colliding = true;
        const depth = result.length();
        if (depth > 0) {
          pair.depth = depth;
          pair.normal.copyFrom(result).scale(1.0 / depth);
        }

        // Wake up sleeping bodies upon physical impact with an active moving body
        if (iter === 0) {
          const curVelA = rbA ? rbA.velocity : zeroVel;
          const curVelB = rbB ? rbB.velocity : zeroVel;
          const moveThreshSq = Math.max(
            rbA ? rbA.sleepLinearThreshold * rbA.sleepLinearThreshold : 0.0025,
            gravStep * gravStep * 1.44,
          );
          const isMovingA =
            rbA !== undefined &&
            !rbA.isSleeping &&
            (curVelA.lengthSq() > moveThreshSq ||
              curVelA.x * curVelA.x + curVelA.z * curVelA.z > 1e-4);
          const isMovingB =
            rbB !== undefined &&
            !rbB.isSleeping &&
            (curVelB.lengthSq() > moveThreshSq ||
              curVelB.x * curVelB.x + curVelB.z * curVelB.z > 1e-4);

          if (rbA && rbA.isSleeping && isMovingB) {
            rbA.wakeUp();
            events.dispatchEvent("physics:wakeup", { object: firstObj });
          }
          if (rbB && rbB.isSleeping && isMovingA) {
            rbB.wakeUp();
            events.dispatchEvent("physics:wakeup", { object: secondObj });
          }
        }

        const isTriggerA = Boolean(
          first.isTrigger || (firstObj && (firstObj.isTrigger || rbA?.isTrigger || rbA?.isSensor)),
        );
        const isTriggerB = Boolean(
          second.isTrigger ||
          (secondObj && (secondObj.isTrigger || rbB?.isTrigger || rbB?.isSensor)),
        );
        const isTriggerPair = isTriggerA || isTriggerB;

        if (isTriggerPair) {
          pair.colliding = false;
          if (iter === 0) {
            const key = pairKey(pair.idA, pair.idB);
            let state = this._currentTriggerPairs.get(key);
            if (!state) {
              state = this._acquirePairState();
              this._currentTriggerPairs.set(key, state);
            }
            state.objectA = (firstObj ?? secondObj)!;
            state.objectB = firstObj ? second : first;
            state.normal.copyFrom(pair.normal);
            state.depth = depth;

            if (!this._prevTriggerPairs.has(key)) {
              events.dispatchEvent("physics:trigger-enter", {
                objectA: state.objectA,
                objectB: state.objectB,
                normal: pair.normal,
                depth: depth,
              });
            } else {
              events.dispatchEvent("physics:trigger-stay", {
                objectA: state.objectA,
                objectB: state.objectB,
                normal: pair.normal,
                depth: depth,
              });
            }

            events.dispatchEvent("physics:trigger", {
              objectA: state.objectA,
              objectB: state.objectB,
              normal: pair.normal,
              depth: depth,
            });
            events.dispatchEvent("physics:collision", {
              objectA: state.objectA,
              objectB: state.objectB,
              normal: pair.normal,
              depth: depth,
              impulse: 0,
            });
          }
          continue;
        }

        // 1. Position resolution (penetration separation)
        if (depth > 0) {
          const correction = depth / totalInvMass;

          if (invMassA > 0 && firstObj) {
            posCorr.copyFrom(pair.normal).scale(correction * invMassA);
            ctx.syncTransform(firstObj, posCorr);
          }

          if (invMassB > 0 && secondObj) {
            posCorr.copyFrom(pair.normal).scale(-correction * invMassB);
            ctx.syncTransform(secondObj, posCorr);
          }
        }

        if (!pair.colliding) continue;

        const normal = pair.normal;

        // Accurate contact point in world coordinates
        const centerA = firstObj ? firstObj.position : first.bounds!.center;
        const centerB = secondObj ? secondObj.position : second.bounds!.center;
        const volA = first.bounds!;
        const volB = second.bounds!;

        if (volA.type === BoundingType.SPHERE && volB.type === BoundingType.SPHERE) {
          const rA = (volA as BoundingSphere).radius;
          contactPt.set(
            centerA.x - normal.x * (rA - pair.depth * 0.5),
            centerA.y - normal.y * (rA - pair.depth * 0.5),
            centerA.z - normal.z * (rA - pair.depth * 0.5),
          );
        } else if (volA.type === BoundingType.SPHERE && volB.type === BoundingType.BOX) {
          const boxB = volB as BoundingBox;
          contactPt.set(
            Math.max(boxB.min.x, Math.min(centerA.x, boxB.max.x)),
            Math.max(boxB.min.y, Math.min(centerA.y, boxB.max.y)),
            Math.max(boxB.min.z, Math.min(centerA.z, boxB.max.z)),
          );
        } else if (volA.type === BoundingType.BOX && volB.type === BoundingType.SPHERE) {
          const boxA = volA as BoundingBox;
          contactPt.set(
            Math.max(boxA.min.x, Math.min(centerB.x, boxA.max.x)),
            Math.max(boxA.min.y, Math.min(centerB.y, boxA.max.y)),
            Math.max(boxA.min.z, Math.min(centerB.z, boxA.max.z)),
          );
        } else if (volA.type === BoundingType.BOX && volB.type === BoundingType.BOX) {
          const boxA = volA as BoundingBox;
          const boxB = volB as BoundingBox;
          contactPt.set(
            (Math.max(boxA.min.x, boxB.min.x) + Math.min(boxA.max.x, boxB.max.x)) * 0.5,
            (Math.max(boxA.min.y, boxB.min.y) + Math.min(boxA.max.y, boxB.max.y)) * 0.5,
            (Math.max(boxA.min.z, boxB.min.z) + Math.min(boxA.max.z, boxB.max.z)) * 0.5,
          );
        } else if (volA.type === BoundingType.SPHERE) {
          const rA = (volA as BoundingSphere).radius;
          contactPt.set(
            centerA.x - normal.x * (rA - pair.depth * 0.5),
            centerA.y - normal.y * (rA - pair.depth * 0.5),
            centerA.z - normal.z * (rA - pair.depth * 0.5),
          );
        } else if (volB.type === BoundingType.SPHERE) {
          const rB = (volB as BoundingSphere).radius;
          contactPt.set(
            centerB.x + normal.x * (rB - pair.depth * 0.5),
            centerB.y + normal.y * (rB - pair.depth * 0.5),
            centerB.z + normal.z * (rB - pair.depth * 0.5),
          );
        } else {
          contactPt.set(
            (centerA.x + centerB.x) * 0.5,
            (centerA.y + centerB.y) * 0.5,
            (centerA.z + centerB.z) * 0.5,
          );
        }

        // Lever arms rA = contactPt - centerA, rB = contactPt - centerB
        const rAx = contactPt.x - centerA.x;
        const rAy = contactPt.y - centerA.y;
        const rAz = contactPt.z - centerA.z;

        const rBx = contactPt.x - centerB.x;
        const rBy = contactPt.y - centerB.y;
        const rBz = contactPt.z - centerB.z;

        // Linear + angular contact velocities: v_contact = v + w x r
        const curVelA = rbA && invMassA > 0 ? rbA.velocity : zeroVel;
        const curVelB = rbB && invMassB > 0 ? rbB.velocity : zeroVel;

        const wA = rbA && invMassA > 0 ? rbA.angularVelocity : zeroVel;
        const wB = rbB && invMassB > 0 ? rbB.angularVelocity : zeroVel;

        const vRotAx = wA.y * rAz - wA.z * rAy;
        const vRotAy = wA.z * rAx - wA.x * rAz;
        const vRotAz = wA.x * rAy - wA.y * rAx;

        const vRotBx = wB.y * rBz - wB.z * rBy;
        const vRotBy = wB.z * rBx - wB.x * rBz;
        const vRotBz = wB.x * rBy - wB.y * rBx;

        velA.set(curVelA.x + vRotAx, curVelA.y + vRotAy, curVelA.z + vRotAz);
        velB.set(curVelB.x + vRotBx, curVelB.y + vRotBy, curVelB.z + vRotBz);

        rv.copyFrom(velA).sub(velB);
        const velAlongNormal = rv.dot(normal);

        // Rotational effective inverse mass terms for normal:
        let kRotN = 0;
        if (invMassA > 0 && rbA) {
          const tauNx = rAy * normal.z - rAz * normal.y;
          const tauNy = rAz * normal.x - rAx * normal.z;
          const tauNz = rAx * normal.y - rAy * normal.x;

          const dWx = tauNx * rbA.inverseInertiaTensor.x;
          const dWy = tauNy * rbA.inverseInertiaTensor.y;
          const dWz = tauNz * rbA.inverseInertiaTensor.z;

          const dVx = dWy * rAz - dWz * rAy;
          const dVy = dWz * rAx - dWx * rAz;
          const dVz = dWx * rAy - dWy * rAx;

          kRotN += dVx * normal.x + dVy * normal.y + dVz * normal.z;
        }

        if (invMassB > 0 && rbB) {
          const tauNx = rBy * normal.z - rBz * normal.y;
          const tauNy = rBz * normal.x - rBx * normal.z;
          const tauNz = rBx * normal.y - rBy * normal.x;

          const dWx = tauNx * rbB.inverseInertiaTensor.x;
          const dWy = tauNy * rbB.inverseInertiaTensor.y;
          const dWz = tauNz * rbB.inverseInertiaTensor.z;

          const dVx = dWy * rBz - dWz * rBy;
          const dVy = dWz * rBx - dWx * rBz;
          const dVz = dWx * rBy - dWy * rBx;

          kRotN += dVx * normal.x + dVy * normal.y + dVz * normal.z;
        }

        const effInvMassN = totalInvMass + kRotN;

        // 2. Velocity resolution (Normal Impulse with angular reaction)
        let jMag = 0;
        if (velAlongNormal < 0 && effInvMassN > 0) {
          const restA = rbA
            ? rbA.restitution
            : first instanceof StaticCollider
              ? first.restitution
              : 0.2;
          const restB = rbB
            ? rbB.restitution
            : second instanceof StaticCollider
              ? second.restitution
              : 0.2;
          const e = iter === 0 && velAlongNormal <= -0.5 ? Math.min(restA, restB) : 0;
          jMag = -(1 + e) * velAlongNormal;
          // Successive Over-Relaxation (SOR) factor (1.2) for fast convergence on stacked contacts
          const relaxation = iter > 0 ? 1.2 : 1.0;
          jMag = (jMag / effInvMassN) * relaxation;

          impulse.copyFrom(normal).scale(jMag);
          if (invMassA > 0 && rbA) {
            rbA.applyImpulseAtPoint(impulse, contactPt, centerA);
          }
          if (invMassB > 0 && rbB) {
            impulse.scale(-1);
            rbB.applyImpulseAtPoint(impulse, contactPt, centerB);
          }
        }

        // 3. Coulomb Contact Friction (with angular response)
        const postVelA = rbA && invMassA > 0 ? rbA.velocity : zeroVel;
        const postVelB = rbB && invMassB > 0 ? rbB.velocity : zeroVel;
        const postWA = rbA && invMassA > 0 ? rbA.angularVelocity : zeroVel;
        const postWB = rbB && invMassB > 0 ? rbB.angularVelocity : zeroVel;

        const pvRotAx = postWA.y * rAz - postWA.z * rAy;
        const pvRotAy = postWA.z * rAx - postWA.x * rAz;
        const pvRotAz = postWA.x * rAy - postWA.y * rAx;

        const pvRotBx = postWB.y * rBz - postWB.z * rBy;
        const pvRotBy = postWB.z * rBx - postWB.x * rBz;
        const pvRotBz = postWB.x * rBy - postWB.y * rBx;

        velA.set(postVelA.x + pvRotAx, postVelA.y + pvRotAy, postVelA.z + pvRotAz);
        velB.set(postVelB.x + pvRotBx, postVelB.y + pvRotBy, postVelB.z + pvRotBz);

        rv.copyFrom(velA).sub(velB);

        const vNormal = rv.dot(normal);
        vt.copyFrom(normal).scale(vNormal);
        relTangent.copyFrom(rv).sub(vt);
        const vtSpeed = relTangent.length();

        if (vtSpeed > 1e-4 && jMag > 0) {
          const frictA = rbA
            ? rbA.friction
            : first instanceof StaticCollider
              ? first.friction
              : 0.5;
          const frictB = rbB
            ? rbB.friction
            : second instanceof StaticCollider
              ? second.friction
              : 0.5;
          const mu = Math.sqrt(Math.max(0, frictA) * Math.max(0, frictB));

          const tDirX = relTangent.x / vtSpeed;
          const tDirY = relTangent.y / vtSpeed;
          const tDirZ = relTangent.z / vtSpeed;

          let kRotT = 0;
          if (invMassA > 0 && rbA) {
            const tauTx = rAy * tDirZ - rAz * tDirY;
            const tauTy = rAz * tDirX - rAx * tDirZ;
            const tauTz = rAx * tDirY - rAy * tDirX;

            const dWx = tauTx * rbA.inverseInertiaTensor.x;
            const dWy = tauTy * rbA.inverseInertiaTensor.y;
            const dWz = tauTz * rbA.inverseInertiaTensor.z;

            const dVx = dWy * rAz - dWz * rAy;
            const dVy = dWz * rAx - dWx * rAz;
            const dVz = dWx * rAy - dWy * rAx;

            kRotT += dVx * tDirX + dVy * tDirY + dVz * tDirZ;
          }

          if (invMassB > 0 && rbB) {
            const tauTx = rBy * tDirZ - rBz * tDirY;
            const tauTy = rBz * tDirX - rBx * tDirZ;
            const tauTz = rBx * tDirY - rBy * tDirX;

            const dWx = tauTx * rbB.inverseInertiaTensor.x;
            const dWy = tauTy * rbB.inverseInertiaTensor.y;
            const dWz = tauTz * rbB.inverseInertiaTensor.z;

            const dVx = dWy * rBz - dWz * rBy;
            const dVy = dWz * rBx - dWx * rBz;
            const dVz = dWx * rBy - dWy * rBx;

            kRotT += dVx * tDirX + dVy * tDirY + dVz * tDirZ;
          }

          const effInvMassT = totalInvMass + kRotT;

          // Max tangential friction impulse allowed by Coulomb cone
          const maxFrictionImpulse = mu * jMag;
          // Ideal impulse to stop tangential sliding
          const idealFrictionImpulse = effInvMassT > 0 ? vtSpeed / effInvMassT : 0;
          const jFriction = Math.min(idealFrictionImpulse, maxFrictionImpulse);

          if (jFriction > 1e-8) {
            impulseT.set(-tDirX * jFriction, -tDirY * jFriction, -tDirZ * jFriction);
            if (invMassA > 0 && rbA) {
              rbA.applyImpulseAtPoint(impulseT, contactPt, centerA);
            }
            if (invMassB > 0 && rbB) {
              impulseT.scale(-1);
              rbB.applyImpulseAtPoint(impulseT, contactPt, centerB);
            }
          }
        }

        // 4. Dispatch collision event once on the first iteration
        if (iter === 0 && pair.colliding && (velAlongNormal < 0 || pair.depth > 0)) {
          const key = pairKey(pair.idA, pair.idB);
          let state = this._currentCollisionPairs.get(key);
          if (!state) {
            state = this._acquirePairState();
            this._currentCollisionPairs.set(key, state);
          }
          state.objectA = (firstObj ?? secondObj)!;
          state.objectB = firstObj ? second : first;
          state.normal.copyFrom(normal);
          state.depth = pair.depth;
          state.impulse = jMag;

          if (!this._prevCollisionPairs.has(key)) {
            events.dispatchEvent("physics:collision-enter", {
              objectA: state.objectA,
              objectB: state.objectB,
              normal: normal,
              depth: pair.depth,
              impulse: jMag,
            });
          } else {
            events.dispatchEvent("physics:collision-stay", {
              objectA: state.objectA,
              objectB: state.objectB,
              normal: normal,
              depth: pair.depth,
              impulse: jMag,
            });
          }

          events.dispatchEvent("physics:collision", {
            objectA: state.objectA,
            objectB: state.objectB,
            normal: normal,
            depth: pair.depth,
            impulse: jMag,
          });
        }
      }

      // Solve joint velocity constraints during each PGS iteration
      for (let k = 0; k < joints.length; k++) {
        const joint = joints[k]!;
        if (joint.enabled && !joint.isBroken) {
          joint.solveVelocity(ctx.fixedTimeStep);
        }
      }
    }

    // Solve post-solve position projection / drift compensation for joints
    for (let k = 0; k < joints.length; k++) {
      const joint = joints[k]!;
      if (joint.enabled && !joint.isBroken) {
        joint.solvePosition();
      }
    }

    // 5. Resting contact velocity stabilization: clamp small discrete gravity drift on settled bodies
    const gravitySpeed = ctx.gravityLength * ctx.fixedTimeStep;
    const restThresholdSq = gravitySpeed * gravitySpeed * 1.5;

    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i]!;
      if (!pair.colliding) continue;

      const firstObj = pair.first instanceof Object3D ? pair.first : undefined;
      const secondObj = pair.second instanceof Object3D ? pair.second : undefined;
      const rbA = firstObj?.rigidBody;
      const rbB = secondObj?.rigidBody;

      if (rbA && rbA.inverseMass > 0 && !rbA.isSleeping) {
        if (rbA.velocity.lengthSq() < restThresholdSq) {
          const vDotN = rbA.velocity.dot(pair.normal);
          if (Math.abs(vDotN) < gravitySpeed * 1.2) {
            rbA.velocity.x -= pair.normal.x * vDotN;
            rbA.velocity.y -= pair.normal.y * vDotN;
            rbA.velocity.z -= pair.normal.z * vDotN;
          }
        }
      }

      if (rbB && rbB.inverseMass > 0 && !rbB.isSleeping) {
        if (rbB.velocity.lengthSq() < restThresholdSq) {
          const vDotN = rbB.velocity.dot(pair.normal);
          if (Math.abs(vDotN) < gravitySpeed * 1.2) {
            rbB.velocity.x -= pair.normal.x * vDotN;
            rbB.velocity.y -= pair.normal.y * vDotN;
            rbB.velocity.z -= pair.normal.z * vDotN;
          }
        }
      }
    }

    // 6. Trigger & Collision Exit Events
    for (const [key, state] of this._prevTriggerPairs) {
      if (!this._currentTriggerPairs.has(key)) {
        events.dispatchEvent("physics:trigger-exit", {
          objectA: state.objectA,
          objectB: state.objectB,
        });
      }
      this._releasePairState(state);
    }
    this._prevTriggerPairs.clear();
    const tempTrig = this._prevTriggerPairs;
    this._prevTriggerPairs = this._currentTriggerPairs;
    this._currentTriggerPairs = tempTrig;

    for (const [key, state] of this._prevCollisionPairs) {
      if (!this._currentCollisionPairs.has(key)) {
        events.dispatchEvent("physics:collision-exit", {
          objectA: state.objectA,
          objectB: state.objectB,
        });
      }
      this._releasePairState(state);
    }
    this._prevCollisionPairs.clear();
    const tempColl = this._prevCollisionPairs;
    this._prevCollisionPairs = this._currentCollisionPairs;
    this._currentCollisionPairs = tempColl;

    MathPool.releaseVector(velB);
    MathPool.releaseVector(velA);
    MathPool.releaseVector(contactPt);
    MathPool.releaseVector(impulseT);
    MathPool.releaseVector(relTangent);
    MathPool.releaseVector(vt);
    MathPool.releaseVector(impulse);
    MathPool.releaseVector(posCorr);
    MathPool.releaseVector(zeroVel);
    MathPool.releaseVector(result);
    MathPool.releaseVector(rv);
  }
}
