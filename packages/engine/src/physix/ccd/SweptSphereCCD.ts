import { Object3D } from "../../core/Object3D.js";
import { Vector3D, MathPool } from "../../math/index.js";
import type { Collidable } from "../../interfaces/index.js";
import { BoundingBox } from "../BoundingBox.js";
import { Collision } from "../Collision.js";
import { PhysicsBroadphase } from "../broadphase/PhysicsBroadphase.js";

/**
 * How far past the exact contact point a CCD-corrected body is allowed to advance, as a
 * fraction of its per-substep displacement.
 */
const CCD_CONTACT_OVERSHOOT: number = 0.01;

export interface CCDCandidate {
  obj: Object3D;
  prevPos: Vector3D;
  delta: Vector3D;
  broadRadius: number;
}

/**
 * Handles Continuous Collision Detection (CCD) for fast-moving bodies (Sphere, Box, OBB) to prevent tunneling.
 */
export class SweptVolumeCCD {
  private _candidates: CCDCandidate[] = [];
  private _queryHits: Collidable[] = [];
  private _scratchBox: BoundingBox = new BoundingBox(new Vector3D(), new Vector3D());

  /** Returns true if any fast-moving bodies were registered in the current substep. */
  public get hasCandidates(): boolean {
    return this._candidates.length > 0;
  }

  /**
   * Tests whether a moving body exceeds the motion threshold and should be registered for swept CCD.
   * @param obj The dynamic Object3D.
   * @param deltaP Positional displacement vector for this substep.
   * @param ccdMotionThreshold Multiplier of broad radius triggering CCD.
   */
  public checkCandidate(obj: Object3D, deltaP: Vector3D, ccdMotionThreshold: number): void {
    if (obj.bounds && Number.isFinite(ccdMotionThreshold) && ccdMotionThreshold > 0) {
      const broadRadius = obj.bounds.getBroadRadius();
      const threshold = broadRadius * ccdMotionThreshold;
      if (deltaP.lengthSq() > threshold * threshold) {
        this._candidates.push({
          obj,
          prevPos: MathPool.acquireVector().copyFrom(obj.position),
          delta: MathPool.acquireVector().copyFrom(deltaP),
          broadRadius,
        });
      }
    }
  }

  /**
   * Sweeps all registered CCD candidates against nearby colliders and clamps their positions to
   * earliest impact.
   *
   * Callers must reset the broadphase placement of every returned body afterwards
   * (e.g. {@link PhysicsBroadphase.reinsertCollider}): a clamped position *behind* the swept
   * one is no longer represented by the octree node it was originally inserted into (that node
   * covers the unclamped swept volume), so later queries around the body's actual position would
   * silently miss it.
   * @param broadphase The active physics broadphase structure.
   * @returns The bodies whose positions were clamped this call.
   */
  public resolve(broadphase: PhysicsBroadphase): Object3D[] {
    const clamped: Object3D[] = [];
    for (let i = 0; i < this._candidates.length; i++) {
      const candidate = this._candidates[i]!;
      const { obj, prevPos, delta, broadRadius } = candidate;

      const sweptMin = MathPool.acquireVector().set(
        Math.min(prevPos.x, prevPos.x + delta.x) - broadRadius,
        Math.min(prevPos.y, prevPos.y + delta.y) - broadRadius,
        Math.min(prevPos.z, prevPos.z + delta.z) - broadRadius,
      );
      const sweptMax = MathPool.acquireVector().set(
        Math.max(prevPos.x, prevPos.x + delta.x) + broadRadius,
        Math.max(prevPos.y, prevPos.y + delta.y) + broadRadius,
        Math.max(prevPos.z, prevPos.z + delta.z) + broadRadius,
      );

      this._scratchBox.min.copyFrom(sweptMin);
      this._scratchBox.max.copyFrom(sweptMax);
      this._scratchBox.center.copyFrom(sweptMin).add(sweptMax).scale(0.5);

      this._queryHits.length = 0;
      broadphase.queryVolume(this._scratchBox, this._queryHits);

      MathPool.releaseVector(sweptMin);
      MathPool.releaseVector(sweptMax);

      let earliestToi = 1;
      for (let j = 0; j < this._queryHits.length; j++) {
        const other = this._queryHits[j]!;
        if (other === obj || !other.bounds || !obj.bounds) continue;

        if (!PhysicsBroadphase.canCollide(obj, other)) continue;
        const isOtherTrigger = Boolean(
          other.isTrigger ||
          (other instanceof Object3D && (other.rigidBody?.isTrigger || other.rigidBody?.isSensor)),
        );
        if (isOtherTrigger) continue;

        const toi = Collision.sweep(obj.bounds, prevPos, delta, other.bounds);

        if (toi >= 0 && toi < earliestToi) {
          earliestToi = toi;
        }
      }

      if (earliestToi < 1) {
        const clampedToi = Math.min(1, earliestToi + CCD_CONTACT_OVERSHOOT);
        obj.position.copyFrom(delta).scale(clampedToi).add(prevPos);
        obj.updateMatrixWorld();
        obj.computeBounds();
        clamped.push(obj);
      }

      MathPool.releaseVector(prevPos);
      MathPool.releaseVector(delta);
    }

    this._candidates.length = 0;
    return clamped;
  }
}

/**
 * Backward compatibility alias for {@link SweptVolumeCCD}.
 */
export { SweptVolumeCCD as SweptSphereCCD };
