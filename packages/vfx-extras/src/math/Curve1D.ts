/**
 * Curve1DPoint is a single keyframe of a {@link Curve1D}: normalized lifetime `t` (in [0, 1])
 * maps to a raw caller-unit value.
 */
export interface Curve1DPoint {
  /** @domain Normalized lifetime in [0, 1]; values outside are clamped on insert. */
  t: number;
  /** @domain Raw value in caller units (may be negative). */
  value: number;
}

/**
 * Zero-allocation piecewise-linear curve over normalized lifetime `t` in [0, 1].
 *
 * The internal key storage is fixed at construction (`capacity`). `setPoints()` rebuilds the
 * sorted, deduplicated key table in place; `evaluate()` is pure typed-array access and a segment
 * lerp -- no heap allocation on the hot path. Out-of-range `t` is hard-clamped, never
 * extrapolated, and evaluation at a key returns the key value bit-exact
 * (`@invariant LIFETIME-CURVE-KEY-EXACTNESS: evaluate(keys[i]) === values[i]`).
 *
 * Determinism: identical inputs and `t` produce bit-identical output on any engine (float32 math
 * only), matching the golden-capture discipline of the fire emitters.
 */
export class Curve1D {
  private readonly _keys: Float32Array;
  private readonly _values: Float32Array;
  private _count = 0;

  /**
   * @param capacity Maximum number of keyframes; @fixed internal pool size. Defaults to 64.
   */
  constructor(capacity: number = 64) {
    this._keys = new Float32Array(capacity);
    this._values = new Float32Array(capacity);
  }

  /**
   * Replaces the key table. `t` is clamped to [0, 1], non-finite points are skipped, and points
   * beyond `capacity` are dropped. After sorting, duplicate `t` keys collapse to the last value.
   */
  public setPoints(points: readonly Curve1DPoint[]): void {
    const keys = this._keys;
    const values = this._values;
    const capacity = keys.length;
    let n = 0;
    for (let i = 0; i < points.length && n < capacity; i++) {
      const p = points[i]!;
      if (!Number.isFinite(p.t) || !Number.isFinite(p.value)) {
        continue;
      }
      keys[n] = Math.min(1, Math.max(0, p.t));
      values[n] = p.value;
      n++;
    }

    // Insertion sort (capacity is small, setup-time only, no temp allocation).
    for (let i = 1; i < n; i++) {
      const tk = keys[i]!;
      const tv = values[i]!;
      let j = i - 1;
      while (j >= 0 && keys[j]! > tk) {
        keys[j + 1] = keys[j]!;
        values[j + 1] = values[j]!;
        j--;
      }
      keys[j + 1] = tk;
      values[j + 1] = tv;
    }

    // Collapse duplicate t, keeping the last inserted value.
    let w = 0;
    for (let i = 0; i < n; i++) {
      if (w > 0 && keys[w - 1]! === keys[i]!) {
        values[w - 1] = values[i]!;
        continue;
      }
      if (w !== i) {
        keys[w] = keys[i]!;
        values[w] = values[i]!;
      }
      w++;
    }
    this._count = w;
  }

  /**
   * Evaluates the curve at normalized lifetime `t`. Hard-clamped to [0, 1]; a key input returns
   * the stored value bit-exact, an empty curve returns 0.
   * @param t @domain Normalized lifetime; clamped, never extrapolated.
   */
  public evaluate(t: number): number {
    const n = this._count;
    if (n === 0) {
      return 0;
    }
    const keys = this._keys;
    const values = this._values;
    if (t <= keys[0]!) {
      return values[0]!;
    }
    if (t >= keys[n - 1]!) {
      return values[n - 1]!;
    }
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (keys[mid]! <= t) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    const t0 = keys[lo]!;
    const t1 = keys[hi]!;
    const v0 = values[lo]!;
    const v1 = values[hi]!;
    // Exact-key short-circuits keep the segment-exactness invariant bit-exact at interior keys.
    if (t === t0) {
      return v0;
    }
    if (t === t1) {
      return v1;
    }
    return v0 + (v1 - v0) * ((t - t0) / (t1 - t0));
  }

  /** @derived Lowest control value. Returns 0 when the curve is empty. */
  public get minValue(): number {
    let min = 0;
    for (let i = 0; i < this._count; i++) {
      const v = this._values[i]!;
      if (i === 0 || v < min) {
        min = v;
      }
    }
    return min;
  }

  /** @derived Highest control value. Returns 0 when the curve is empty. */
  public get maxValue(): number {
    let max = 0;
    for (let i = 0; i < this._count; i++) {
      const v = this._values[i]!;
      if (i === 0 || v > max) {
        max = v;
      }
    }
    return max;
  }

  /** @derived Number of keyframes currently stored. */
  public get pointCount(): number {
    return this._count;
  }

  /** Deep copy with the same capacity. */
  public clone(): Curve1D {
    const copy = new Curve1D(this._keys.length);
    const points: Curve1DPoint[] = [];
    for (let i = 0; i < this._count; i++) {
      points.push({ t: this._keys[i]!, value: this._values[i]! });
    }
    copy.setPoints(points);
    return copy;
  }
}
