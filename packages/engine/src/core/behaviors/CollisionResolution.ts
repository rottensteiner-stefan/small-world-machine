import type { CameraInterfaceData, Collidable } from "../../interfaces/index.js";
import type { Object3D } from "../Object3D.js";
import type { Scene } from "../Scene.js";
import type { BoundingSphere } from "../../physix/index.js";
import { Collision } from "../../physix/index.js";
import { MathPool } from "../../math/index.js";
import { BoundingType } from "../../enums/index.js";

const _scratchHits: Collidable[] = [];

/**
 * Resolves sphere-vs-scene collisions for a character-style controller, pushing
 * `target.position` out of any overlapping static/dynamic/spatial-hash geometry.
 * Shared by FirstPersonController and FPSController.
 */
export function resolveSphereCollisions(
  collider: BoundingSphere | undefined,
  target: (Object3D | CameraInterfaceData) | undefined,
  scene: Scene | undefined,
  eyeHeight: number = 0.2, // Default resting height from old hardcoded +0.5 / r=0.7 logic
): void {
  if (!scene || !target || !collider) return;

  collider.center.copyFrom(target.position);
  // If the target is at eyeHeight, the sphere should rest exactly on the floor.
  // sphere bottom = center.y - radius = 0
  // center.y = target.position.y - eyeHeight + radius
  collider.center.y = target.position.y - eyeHeight + collider.radius;

  _scratchHits.length = 0;
  if (scene.staticOctree) scene.staticOctree.queryVolume(collider, _scratchHits);
  if (scene.spatialHash) scene.spatialHash.query(collider, _scratchHits);
  if (scene.dynamicOctree) scene.dynamicOctree.queryVolume(collider, _scratchHits);

  const correction = MathPool.acquireVector().set(0, 0, 0);
  const hitCorrection = MathPool.acquireVector();

  for (const obj of _scratchHits) {
    // Decals/fog volumes own OBB bounds for culling only; they are never obstacles.
    if (!obj.bounds || obj === target || obj.isCollidable === false) continue;
    let resolved: boolean;
    if (BoundingType.SPHERE === obj.bounds.type) {
      resolved = Collision.resolveSphereSphere(collider, obj.bounds, hitCorrection);
    } else {
      // Generic dispatch lets the solver handle OBB/ConvexHull colliders (which
      // `resolveSphereBox` cannot) instead of treating them as AABBs.
      resolved = Collision.resolve(collider, obj.bounds, hitCorrection);
    }

    if (resolved) {
      correction.add(hitCorrection);
      collider.center.add(hitCorrection); // update sphere center iteratively
    }
  }

  target.position.add(correction);
  MathPool.releaseVector(correction);
  MathPool.releaseVector(hitCorrection);
}
