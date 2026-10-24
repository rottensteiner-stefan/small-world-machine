/**
 * Filtering algorithm for directional-light shadow maps (ADR 0043).
 */
export const ShadowMode = {
  /** Percentage-Closer Soft Shadows (WebGPU), fixed PCF on WebGL2. */
  PCSS: "pcss",
  /** Exponential Variance Shadow Mapping: filtered moments instead of tap counting. Opt-in. */
  EVSM: "evsm",
  /** The mode assumed when none is specified. */
  DEFAULT: "pcss",
} as const;

/** Type definition for ShadowMode. */
export type ShadowMode = (typeof ShadowMode)[keyof typeof ShadowMode];
