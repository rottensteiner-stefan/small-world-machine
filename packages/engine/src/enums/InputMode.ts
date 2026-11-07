/**
 * Defines how the horizontal input keys (A/D) behave.
 */
export const InputMode = {
  /** A/D keys move the object/camera sideways. */
  STRAFE: "strafe",
  /** A/D keys rotate the object/camera left/right (Tank Controls). */
  TANK: "tank",
  /** The mode assumed when none is specified. */
  DEFAULT: "tank",
} as const;

/**
 * Type for InputMode values.
 */
export type InputMode = (typeof InputMode)[keyof typeof InputMode];
