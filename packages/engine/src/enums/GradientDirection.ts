/**
 * Direction of a linear text gradient.
 */
export const GradientDirection = {
  HORIZONTAL: "horizontal",
  VERTICAL: "vertical",
  /** The direction assumed when none is specified. */
  DEFAULT: "horizontal",
} as const;

/** Type definition for GradientDirection. */
export type GradientDirection = (typeof GradientDirection)[keyof typeof GradientDirection];
