/**
 * How a pipeline interacts with the normal buffer render target (ADR 0028).
 */
export const NormalTargetMode = {
  /** The pipeline has a single color target and no normal output. */
  NONE: "none",
  /** The pipeline writes the shading normal into the second color target. */
  WRITE: "write",
  /** Like `WRITE`, but alpha-blended by the fragment alpha (decals blending their normal onto the buffer). */
  BLEND: "blend",
  /** The pass has a normal attachment, but this pipeline must leave it untouched (transparents). */
  MASKED: "masked",
  /** The mode assumed when none is specified. */
  DEFAULT: "none",
} as const;

/** Type definition for NormalTargetMode. */
export type NormalTargetMode = (typeof NormalTargetMode)[keyof typeof NormalTargetMode];
