/**
 * Layouts for cube map textures.
 */
export const CubeLayout = {
  /** Six individual images. */
  SIX_IMAGES: "six_images",
  /** 6x1 horizontal strip. */
  STRIP_HORIZONTAL: "strip_horizontal",
  /** 1x6 vertical strip. */
  STRIP_VERTICAL: "strip_vertical",
  /** 3x2 grid. */
  GRID_3X2: "grid_3x2",
  /** 4x3 horizontal cross. */
  CROSS_HORIZONTAL: "cross_horizontal",
  /** 3x4 vertical cross. */
  CROSS_VERTICAL: "cross_vertical",
  /** The layout assumed when none is specified. */
  DEFAULT: "six_images",
} as const;

/** Type definition for CubeLayout. */
export type CubeLayout = (typeof CubeLayout)[keyof typeof CubeLayout];
