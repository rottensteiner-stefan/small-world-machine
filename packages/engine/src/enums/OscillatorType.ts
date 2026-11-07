/**
 * Defines the mathematical function used by an oscillator.
 */
export const OscillatorType = {
  SINE: "sine",
  COSINE: "cosine",
  NOISE: "noise",
  /** The function assumed when none is specified. */
  DEFAULT: "sine",
} as const;

/** Type definition for OscillatorType. */
export type OscillatorType = (typeof OscillatorType)[keyof typeof OscillatorType];
