/**
 * Texture filtering modes.
 */
export const TextureFilter = {
  /** Linear filtering (smooth). */
  LINEAR: "linear",
  /** Nearest-neighbor filtering (pixelated). */
  NEAREST: "nearest",
  /** Linear filtering with linear mipmap interpolation. */
  LINEAR_MIPMAP_LINEAR: "linear_mipmap_linear",
  /** Linear filtering with nearest mipmap. */
  LINEAR_MIPMAP_NEAREST: "linear_mipmap_nearest",
  /** Nearest filtering with linear mipmap interpolation. */
  NEAREST_MIPMAP_LINEAR: "nearest_mipmap_linear",
  /** Nearest filtering with nearest mipmap. */
  NEAREST_MIPMAP_NEAREST: "nearest_mipmap_nearest",
  /** The filter assumed when none is specified. */
  DEFAULT: "linear",
} as const;

/** Type definition for TextureFilter. */
export type TextureFilter = (typeof TextureFilter)[keyof typeof TextureFilter];
