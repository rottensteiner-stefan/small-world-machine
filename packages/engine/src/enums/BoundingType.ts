/**
 * Types of bounding volumes.
 */
export const BoundingType = {
  /** Axis-aligned bounding box. */
  BOX: 1,
  /** Bounding sphere. */
  SPHERE: 0,
  /** Oriented bounding box. */
  OBB: 2,
  /** Arbitrary convex polyhedron (face/vertex list), e.g. a Voronoi fracture shard. */
  HULL: 3,
} as const;

/** Type definition for BoundingType. */
export type BoundingType = (typeof BoundingType)[keyof typeof BoundingType];
