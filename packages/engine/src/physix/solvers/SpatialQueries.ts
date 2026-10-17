import { Object3D } from "../../core/Object3D.js";
import { Vector3D, MathPool } from "../../math/index.js";
import { Collision } from "../Collision.js";
import type { Collidable } from "../../interfaces/index.js";
import { BoundingBox } from "../BoundingBox.js";
import { BoundingSphere } from "../BoundingSphere.js";
import type { OBB } from "../OBB.js";
import { BoundingType } from "../../enums/index.js";
import type { PhysicsBroadphase } from "../broadphase/PhysicsBroadphase.js";
import type { Ray } from "../Ray.js";
import type { RaycastHit } from "../RaycastHit.js";

/**
 * Spatial query operations (raycast / raycastAll / sphereCast) against the broadphase tree.
 *
 * Owns its own reusable broadphase query buffer and keeps the trigger-filter logic in one
 * place, so the owner system only delegates to this service.
 */
export class SpatialQueries {
  private readonly _queryHits: Collidable[] = [];
  private readonly _scratchSweptBox: BoundingBox = new BoundingBox();
  private readonly _scratchSweepSphere: BoundingSphere = new BoundingSphere(new Vector3D(), 0);
  private readonly _scratchHit: RaycastHit = {
    distance: 0,
    point: new Vector3D(),
    normal: new Vector3D(),
    collider: null as unknown as Collidable,
  };

  constructor(private readonly _broadphase: PhysicsBroadphase) {}

  private _isTriggerCollider(c: Collidable): boolean {
    return Boolean(
      c.isTrigger || (c instanceof Object3D && (c.rigidBody?.isTrigger || c.rigidBody?.isSensor)),
    );
  }

  /**
   * Casts a ray against all active colliders in the scene, returning the closest hit.
   * @param ray The ray to cast.
   * @param maxDistance Maximum travel distance (default: Infinity).
   * @param mask 32-bit collision layer mask filter (default: 0xFFFFFFFF).
   * @param outHit Optional RaycastHit object receiving the hit details.
   * @param ignoreTriggers If true, ignores sensor/trigger colliders (default: true).
   * @returns RaycastHit or null if nothing was hit within maxDistance.
   */
  public raycast(
    ray: Ray,
    maxDistance: number = Infinity,
    mask: number = 0xffffffff,
    outHit?: RaycastHit,
    ignoreTriggers: boolean = true,
  ): RaycastHit | null {
    this._queryHits.length = 0;
    this._broadphase.queryRay(ray, this._queryHits, mask);

    let closestT = maxDistance;
    let closestCollider: Collidable | null = null;
    const hitPt = MathPool.acquireVector();
    const hitNorm = MathPool.acquireVector();
    const bestPt = MathPool.acquireVector();
    const bestNorm = MathPool.acquireVector();

    for (let i = 0; i < this._queryHits.length; i++) {
      const c = this._queryHits[i]!;
      if (!c.bounds) continue;
      if (ignoreTriggers && this._isTriggerCollider(c)) continue;

      const t = ray.intersectVolumeDetailed(c.bounds, hitPt, hitNorm);
      if (t >= 0 && t <= closestT) {
        closestT = t;
        closestCollider = c;
        bestPt.copyFrom(hitPt);
        bestNorm.copyFrom(hitNorm);
      }
    }

    MathPool.releaseVector(hitPt);
    MathPool.releaseVector(hitNorm);

    if (closestCollider !== null && closestT <= maxDistance) {
      const hit = outHit ?? this._scratchHit;
      hit.distance = closestT;
      hit.point.copyFrom(bestPt);
      hit.normal.copyFrom(bestNorm);
      hit.collider = closestCollider;
      if (closestCollider instanceof Object3D) {
        hit.object = closestCollider;
      } else {
        delete hit.object;
      }

      MathPool.releaseVector(bestPt);
      MathPool.releaseVector(bestNorm);
      return hit;
    }

    MathPool.releaseVector(bestPt);
    MathPool.releaseVector(bestNorm);
    return null;
  }

  /**
   * Casts a ray against all active colliders and returns all hits sorted by distance ascending.
   * @param ray The ray to cast.
   * @param maxDistance Maximum travel distance.
   * @param mask 32-bit collision layer mask filter.
   * @param outHits Optional array receiving the results.
   * @param ignoreTriggers If true, ignores sensor/trigger colliders.
   * @returns Array of RaycastHit objects sorted by distance ascending.
   */
  public raycastAll(
    ray: Ray,
    maxDistance: number = Infinity,
    mask: number = 0xffffffff,
    outHits?: RaycastHit[],
    ignoreTriggers: boolean = true,
  ): RaycastHit[] {
    const hits = outHits ?? [];
    hits.length = 0;

    this._queryHits.length = 0;
    this._broadphase.queryRay(ray, this._queryHits, mask);

    const hitPt = MathPool.acquireVector();
    const hitNorm = MathPool.acquireVector();

    for (let i = 0; i < this._queryHits.length; i++) {
      const c = this._queryHits[i]!;
      if (!c.bounds) continue;
      if (ignoreTriggers && this._isTriggerCollider(c)) continue;

      const t = ray.intersectVolumeDetailed(c.bounds, hitPt, hitNorm);
      if (t >= 0 && t <= maxDistance) {
        hits.push({
          distance: t,
          point: new Vector3D(hitPt.x, hitPt.y, hitPt.z),
          normal: new Vector3D(hitNorm.x, hitNorm.y, hitNorm.z),
          collider: c,
          ...(c instanceof Object3D ? { object: c } : {}),
        });
      }
    }

    MathPool.releaseVector(hitPt);
    MathPool.releaseVector(hitNorm);

    hits.sort((a, b) => a.distance - b.distance);
    return hits;
  }

  /**
   * Sweeps a sphere along a direction vector against all active colliders in the scene.
   * @param origin Starting center position of the swept sphere.
   * @param radius Radius of the sphere.
   * @param direction Direction vector of the sweep.
   * @param maxDistance Maximum travel distance along direction.
   * @param mask 32-bit collision layer mask filter (default: 0xFFFFFFFF).
   * @param outHit Optional RaycastHit object receiving the hit details.
   * @param ignoreTriggers If true, ignores sensor/trigger colliders (default: true).
   * @returns RaycastHit or null if no obstacle was struck.
   */
  public sphereCast(
    origin: Vector3D,
    radius: number,
    direction: Vector3D,
    maxDistance: number = Infinity,
    mask: number = 0xffffffff,
    outHit?: RaycastHit,
    ignoreTriggers: boolean = true,
  ): RaycastHit | null {
    this._scratchSweepSphere.center.copyFrom(origin);
    this._scratchSweepSphere.radius = radius;
    const sweepSphere = this._scratchSweepSphere;
    const delta = MathPool.acquireVector().copyFrom(direction);
    const dirLen = delta.length();
    const distanceLimit = Number.isFinite(maxDistance) ? maxDistance : 100000;
    if (dirLen > 1e-8) {
      delta.scale(distanceLimit / dirLen);
    }

    const sweptMin = MathPool.acquireVector().set(
      Math.min(origin.x, origin.x + delta.x) - radius,
      Math.min(origin.y, origin.y + delta.y) - radius,
      Math.min(origin.z, origin.z + delta.z) - radius,
    );
    const sweptMax = MathPool.acquireVector().set(
      Math.max(origin.x, origin.x + delta.x) + radius,
      Math.max(origin.y, origin.y + delta.y) + radius,
      Math.max(origin.z, origin.z + delta.z) + radius,
    );

    this._scratchSweptBox.min.copyFrom(sweptMin);
    this._scratchSweptBox.max.copyFrom(sweptMax);
    this._queryHits.length = 0;
    this._broadphase.queryVolume(this._scratchSweptBox, this._queryHits, mask);

    MathPool.releaseVector(sweptMin);
    MathPool.releaseVector(sweptMax);

    let earliestToi = 1.0;
    let closestCollider: Collidable | null = null;

    for (let i = 0; i < this._queryHits.length; i++) {
      const c = this._queryHits[i]!;
      if (!c.bounds) continue;
      if (ignoreTriggers && this._isTriggerCollider(c)) continue;

      const toi = Collision.sweep(sweepSphere, origin, delta, c.bounds);
      if (toi >= 0 && toi <= earliestToi) {
        earliestToi = toi;
        closestCollider = c;
      }
    }

    if (closestCollider !== null && earliestToi <= 1.0) {
      const hitDistance = earliestToi * distanceLimit;
      const hit = outHit ?? this._scratchHit;
      hit.distance = hitDistance;
      hit.point.copyFrom(delta).scale(earliestToi).add(origin);
      hit.collider = closestCollider;
      if (closestCollider instanceof Object3D) {
        hit.object = closestCollider;
      } else {
        delete hit.object;
      }

      if (closestCollider.bounds) {
        const bounds = closestCollider.bounds;
        if (bounds.type === BoundingType.BOX) {
          const box = bounds as BoundingBox;
          const dxMin = Math.abs(hit.point.x - box.min.x);
          const dxMax = Math.abs(hit.point.x - box.max.x);
          const dyMin = Math.abs(hit.point.y - box.min.y);
          const dyMax = Math.abs(hit.point.y - box.max.y);
          const dzMin = Math.abs(hit.point.z - box.min.z);
          const dzMax = Math.abs(hit.point.z - box.max.z);

          const minD = Math.min(dxMin, dxMax, dyMin, dyMax, dzMin, dzMax);
          if (minD === dxMin) hit.normal.set(-1, 0, 0);
          else if (minD === dxMax) hit.normal.set(1, 0, 0);
          else if (minD === dyMin) hit.normal.set(0, -1, 0);
          else if (minD === dyMax) hit.normal.set(0, 1, 0);
          else if (minD === dzMin) hit.normal.set(0, 0, -1);
          else hit.normal.set(0, 0, 1);
        } else if (bounds.type === BoundingType.OBB) {
          const obb = bounds as OBB;
          const localHit = MathPool.acquireVector().copyFrom(hit.point).sub(obb.center);
          const lx = localHit.dot(obb.axes[0]!);
          const ly = localHit.dot(obb.axes[1]!);
          const lz = localHit.dot(obb.axes[2]!);
          MathPool.releaseVector(localHit);

          const hx = obb.halfExtents.x;
          const hy = obb.halfExtents.y;
          const hz = obb.halfExtents.z;

          const dxMin = Math.abs(lx + hx);
          const dxMax = Math.abs(lx - hx);
          const dyMin = Math.abs(ly + hy);
          const dyMax = Math.abs(ly - hy);
          const dzMin = Math.abs(lz + hz);
          const dzMax = Math.abs(lz - hz);

          const minD = Math.min(dxMin, dxMax, dyMin, dyMax, dzMin, dzMax);
          if (minD === dxMin) hit.normal.copyFrom(obb.axes[0]!).scale(-1);
          else if (minD === dxMax) hit.normal.copyFrom(obb.axes[0]!);
          else if (minD === dyMin) hit.normal.copyFrom(obb.axes[1]!).scale(-1);
          else if (minD === dyMax) hit.normal.copyFrom(obb.axes[1]!);
          else if (minD === dzMin) hit.normal.copyFrom(obb.axes[2]!).scale(-1);
          else hit.normal.copyFrom(obb.axes[2]!);
        } else {
          hit.normal.copyFrom(hit.point).sub(bounds.center);
          const nLen = hit.normal.length();
          if (nLen > 1e-8) {
            hit.normal.scale(1.0 / nLen);
          } else {
            hit.normal.copyFrom(direction).scale(-1).normalize();
          }
        }
      }

      MathPool.releaseVector(delta);
      return hit;
    }

    MathPool.releaseVector(delta);
    return null;
  }
}
