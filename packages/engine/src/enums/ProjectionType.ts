/**
 * Types of camera projections.
 */
export const ProjectionType = {
  /** Oblique projection. */
  OBLIQUE: "ObliqueProjection",
  /** Orthographic projection. */
  ORTHOGRAPHIC: "OrthographicProjection",
  /** Perspective projection. */
  PERSPECTIVE: "PerspectiveProjection",
  /** The projection assumed when none is specified. */
  DEFAULT: "PerspectiveProjection",
} as const;

/** Type definition for ProjectionType. */
export type ProjectionType = (typeof ProjectionType)[keyof typeof ProjectionType];
