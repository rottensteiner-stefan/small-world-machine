/**
 * Primitive topologies for rendering.
 */
export const Topology = {
  /** A list of triangles. */
  TRIANGLE_LIST: "triangle-list",
  /** A list of lines. */
  LINE_LIST: "line-list",
  /** A list of points. */
  POINT_LIST: "point-list",
  /** A strip of lines. */
  LINE_STRIP: "line-strip",
  /** The topology assumed when none is specified. */
  DEFAULT: "triangle-list",
} as const;

/** Type definition for Topology. */
export type Topology = (typeof Topology)[keyof typeof Topology];
