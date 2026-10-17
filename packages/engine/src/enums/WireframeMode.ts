/**
 * Line sets a wireframe draws.
 */
export const WireframeMode = {
  /** Only the authored (structural) edges, e.g. quad outlines. */
  STRUCTURAL: "structural",
  /** Every triangle edge. */
  TRIANGLES: "triangles",
  /** The wireframe mode assumed when none is specified. */
  DEFAULT: "structural",
} as const;

/** Type definition for WireframeMode. */
export type WireframeMode = (typeof WireframeMode)[keyof typeof WireframeMode];
