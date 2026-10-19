import { Object3D } from "../../core/Object3D.js";
import type { Vector3D } from "../../math/index.js";
import { MathPool } from "../../math/index.js";
import { Collision } from "../Collision.js";
import type { EventDispatcherImpl } from "../../core/events/EventDispatcherImpl.js";
import { BoundingType } from "../../enums/index.js";
import type { BoundingVolume } from "../../interfaces/index.js";
import { StaticCollider } from "../StaticCollider.js";
import type { Joint } from "../joints/Joint.js";
import { pairKey } from "../PairTracker.js";
import type { PairTracker, ContactPair } from "../PairTracker.js";
import { RigidBodyMath } from "../RigidBodyMath.js";
import type { RigidBody } from "../RigidBody.js";

export { pairKey, type ContactPair, type ContactPairState } from "../PairTracker.js";

/** Per-step dependencies injected by the owner system (keeps the public API surface there). */
export interface ContactSolverContext {
  events: EventDispatcherImpl;
  fixedTimeStep: number;
  gravityLength: number;
  solverIterations: number;
  /**
   * Pair identity and lifecycle bookkeeping (discovery dedup, pooled pairs and the pooled
   * enter/stay/exit state) for the current step. Must be `endStep`-ed once per solve.
   */
  tracker: PairTracker;
  /** Applies a positional correction to a dynamic body and refreshes its transform/bounds. */
  syncTransform: (obj: Object3D, posCorr: Vector3D) => void;
}

/** Scratch memory shared by one solve pass (owned by `_solvePair`, reused across iterations). */
interface PairSolveScratch {
  result: Vector3D;
  rv: Vector3D;
  zeroVel: Vector3D;
  posCorr: Vector3D;
  impulse: Vector3D;
  vt: Vector3D;
  relTangent: Vector3D;
  impulseT: Vector3D;
  contactPt: Vector3D;
  velA: Vector3D;
  velB: Vector3D;
  rA: Vector3D;
  rB: Vector3D;
}

/**
 * Iterative contact solver: penetration separation, normal/friction impulse resolution with a
 * physically correct world-space angular response, trigger/collision bookkeeping and resting-
 * contact stabilization.
 *
 * Pair *identity* (pair keys, discovery dedup, the pooled pair entries and the pooled
 * enter/stay/exit state) is owned by the injected {@link PairTracker}; this class only consumes
 * it. Impulse math (contact-point velocity, rotational effective mass and off-center impulses)
 * is delegated to {@link RigidBodyMath}, which rotates the principal inertia into the world
 * frame instead of the duplicated unrotated `kRot` arithmetic the original solver inlined.
 */
export class ContactSolver {
  private readonly _math = new RigidBodyMath();

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

    const scratch: PairSolveScratch = {
      result: MathPool.acquireVector(),
      rv: MathPool.acquireVector(),
      zeroVel: MathPool.acquireVector().set(0, 0, 0),
      posCorr: MathPool.acquireVector(),
      impulse: MathPool.acquireVector(),
      vt: MathPool.acquireVector(),
      relTangent: MathPool.acquireVector(),
      impulseT: MathPool.acquireVector(),
      contactPt: MathPool.acquireVector(),
      velA: MathPool.acquireVector(),
      velB: MathPool.acquireVector(),
      rA: MathPool.acquireVector(),
      rB: MathPool.acquireVector(),
    };

    const gravStep = ctx.gravityLength * ctx.fixedTimeStep;

    for (let iter = 0; iter < iterationCount; iter++) {
      // Symmetric Gauss-Seidel: alternate forward and backward passes for bidirectional constraint propagation
      const isForward = iter % 2 === 0;
      const start = isForward ? 0 : pairs.length - 1;
      const end = isForward ? pairs.length : -1;
      const stepDir = isForward ? 1 : -1;

      for (let i = start; i !== end; i += stepDir) {
        this._solvePair(pairs[i]!, ctx, scratch, iter, gravStep);
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

    // 5. Resting contact velocity stabilization
    this._restingVelocityStabilization(pairs, ctx);

    // 6. Trigger & Collision Exit Events (dispatches exits, returns state to the pool,
    //    rolls the current maps into next step's "previous" slot)
    ctx.tracker.endStep(events);

    MathPool.releaseVector(scratch.rB);
    MathPool.releaseVector(scratch.rA);
    MathPool.releaseVector(scratch.velB);
    MathPool.releaseVector(scratch.velA);
    MathPool.releaseVector(scratch.contactPt);
    MathPool.releaseVector(scratch.impulseT);
    MathPool.releaseVector(scratch.relTangent);
    MathPool.releaseVector(scratch.vt);
    MathPool.releaseVector(scratch.impulse);
    MathPool.releaseVector(scratch.posCorr);
    MathPool.releaseVector(scratch.zeroVel);
    MathPool.releaseVector(scratch.result);
    MathPool.releaseVector(scratch.rv);
  }

  /**
   * Solves one discovered contact pair: narrow-phase, wake-up check, trigger handling, position
   * separation and the normal/friction impulse resolution with a world-space angular response.
   */
  private _solvePair(
    pair: ContactPair,
    ctx: ContactSolverContext,
    s: PairSolveScratch,
    iter: number,
    gravStep: number,
  ): void {
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
    if (totalInvMass <= 0) return;

    const collisionFound = Collision.resolve(first.bounds!, second.bounds!, s.result);

    if (!collisionFound) {
      pair.colliding = false;
      return;
    }

    pair.colliding = true;
    const depth = s.result.length();
    if (depth > 0) {
      pair.depth = depth;
      pair.normal.copyFrom(s.result).scale(1.0 / depth);
    }

    // Wake up sleeping bodies upon physical impact with an active moving body
    if (iter === 0) {
      this._wakeCheck(rbA, rbB, firstObj, secondObj, ctx, s, gravStep);
    }

    const isTriggerA = Boolean(
      first.isTrigger || (firstObj && (firstObj.isTrigger || rbA?.isTrigger || rbA?.isSensor)),
    );
    const isTriggerB = Boolean(
      second.isTrigger || (secondObj && (secondObj.isTrigger || rbB?.isTrigger || rbB?.isSensor)),
    );
    const isTriggerPair = isTriggerA || isTriggerB;

    if (isTriggerPair) {
      pair.colliding = false;
      if (iter === 0) {
        this._trackTrigger(pair, ctx, firstObj, secondObj, depth);
      }
      return;
    }

    // 1. Position resolution (penetration separation)
    if (depth > 0) {
      const correction = depth / totalInvMass;

      if (invMassA > 0 && firstObj) {
        s.posCorr.copyFrom(pair.normal).scale(correction * invMassA);
        ctx.syncTransform(firstObj, s.posCorr);
      }

      if (invMassB > 0 && secondObj) {
        s.posCorr.copyFrom(pair.normal).scale(-correction * invMassB);
        ctx.syncTransform(secondObj, s.posCorr);
      }
    }

    if (!pair.colliding) return;

    // 2-3. Normal + Coulomb friction impulse resolution with world-space angular response
    this._resolveContactImpulse(
      pair,
      ctx,
      s,
      firstObj,
      secondObj,
      rbA,
      rbB,
      invMassA,
      invMassB,
      iter,
    );
  }

  /** Wake-up check for a sleeping body touched by an active moving body (first solver iteration only). */
  private _wakeCheck(
    rbA: RigidBody | undefined,
    rbB: RigidBody | undefined,
    firstObj: Object3D | undefined,
    secondObj: Object3D | undefined,
    ctx: ContactSolverContext,
    s: PairSolveScratch,
    gravStep: number,
  ): void {
    const events = ctx.events;
    const curVelA = rbA ? rbA.velocity : s.zeroVel;
    const curVelB = rbB ? rbB.velocity : s.zeroVel;
    const moveThreshSq = Math.max(
      rbA ? rbA.sleepLinearThreshold * rbA.sleepLinearThreshold : 0.0025,
      gravStep * gravStep * 1.44,
    );
    const isMovingA =
      rbA !== undefined &&
      !rbA.isSleeping &&
      (curVelA.lengthSq() > moveThreshSq || curVelA.x * curVelA.x + curVelA.z * curVelA.z > 1e-4);
    const isMovingB =
      rbB !== undefined &&
      !rbB.isSleeping &&
      (curVelB.lengthSq() > moveThreshSq || curVelB.x * curVelB.x + curVelB.z * curVelB.z > 1e-4);

    if (rbA && rbA.isSleeping && isMovingB) {
      rbA.wakeUp();
      events.dispatchEvent("physics:wakeup", { object: firstObj });
    }
    if (rbB && rbB.isSleeping && isMovingA) {
      rbB.wakeUp();
      events.dispatchEvent("physics:wakeup", { object: secondObj });
    }
  }

  /** Trigger bookkeeping + event dispatch for a colliding trigger pair (first iteration only). */
  private _trackTrigger(
    pair: ContactPair,
    ctx: ContactSolverContext,
    firstObj: Object3D | undefined,
    secondObj: Object3D | undefined,
    depth: number,
  ): void {
    const events = ctx.events;
    const key = pairKey(pair.idA, pair.idB);
    const { state, wasPresent } = ctx.tracker.trackTrigger(key);
    state.objectA = (firstObj ?? secondObj)!;
    state.objectB = firstObj ? pair.second : pair.first;
    state.normal.copyFrom(pair.normal);
    state.depth = depth;

    if (!wasPresent) {
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

  /**
   * Normal and Coulomb-friction impulse resolution for a colliding pair, with a physically
   * correct angular response computed through the body's world-rotated inertia.
   */
  private _resolveContactImpulse(
    pair: ContactPair,
    ctx: ContactSolverContext,
    s: PairSolveScratch,
    firstObj: Object3D | undefined,
    secondObj: Object3D | undefined,
    rbA: RigidBody | undefined,
    rbB: RigidBody | undefined,
    invMassA: number,
    invMassB: number,
    iter: number,
  ): void {
    const events = ctx.events;
    const first = pair.first;
    const second = pair.second;
    const normal = pair.normal;

    // Accurate contact point in world coordinates
    const centerA = firstObj ? firstObj.position : first.bounds!.center;
    const centerB = secondObj ? secondObj.position : second.bounds!.center;
    const volA = first.bounds!;
    const volB = second.bounds!;

    this._computeContactPoint(volA, volB, pair, centerA, centerB, s.contactPt);

    // Lever arms rA = contactPt - centerA, rB = contactPt - centerB
    s.rA.set(s.contactPt.x - centerA.x, s.contactPt.y - centerA.y, s.contactPt.z - centerA.z);
    s.rB.set(s.contactPt.x - centerB.x, s.contactPt.y - centerB.y, s.contactPt.z - centerB.z);

    // Contact-point velocities: v_contact = v + ω x r
    if (invMassA > 0 && rbA) {
      this._math.pointVelocity(rbA, s.rA, s.velA);
    } else {
      s.velA.copyFrom(s.zeroVel);
    }
    if (invMassB > 0 && rbB) {
      this._math.pointVelocity(rbB, s.rB, s.velB);
    } else {
      s.velB.copyFrom(s.zeroVel);
    }

    s.rv.copyFrom(s.velA).sub(s.velB);
    const velAlongNormal = s.rv.dot(normal);

    // Rotational effective inverse mass terms for normal (world inertia)
    let kRotN = 0;
    if (invMassA > 0 && rbA && firstObj) {
      kRotN += this._math.effectiveInvMass(rbA, firstObj.rotation, s.rA, normal);
    }
    if (invMassB > 0 && rbB && secondObj) {
      kRotN += this._math.effectiveInvMass(rbB, secondObj.rotation, s.rB, normal);
    }

    const effInvMassN = totalInvMassOf(invMassA, invMassB) + kRotN;

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

      s.impulse.copyFrom(normal).scale(jMag);
      if (invMassA > 0 && rbA && firstObj) {
        this._math.applyImpulseAtPoint(rbA, firstObj.rotation, s.impulse, s.rA);
      }
      if (invMassB > 0 && rbB && secondObj) {
        s.impulse.scale(-1);
        this._math.applyImpulseAtPoint(rbB, secondObj.rotation, s.impulse, s.rB);
      }
    }

    // 3. Coulomb Contact Friction (with angular response)
    if (invMassA > 0 && rbA) {
      this._math.pointVelocity(rbA, s.rA, s.velA);
    } else {
      s.velA.copyFrom(s.zeroVel);
    }
    if (invMassB > 0 && rbB) {
      this._math.pointVelocity(rbB, s.rB, s.velB);
    } else {
      s.velB.copyFrom(s.zeroVel);
    }

    s.rv.copyFrom(s.velA).sub(s.velB);

    const vNormal = s.rv.dot(normal);
    s.vt.copyFrom(normal).scale(vNormal);
    s.relTangent.copyFrom(s.rv).sub(s.vt);
    const vtSpeed = s.relTangent.length();

    if (vtSpeed > 1e-4 && jMag > 0) {
      const frictA = rbA ? rbA.friction : first instanceof StaticCollider ? first.friction : 0.5;
      const frictB = rbB ? rbB.friction : second instanceof StaticCollider ? second.friction : 0.5;
      const mu = Math.sqrt(Math.max(0, frictA) * Math.max(0, frictB));

      const tDirX = s.relTangent.x / vtSpeed;
      const tDirY = s.relTangent.y / vtSpeed;
      const tDirZ = s.relTangent.z / vtSpeed;
      s.relTangent.set(tDirX, tDirY, tDirZ);

      let kRotT = 0;
      if (invMassA > 0 && rbA && firstObj) {
        kRotT += this._math.effectiveInvMass(rbA, firstObj.rotation, s.rA, s.relTangent);
      }
      if (invMassB > 0 && rbB && secondObj) {
        kRotT += this._math.effectiveInvMass(rbB, secondObj.rotation, s.rB, s.relTangent);
      }

      const effInvMassT = totalInvMassOf(invMassA, invMassB) + kRotT;

      // Max tangential friction impulse allowed by Coulomb cone
      const maxFrictionImpulse = mu * jMag;
      // Ideal impulse to stop tangential sliding
      const idealFrictionImpulse = effInvMassT > 0 ? vtSpeed / effInvMassT : 0;
      const jFriction = Math.min(idealFrictionImpulse, maxFrictionImpulse);

      if (jFriction > 1e-8) {
        s.impulseT.set(-tDirX * jFriction, -tDirY * jFriction, -tDirZ * jFriction);
        if (invMassA > 0 && rbA && firstObj) {
          this._math.applyImpulseAtPoint(rbA, firstObj.rotation, s.impulseT, s.rA);
        }
        if (invMassB > 0 && rbB && secondObj) {
          s.impulseT.scale(-1);
          this._math.applyImpulseAtPoint(rbB, secondObj.rotation, s.impulseT, s.rB);
        }
      }
    }

    // 4. Dispatch collision event once on the first iteration
    if (iter === 0 && pair.colliding && (velAlongNormal < 0 || pair.depth > 0)) {
      const key = pairKey(pair.idA, pair.idB);
      const { state, wasPresent } = ctx.tracker.trackCollision(key);
      state.objectA = (firstObj ?? secondObj)!;
      state.objectB = firstObj ? second : first;
      state.normal.copyFrom(normal);
      state.depth = pair.depth;
      state.impulse = jMag;

      if (!wasPresent) {
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

  /** Contact-point heuristic for accurate lever arms (exact for sphere/box, midpoint otherwise). */
  private _computeContactPoint(
    volA: BoundingVolume,
    volB: BoundingVolume,
    pair: ContactPair,
    centerA: Vector3D,
    centerB: Vector3D,
    contactPt: Vector3D,
  ): void {
    const normal = pair.normal;

    if (volA.type === BoundingType.SPHERE && volB.type === BoundingType.SPHERE) {
      const rA = volA.radius;
      contactPt.set(
        centerA.x - normal.x * (rA - pair.depth * 0.5),
        centerA.y - normal.y * (rA - pair.depth * 0.5),
        centerA.z - normal.z * (rA - pair.depth * 0.5),
      );
    } else if (volA.type === BoundingType.SPHERE && volB.type === BoundingType.BOX) {
      const boxB = volB;
      contactPt.set(
        Math.max(boxB.min.x, Math.min(centerA.x, boxB.max.x)),
        Math.max(boxB.min.y, Math.min(centerA.y, boxB.max.y)),
        Math.max(boxB.min.z, Math.min(centerA.z, boxB.max.z)),
      );
    } else if (volA.type === BoundingType.BOX && volB.type === BoundingType.SPHERE) {
      const boxA = volA;
      contactPt.set(
        Math.max(boxA.min.x, Math.min(centerB.x, boxA.max.x)),
        Math.max(boxA.min.y, Math.min(centerB.y, boxA.max.y)),
        Math.max(boxA.min.z, Math.min(centerB.z, boxA.max.z)),
      );
    } else if (volA.type === BoundingType.BOX && volB.type === BoundingType.BOX) {
      const boxA = volA;
      const boxB = volB;
      contactPt.set(
        (Math.max(boxA.min.x, boxB.min.x) + Math.min(boxA.max.x, boxB.max.x)) * 0.5,
        (Math.max(boxA.min.y, boxB.min.y) + Math.min(boxA.max.y, boxB.max.y)) * 0.5,
        (Math.max(boxA.min.z, boxB.min.z) + Math.min(boxA.max.z, boxB.max.z)) * 0.5,
      );
    } else if (volA.type === BoundingType.SPHERE) {
      const rA = volA.radius;
      contactPt.set(
        centerA.x - normal.x * (rA - pair.depth * 0.5),
        centerA.y - normal.y * (rA - pair.depth * 0.5),
        centerA.z - normal.z * (rA - pair.depth * 0.5),
      );
    } else if (volB.type === BoundingType.SPHERE) {
      const rB = volB.radius;
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
  }

  /** Resting-contact velocity stabilization: clamp small discrete gravity drift on settled bodies. */
  private _restingVelocityStabilization(pairs: ContactPair[], ctx: ContactSolverContext): void {
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
  }
}

function totalInvMassOf(invMassA: number, invMassB: number): number {
  return invMassA + invMassB;
}
