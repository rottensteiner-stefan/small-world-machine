import type { Vector3D } from "../math/index.js";
import type { Collidable } from "../interfaces/index.js";
import type { Object3D } from "../core/Object3D.js";

/**
 * Result structure returned from a physics raycast or shape-cast query.
 */
export interface RaycastHit {
  /** Distance t from ray origin to the intersection point. */
  distance: number;
  /** Exact 3D world position where the ray or volume struck the surface. */
  point: Vector3D;
  /** Surface normal vector pointing outward from the struck surface. */
  normal: Vector3D;
  /** The hit Collidable entity (e.g., Object3D or StaticCollider). */
  collider: Collidable;
  /** The hit Object3D if the collider is an instance of Object3D. */
  object?: Object3D | undefined;
}
