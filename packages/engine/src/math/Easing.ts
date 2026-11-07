/**
 * Common easing curves, each mapping a normalized progress `t` in [0, 1] to an eased progress
 * in [0, 1]. Feed the result into `MathUtils.lerp`/`Vector3D.lerp`/`Quaternion.slerp` instead of
 * hand-rolling a damping curve at each call site.
 */
export class Easing {
  /** No easing, straight-line progress. */
  public static linear(t: number): number {
    return t;
  }

  /** Cubic Hermite curve with zero first-derivative at both ends. */
  public static smoothstep(t: number): number {
    return t * t * (3 - 2 * t);
  }

  public static easeInQuad(t: number): number {
    return t * t;
  }

  public static easeOutQuad(t: number): number {
    return t * (2 - t);
  }

  public static easeInOutQuad(t: number): number {
    return 0.5 > t ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }

  public static easeInCubic(t: number): number {
    return t * t * t;
  }

  public static easeOutCubic(t: number): number {
    const inv: number = t - 1;
    return inv * inv * inv + 1;
  }

  public static easeInOutCubic(t: number): number {
    return 0.5 > t ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1;
  }

  public static easeInSine(t: number): number {
    return 1 - Math.cos((t * Math.PI) / 2);
  }

  public static easeOutSine(t: number): number {
    return Math.sin((t * Math.PI) / 2);
  }

  public static easeInOutSine(t: number): number {
    return -(Math.cos(Math.PI * t) - 1) / 2;
  }
}
