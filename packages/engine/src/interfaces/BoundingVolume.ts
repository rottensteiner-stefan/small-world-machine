import type { Matrix4, Vector3D } from "../math/index.js";
import type { BoundingType } from "../enums/index.js";
/**
 * Minimal interface for a Frustum to avoid circular dependencies.
 */
export interface FrustumInterface {
  planes: Float32Array;
}

/**
 * Interface for bounding volumes used for collision detection and culling.
 */
export interface BoundingVolume {
  /** The type of the bounding volume. */
  type: BoundingType;
  /** The center position of the volume in world space. */
  center: Vector3D;

  /**
   * Returns the radius of a sphere that fully encloses the volume.
   * Used for coarse broad-phase intersection tests.
   * @returns The broad radius.
   */
  getBroadRadius(): number;

  /**
   * Checks if this volume intersects with a frustum.
   * @param frustum The frustum to check against.
   * @returns True if intersecting.
   */
  intersectsFrustum(frustum: FrustumInterface): boolean;

  /**
   * Checks if this volume intersects with another volume.
   * @param other The other volume to check against.
   * @returns True if intersecting.
   */
  intersectsVolume(other: BoundingVolume): boolean;

  /**
   * Checks if this volume entirely contains another volume.
   * @param other The other volume to check against.
   * @returns True if entirely contained.
   */
  containsVolume(other: BoundingVolume): boolean;

  /**
   * Transforms the bounding volume by a matrix.
   * Typically used to move local geometry bounds into world space.
   * @param matrix The transformation matrix.
   */
  transform(matrix: Matrix4): void;
}
