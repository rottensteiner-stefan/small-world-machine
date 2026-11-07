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
  /** ACES filmic, Narkowicz 2015 fit (luminance curve only, no gamut matrices). */
  ACES_FILMIC: 3,
  /** Reinhard et al. 2002 extended operator on luminance: the white point maps to 1.0, hue preserved. */
  REINHARD_EXTENDED: 4,
  /** ACES RRT+ODT, Stephen Hill fit with sRGB<->AP1 matrices (Khronos glTF Sample Viewer "ACES Hill"). */
  ACES_HILL: 5,
  /** ACES Hill with the 1/0.6 exposure boost (Khronos glTF Sample Viewer "ACES Hill Exposure Boost"). */
  ACES_HILL_EXPOSURE_BOOST: 6,
  /** AgX (Sobotka; Blender 4 / Godot 4.4 default look), Wrensch minimal fit. */
  AGX: 7,
  /** Khronos PBR Neutral: base colors stay exact up to ~0.8, only highlights compress. */
  PBR_NEUTRAL: 8,
  /** The mode assumed when none is specified (forward `quality.toneMapping` and `ToneMappingElement`). */
  DEFAULT: 8,
} as const;

/** Type definition for ToneMappingMode. */
export type ToneMappingMode = (typeof ToneMappingMode)[keyof typeof ToneMappingMode];
