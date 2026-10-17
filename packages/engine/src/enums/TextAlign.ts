/**
 * Horizontal text alignment (values match the canvas `textAlign` keywords).
 */
export const TextAlign = {
  LEFT: "left",
  CENTER: "center",
  RIGHT: "right",
  /** The alignment assumed when none is specified. */
  DEFAULT: "center",
} as const;

/** Type definition for TextAlign. */
export type TextAlign = (typeof TextAlign)[keyof typeof TextAlign];
