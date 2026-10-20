import type { Color } from "@small-world-machine/engine";

export interface HsvColor {
  h: number; // [0, 1]
  s: number; // [0, 1]
  v: number; // [0, 1]
}

/**
 * Utility functions for color space manipulation, selective color isolation (color-pop),
 * and painterly rust/steel tone-mapping.
 */
export class ArtisticColorUtils {
  /**
   * Converts RGB [0..1] to HSV [0..1].
   */
  public static rgbToHsv(r: number, g: number, b: number): HsvColor {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    let h = 0;

    if (delta > 0.00001) {
      if (max === r) {
        h = ((g - b) / delta) % 6;
      } else if (max === g) {
        h = (b - r) / delta + 2;
      } else {
        h = (r - g) / delta + 4;
      }
      h /= 6;
      if (h < 0) {
        h += 1;
      }
    }

    const s = max <= 0.00001 ? 0 : delta / max;
    const v = max;

    return { h, s, v };
  }

  /**
   * Converts HSV [0..1] to RGB [0..1].
   */
  public static hsvToRgb(h: number, s: number, v: number): [number, number, number] {
    if (s <= 0.00001) {
      return [v, v, v];
    }

    const hScaled = (h % 1) * 6;
    const i = Math.floor(hScaled);
    const f = hScaled - i;
    const p = v * (1 - s);
    const q = v * (1 - s * f);
    const t = v * (1 - s * (1 - f));

    switch (i) {
      case 0:
        return [v, t, p];
      case 1:
        return [q, v, p];
      case 2:
        return [p, v, t];
      case 3:
        return [p, q, v];
      case 4:
        return [t, p, v];
      default:
        return [v, p, q];
    }
  }

  /**
   * Computes the cyclic angular distance between two normalized hues in [0, 1].
   * The result is in [0, 0.5].
   */
  public static hueDistance(h1: number, h2: number): number {
    const diff = Math.abs((h1 % 1) - (h2 % 1));
    return Math.min(diff, 1.0 - diff);
  }

  /**
   * Evaluates the selective color mask factor [0..1] for a given RGB color.
   * A factor of 1.0 means the color matches the target accent hue (e.g. red),
   * while 0.0 means it should be converted to industrial metal/rust.
   *
   * @param color Input RGB color
   * @param targetHue Target hue [0..1] (e.g. 0.0 for pure red)
   * @param tolerance Hue tolerance window [0..0.5] (e.g. 0.08)
   * @param minSaturation Minimum saturation needed to qualify as colored (default: 0.25)
   */
  public static computeColorPopMask(
    color: Color | [number, number, number],
    targetHue: number = 0.0,
    tolerance: number = 0.08,
    minSaturation: number = 0.25,
  ): number {
    const r = Array.isArray(color) ? color[0] : color.r;
    const g = Array.isArray(color) ? color[1] : color.g;
    const b = Array.isArray(color) ? color[2] : color.b;

    const hsv = this.rgbToHsv(r, g, b);
    if (hsv.s < minSaturation) {
      return 0.0;
    }

    const dist = this.hueDistance(hsv.h, targetHue);
    if (dist >= tolerance) {
      return 0.0;
    }

    // Smooth falloff towards the tolerance edge
    const edgeT = 1.0 - dist / tolerance;
    const satT = Math.min(1.0, (hsv.s - minSaturation) / 0.25);
    return edgeT * satT;
  }

  /**
   * Grades an achromatic/monochrome luma value into the industrial metal/rust palette.
   * Shadows get warm raw umber / rust tones, midtones get cool steel gray, and highlights get zinc silver.
   *
   * @param luma Luminance value [0..1]
   * @param rustStrength Blend intensity for the rust/sepia tint in shadows [0..1]
   */
  public static gradeIndustrialMetal(
    luma: number,
    rustStrength: number = 0.7,
  ): [number, number, number] {
    const clampedLuma = Math.max(0, Math.min(1, luma));

    // Shadow rust: [0.38, 0.22, 0.12]
    // Mid steel:   [0.55, 0.58, 0.62]
    // High zinc:   [0.90, 0.92, 0.95]
    const rustR = 0.38 * rustStrength + clampedLuma * (1 - rustStrength);
    const rustG = 0.22 * rustStrength + clampedLuma * (1 - rustStrength);
    const rustB = 0.12 * rustStrength + clampedLuma * (1 - rustStrength);

    const shadowMix = Math.max(0, 1.0 - clampedLuma * 2.0);
    const r = clampedLuma * 0.9 + shadowMix * (rustR - clampedLuma * 0.9);
    const g = clampedLuma * 0.92 + shadowMix * (rustG - clampedLuma * 0.92);
    const b = clampedLuma * 0.95 + shadowMix * (rustB - clampedLuma * 0.95);

    return [Math.max(0, Math.min(1, r)), Math.max(0, Math.min(1, g)), Math.max(0, Math.min(1, b))];
  }
}
