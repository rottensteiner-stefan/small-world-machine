import type { BoundingVolume } from "./BoundingVolume.js";

/**
 * Interface for objects that can be tested for physical collisions.
 * Decouples collision detection from the heavy Object3D class.
 */
export interface Collidable {
  /** Optional integer identifier for deterministic physics solver sorting and netcode lockstep. */
  id?: number;
  /**
   * Explicit opt-out: `false` means the object may own bounds for culling (Decal, FogVolume)
   * but must never act as an obstacle/hit in volume queries. Absent or `true` means collidable.
   */
  isCollidable?: boolean;
  /** The physical bounding volume of the object. */
  bounds: BoundingVolume | undefined;
  /** 32-bit collision layer bitmask this collider belongs to (default: 1). */
  collisionLayer?: number;
  /** 32-bit collision mask specifying which layers this collider interacts with (default: 0xFFFFFFFF). */
  collisionMask?: number;
  /** If true, the collider acts as a sensor/trigger (detects overlap and fires events without physical force). */
  isTrigger?: boolean;
}
