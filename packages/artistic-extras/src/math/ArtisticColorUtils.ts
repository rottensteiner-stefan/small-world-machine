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
   * Evaluates the selective color mask factor [0..1] for a given RGB color. Mirrors the shaders
   * (`mr_rgb2hsv` + `smoothstep(tol, tol * 0.3, hueDiff) * smoothstep(0.2, 0.4, sat)` in
   * MetalRelief / MetalReliefScreen / MetalReliefPost): a factor of 1.0 means the color matches the
   * target accent hue (e.g. red), 0.0 means it is converted to industrial metal/rust.
   *
   * @param color Input RGB color
   * @param targetHue Target hue [0..1] (e.g. 0.0 for pure red)
   * @param tolerance Hue tolerance window [0..0.5] (shader default 0.09)
   */
  public static computeColorPopMask(
    color: Color | [number, number, number],
    targetHue: number = 0.0,
    tolerance: number = 0.09,
  ): number {
    const r = Array.isArray(color) ? color[0] : color.r;
    const g = Array.isArray(color) ? color[1] : color.g;
    const b = Array.isArray(color) ? color[2] : color.b;

    const hsv = this.rgbToHsv(r, g, b);
    const dist = this.hueDistance(hsv.h, targetHue);
    return (
      ArtisticColorUtils._smoothstep(tolerance, tolerance * 0.3, dist) *
      ArtisticColorUtils._smoothstep(0.2, 0.4, hsv.s)
    );
  }

  /**
   * Grades an achromatic luma value into the industrial metal/rust palette using the same ramp as
   * the shaders (`rustShadow` -> `steelMid` -> `zincHigh`, see `metalGrad` in MetalRelief*.frag.*).
   * Shadows get warm raw umber / rust tones, midtones cool steel, highlights zinc silver.
   *
   * @param luma Luminance value [0..1]
   * @param rustStrength Blend intensity for the rust tint in shadows [0..1]
   */
  public static gradeIndustrialMetal(
    luma: number,
    rustStrength: number = 0.75,
  ): [number, number, number] {
    const l = Math.max(0, Math.min(1, luma));
    const rust: [number, number, number] = [0.38, 0.22, 0.12];
    const steel: [number, number, number] = [0.52, 0.56, 0.6];
    const zinc: [number, number, number] = [0.88, 0.9, 0.94];
    const tMid = Math.max(0, Math.min(1, l * 2.2));
    const tHigh = Math.max(0, Math.min(1, (l - 0.45) * 2.2));

    const out: [number, number, number] = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      const rustShadow = rust[c]! * rustStrength + l * 0.6 * (1 - rustStrength);
      const mid = rustShadow + (steel[c]! * l - rustShadow) * tMid;
      out[c] = mid + (zinc[c]! * l - mid) * tHigh;
    }
    return out;
  }

  /** GLSL/WGSL `smoothstep` incl. the reversed-edge case used by the hue mask. */
  private static _smoothstep(e0: number, e1: number, x: number): number {
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  }
}
