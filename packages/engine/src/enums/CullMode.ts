/**
 * Culling modes for rendering.
 */
export const CullMode = {
  /** Cull back faces. */
  BACK: "back",
  /** Cull front faces. */
  FRONT: "front",
  /** No culling. */
  NONE: "none",
  /** The culling mode assumed when none is specified. */
  DEFAULT: "back",
} as const;

/** Type definition for CullMode. */
export type CullMode = (typeof CullMode)[keyof typeof CullMode];
