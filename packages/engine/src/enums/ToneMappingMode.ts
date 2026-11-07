/**
 * Supported tone mapping algorithms.
 */
export const ToneMappingMode = {
  /** No tone mapping (Linear) */
  NONE: 0,
  /** Reinhard tone mapping */
  REINHARD: 1,
  /** Cineon tone mapping */
  CINEON: 2,
  /** ACES Filmic tone mapping */
  ACES_FILMIC: 3,
  /** The mode assumed when none is specified. */
  DEFAULT: 3,
} as const;

/** Type definition for ToneMappingMode. */
export type ToneMappingMode = (typeof ToneMappingMode)[keyof typeof ToneMappingMode];
