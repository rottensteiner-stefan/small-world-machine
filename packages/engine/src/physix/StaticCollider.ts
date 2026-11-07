import type { Collidable, BoundingVolume } from "../interfaces/index.js";

let _nextColliderId = 10000000;

/**
 * A lightweight collision object that avoids the overhead of a full Object3D.
 * Used for inserting static obstacles (like grid walls) into a SpatialHash.
 */
export class StaticCollider implements Collidable {
  /** Resets the static collider ID generator (useful for deterministic tests). */
  public static resetNextId(): void {
    _nextColliderId = 10000000;
  }

  public id: number = _nextColliderId++;
  public bounds: BoundingVolume | undefined;

  /** Coulomb contact friction coefficient (0.0 = ice, 1.0 = high grip). */
  public friction: number = 0.5;
  /** Restitution / bounciness (0.0 = clay, 1.0 = superball). */
  public restitution: number = 0.2;

  /** 32-bit collision layer bitmask this collider belongs to (default: 1). */
  public collisionLayer: number = 1;
  /** 32-bit collision mask specifying which layers this collider interacts with (default: 0xFFFFFFFF). */
  public collisionMask: number = 0xffffffff;
  /** If true, this collider acts as a trigger/sensor (fires trigger events without physical force). */
  public isTrigger: boolean = false;

  // To allow InteractionManager to filter out non-pickable hits
  public isPickable: boolean = true;

  constructor(bounds?: BoundingVolume) {
    this.bounds = bounds;
  }
}
