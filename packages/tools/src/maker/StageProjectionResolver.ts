import { Object3D, StageMovementBehavior, Ray } from "@small-world-machine/engine";
import { BackgroundPlane } from "./BackgroundPlane.js";

/** A resolved way to turn a zone's normalized (u, v) stage coordinate into a world position for
 * display/editing in Maker -- the same shape `StageMovementBehavior`'s own `"flat-plane"`
 * projection produces at runtime, so what's drawn in the editor matches what the scene actually
 * looks like when played. Also exposes its own plane (`planeOrigin`/`planeNormal`) and the
 * inverse mapping (`fromWorld`) so the zone-drawing tool can turn a mouse ray into a (u, v)
 * click, via `projectRayToUv` below. */
export interface StageUvProjection {
  toWorld(u: number, v: number): { x: number; y: number; z: number };
  fromWorld(point: { x: number; y: number; z: number }): { u: number; v: number };
  planeOrigin: { x: number; y: number; z: number };
  planeNormal: { x: number; y: number; z: number };
}

/**
 * Ray/plane intersection against `projection`'s own plane, converted straight to (u, v) --
 * `undefined` if the ray is (near-)parallel to the plane (looking exactly edge-on). Used by
 * Maker's click-to-draw tool and viewport point-dragging.
 */
export function projectRayToUv(
  ray: Ray,
  projection: StageUvProjection,
): { u: number; v: number } | undefined {
  const { planeOrigin: o, planeNormal: n } = projection;
  const denom = ray.direction.x * n.x + ray.direction.y * n.y + ray.direction.z * n.z;
  if (Math.abs(denom) < 0.00001) return undefined;

  const diffX = o.x - ray.origin.x;
  const diffY = o.y - ray.origin.y;
  const diffZ = o.z - ray.origin.z;
  const t = (diffX * n.x + diffY * n.y + diffZ * n.z) / denom;
  if (t < 0) return undefined;

  const point = {
    x: ray.origin.x + ray.direction.x * t,
    y: ray.origin.y + ray.direction.y * t,
    z: ray.origin.z + ray.direction.z * t,
  };
  return projection.fromWorld(point);
}

/**
 * Finds a usable (u, v) -> world projection for the current Maker scene, so `StageZoneGizmoManager`
 * and the zone-drawing tool can place/pick zone geometry in 3D space. Tries, in order:
 * 1. A `StageMovementBehavior` with a `"flat-plane"` projection anywhere in the scene -- the
 *    only kind of projection that's actual reconstructible data (see ADR 0016 `StageProjection`).
 * 2. A `BackgroundPlane` reference image (imported via `BackgroundImportPanel`) -- its own
 *    `width`/`height` plus its world position give the same kind of fixed linear mapping, before
 *    any `StageMovementBehavior` has even been created yet (e.g. a brand new scene).
 * Returns `undefined` if neither is found (e.g. an empty scene, or one that only has a `"custom"`
 * projection, which can't be resolved generically).
 */
export function resolveStageProjection(sceneRoot: Object3D): StageUvProjection | undefined {
  const behavior = findStageMovementBehavior(sceneRoot);
  if (behavior && "flat-plane" === behavior.projection.mode) {
    const { width, height, z, centerY } = behavior.projection;
    return {
      toWorld: (u, v) => ({ x: (u - 0.5) * width, y: centerY + (0.5 - v) * height, z }),
      fromWorld: (p) => ({ u: p.x / width + 0.5, v: 0.5 - (p.y - centerY) / height }),
      planeOrigin: { x: 0, y: centerY, z },
      planeNormal: { x: 0, y: 0, z: 1 },
    };
  }

  const plane = findBackgroundPlane(sceneRoot);
  if (plane) {
    plane.updateMatrixWorld();
    const origin = plane.getWorldPosition();
    const { width, height } = plane;
    return {
      toWorld: (u, v) => ({
        x: origin.x + (u - 0.5) * width,
        y: origin.y + (0.5 - v) * height,
        z: origin.z,
      }),
      fromWorld: (p) => ({
        u: (p.x - origin.x) / width + 0.5,
        v: 0.5 - (p.y - origin.y) / height,
      }),
      planeOrigin: { x: origin.x, y: origin.y, z: origin.z },
      planeNormal: { x: 0, y: 0, z: 1 },
    };
  }

  return undefined;
}

function findBackgroundPlane(obj: Object3D): BackgroundPlane | undefined {
  if (obj instanceof BackgroundPlane) return obj;
  for (const child of obj.children) {
    const found = findBackgroundPlane(child);
    if (found) return found;
  }
  return undefined;
}

function findStageMovementBehavior(obj: Object3D): StageMovementBehavior | undefined {
  for (const behavior of obj.behaviors) {
    if (behavior instanceof StageMovementBehavior) return behavior;
  }
  for (const child of obj.children) {
    const found = findStageMovementBehavior(child);
    if (found) return found;
  }
  return undefined;
}
