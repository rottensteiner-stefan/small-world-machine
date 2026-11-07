import { Vector2D } from "./Vector2D.js";

/** Coefficients for Cauchy's dispersion equation: n(lambda) = a + b / lambda^2. */
export interface CauchyCoefficients {
  a: number;
  b: number;
}

/**
 * Approximate Cauchy coefficients for common optical materials -- good enough for real-looking
 * visual dispersion (correct color ordering, plausible spread), not spectroscopy-grade precision.
 * `b` is in micrometres^2, matching `Optics.cauchyIndex()`'s convention.
 */
export const CauchyMaterials = {
  /** Dense flint glass: high dispersion, ~1.63 (red) to ~1.69 (violet) across the visible range. */
  FLINT_GLASS: { a: 1.6, b: 0.014 } as CauchyCoefficients,
  /** BK7-like crown glass: noticeably lower dispersion than flint, ~1.51-1.53 across the visible
   * range. */
  CROWN_GLASS: { a: 1.5, b: 0.0042 } as CauchyCoefficients,
  /** Fluorite (CaF2): very low dispersion, ~1.43-1.45 across the visible range -- used in real
   * apochromatic camera lenses specifically to minimize chromatic aberration. */
  FLUORITE: { a: 1.42, b: 0.0035 } as CauchyCoefficients,
} as const;

/**
 * Physically-based optics helpers: vector Snell's law refraction and Cauchy dispersion, for any
 * effect that needs a *real* refracted ray direction (a prism, a lens preview, chromatic
 * aberration) instead of a hand-placed decorative angle. 2D-only for now (extracted from
 * `apps/showcases/28`'s prism dispersion, its one proven use case) -- add a `Vector3D` overload only
 * once a second, real 3D use case needs it.
 */
export class Optics {
  /**
   * Vector form of Snell's law (same convention as GLSL's built-in `refract()`): both `incident`
   * and `normal` must be unit vectors, with `normal` pointing back against `incident` (toward the
   * medium the ray arrived from). Returns `undefined` on total internal reflection.
   * @param incident Unit incident ray direction.
   * @param normal Unit surface normal, pointing against `incident`.
   * @param n1 Refractive index of the medium the ray is leaving.
   * @param n2 Refractive index of the medium the ray is entering.
   * @param target Optional Vector2D to store the refracted ray direction in, avoiding allocation.
   */
  public static refract(
    incident: Vector2D,
    normal: Vector2D,
    n1: number,
    n2: number,
    target?: Vector2D,
  ): Vector2D | undefined {
    const eta = n1 / n2;
    const cosI = -(incident.x * normal.x + incident.y * normal.y);
    const sinT2 = eta * eta * (1 - cosI * cosI);
    if (sinT2 > 1) return undefined; // total internal reflection
    const cosT = Math.sqrt(1 - sinT2);
    const k = eta * cosI - cosT;
    const x = incident.x * eta + normal.x * k;
    const y = incident.y * eta + normal.y * k;
    if (target) {
      target.x = x;
      target.y = y;
      return target;
    }
    return new Vector2D(x, y);
  }

  /**
   * Cauchy's dispersion equation: n(lambda) = a + b / lambda^2. See {@link CauchyMaterials} for
   * ready-made material coefficients.
   * @param wavelengthNm Wavelength in nanometres (e.g. ~700 for red, ~400 for violet).
   * @param coefficients The material's Cauchy `a`/`b` coefficients.
   */
  public static cauchyIndex(wavelengthNm: number, coefficients: CauchyCoefficients): number {
    const lambdaUm = wavelengthNm / 1000;
    return coefficients.a + coefficients.b / (lambdaUm * lambdaUm);
  }
}
