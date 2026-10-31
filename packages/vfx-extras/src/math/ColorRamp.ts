import type { Color } from "@small-world-machine/engine";

/** A single color stop of a {@link ColorRamp}: normalized lifetime `t` in [0, 1] and an RGBA color. */
export interface ColorRampStop {
  /** @domain Normalized lifetime in [0, 1]; values outside are clamped on insert. */
  t: number;
  /** @domain RGBA color at this stop (linear space; sRGB conversion happens at the material). */
  color: Color;
}

/** Hard ceiling of stops a {@link ColorRamp} accepts; @fixed contract. */
export const COLOR_RAMP_MAX_STOPS = 8;

/**
 * Zero-allocation multi-stop RGBA ramp over normalized lifetime `t` in [0, 1].
 *
 * Stops are stored as float32 component arrays of fixed capacity (`COLOR_RAMP_MAX_STOPS`),
 * sorted by `t` on insert; duplicate `t` replaces the existing stop. `evaluateInto()` writes the
 * interpolated color into a caller-owned scratch `Color` -- no heap allocation on the hot path --
 * and is exact at every stop (`@invariant LIFETIME-CURVE-KEY-EXACTNESS`). Out-of-range `t` is
 * hard-clamped, never extrapolated.
 */
export class ColorRamp {
  private readonly _times: Float32Array;
  private readonly _r: Float32Array;
  private readonly _g: Float32Array;
  private readonly _b: Float32Array;
  private readonly _a: Float32Array;
  private _count = 0;

  constructor() {
    this._times = new Float32Array(COLOR_RAMP_MAX_STOPS);
    this._r = new Float32Array(COLOR_RAMP_MAX_STOPS);
    this._g = new Float32Array(COLOR_RAMP_MAX_STOPS);
    this._b = new Float32Array(COLOR_RAMP_MAX_STOPS);
    this._a = new Float32Array(COLOR_RAMP_MAX_STOPS);
  }

  /** Removes all stops. */
  public clear(): void {
    this._count = 0;
  }

  /**
   * Adds or replaces a stop. `t` is clamped to [0, 1]; a `t` already present is overwritten with
   * the new color; beyond `COLOR_RAMP_MAX_STOPS` the stop is ignored. The color components are
   * copied, so later mutation of the caller's `Color` does not leak into the ramp.
   */
  public addStop(t: number, color: Color): void {
    const time = Math.min(1, Math.max(0, t));
    for (let i = 0; i < this._count; i++) {
      if (this._times[i]! === time) {
        this._r[i] = color.r;
        this._g[i] = color.g;
        this._b[i] = color.b;
        this._a[i] = color.a;
        return;
      }
    }
    if (this._count >= COLOR_RAMP_MAX_STOPS) {
      return;
    }
    // Insert sorted by time (capacity is tiny, setup-time only).
    let pos = this._count;
    while (pos > 0 && this._times[pos - 1]! > time) {
      const prev = pos - 1;
      this._times[pos] = this._times[prev]!;
      this._r[pos] = this._r[prev]!;
      this._g[pos] = this._g[prev]!;
      this._b[pos] = this._b[prev]!;
      this._a[pos] = this._a[prev]!;
      pos = prev;
    }
    this._times[pos] = time;
    this._r[pos] = color.r;
    this._g[pos] = color.g;
    this._b[pos] = color.b;
    this._a[pos] = color.a;
    this._count++;
  }

  /** @derived Number of stops currently stored. */
  public get stopCount(): number {
    return this._count;
  }

  /**
   * Evaluates the ramp at normalized lifetime `t`, writing into the caller-owned `out` scratch
   * (the caller must not retain `out` across calls that overwrite it).
   * @param t @domain Normalized lifetime; clamped, never extrapolated.
   * @param out Caller-owned scratch receiving the interpolated RGBA color.
   */
  public evaluateInto(t: number, out: Color): void {
    const n = this._count;
    if (n === 0) {
      out.r = 1;
      out.g = 1;
      out.b = 1;
      out.a = 1;
      return;
    }
    const times = this._times;
    if (t <= times[0]!) {
      out.r = this._r[0]!;
      out.g = this._g[0]!;
      out.b = this._b[0]!;
      out.a = this._a[0]!;
      return;
    }
    if (t >= times[n - 1]!) {
      out.r = this._r[n - 1]!;
      out.g = this._g[n - 1]!;
      out.b = this._b[n - 1]!;
      out.a = this._a[n - 1]!;
      return;
    }
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (times[mid]! <= t) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    const t0 = times[lo]!;
    const t1 = times[hi]!;
    // Exact-stop short-circuits keep the segment-exactness invariant bit-exact at interior stops.
    if (t === t0) {
      out.r = this._r[lo]!;
      out.g = this._g[lo]!;
      out.b = this._b[lo]!;
      out.a = this._a[lo]!;
      return;
    }
    if (t === t1) {
      out.r = this._r[hi]!;
      out.g = this._g[hi]!;
      out.b = this._b[hi]!;
      out.a = this._a[hi]!;
      return;
    }
    const f = (t - t0) / (t1 - t0);
    out.r = this._r[lo]! + (this._r[hi]! - this._r[lo]!) * f;
    out.g = this._g[lo]! + (this._g[hi]! - this._g[lo]!) * f;
    out.b = this._b[lo]! + (this._b[hi]! - this._b[lo]!) * f;
    out.a = this._a[lo]! + (this._a[hi]! - this._a[lo]!) * f;
  }
}
