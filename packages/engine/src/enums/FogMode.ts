/**
 * Defines the mathematical mode used for calculating fog density.
 */
export const FogMode = {
  /** No fog applied. */
  NONE: 0,
  /** Linear fog increasing between a near and far distance. */
  LINEAR: 1,
  /** Exponential fog simulating physical light scattering. */
  EXP: 2,
  /** Squared exponential fog for a sharper, more dramatic drop-off. */
  EXP2: 3,
  /** The mode assumed when none is specified. */
  DEFAULT: 3,
} as const;

/** Type definition for FogMode. */
export type FogMode = (typeof FogMode)[keyof typeof FogMode];
