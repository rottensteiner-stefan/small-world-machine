import type { Matrix4, Vector3D } from "../math/index.js";
import type { Ray } from "../physix/Ray.js";
import type { BoundingBox } from "../physix/BoundingBox.js";
import type { BoundingSphere } from "../physix/BoundingSphere.js";
import type { OBB } from "../physix/OBB.js";
import type { ConvexHull } from "../physix/ConvexHull.js";
import type { BoundingType } from "../enums/index.js";

/**
 * Minimal interface for a Frustum to avoid circular dependencies.
 */
export interface FrustumInterface {
  planes: Float32Array;
}

/**
 * Structural contract every bounding-volume class implements. The concrete classes
 * narrow `type` to a single literal, which is what turns the exported
 * {@link BoundingVolume} union into a usable discriminant (narrowing a value of type
 * `BoundingVolume` via `.type` yields the concrete class without any cast).
 */
export interface BoundingVolumeShape {
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

  /**
   * Computes a fresh axis-aligned bounding box that fully encloses this volume.
   * @returns The enclosing AABB.
   */
  getAabb(): BoundingBox;

  /**
   * Translates the volume in world space.
   * @param v The translation offset.
   */
  translate(v: Vector3D): void;

  /**
   * Tests whether a ray hits this volume.
   * @param ray The ray to test.
   * @returns True if the ray intersects the volume.
   */
  intersectsRay(ray: Ray): boolean;

  /**
   * Computes the outward-facing surface normal at a point on (or closest to) the
   * volume. The point is expected to lie on the volume's surface.
   * @param point The world-space point to sample.
   * @returns A unit-length outward normal.
   */
  surfaceNormalAt(point: Vector3D): Vector3D;

  /**
   * Computes the volume enclosed by this bounding volume (geometric volume).
   * @returns The enclosed volume.
   */
  volume(): number;

  /**
   * Computes the closest point on this volume to a given world-space point.
   * @param point The query point.
   * @returns The closest point on the volume.
   */
  closestPoint(point: Vector3D): Vector3D;

  /**
   * Creates a fresh, empty (default-initialized) volume of the same concrete type.
   * @returns The empty clone of the same class.
   */
  cloneEmpty(): BoundingVolume;

  /**
   * Configures the volume from a local-space center and half-extents (unscaled),
   * so a subsequent {@link BoundingVolumeShape.transform} places it in world space.
   * @param center The local-space center.
   * @param halfExtents The local-space half extents on each axis.
   */
  setFromLocal(center: Vector3D, halfExtents: Vector3D): void;
}

/**
 * Discriminated union of all concrete bounding volumes. The concrete classes declare a
 * literal `type` per class, so narrowing on `.type` yields the exact concrete type —
 * `as unknown as OBB`-style casts are no longer needed.
 */
export type BoundingVolume = BoundingBox | BoundingSphere | OBB | ConvexHull;
