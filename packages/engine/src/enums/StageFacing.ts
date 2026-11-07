/**
 * Initial facing of an actor on a 2.5D stage (see `StageMovementBehavior`).
 */
export const StageFacing = {
  LEFT: "left",
  RIGHT: "right",
  /** Facing the camera. */
  FRONT: "front",
  /** Facing away from the camera. */
  BACK: "back",
  /** The facing assumed when none is specified. */
  DEFAULT: "front",
} as const;

/** Type definition for StageFacing. */
export type StageFacing = (typeof StageFacing)[keyof typeof StageFacing];
