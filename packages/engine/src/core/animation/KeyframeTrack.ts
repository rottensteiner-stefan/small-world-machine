import type { Object3D } from "../Object3D.js";
import { Vector3D } from "../../math/Vector3D.js";
import { Quaternion } from "../../math/Quaternion.js";

export type TrackType = "translation" | "rotation" | "scale" | "weights";
export type InterpolationType = "LINEAR" | "STEP" | "CUBICSPLINE";

/**
 * Represents a single animation track animating a property of an Object3D/Bone over time.
 */
export class KeyframeTrack {
  public targetName: string;
  public property: TrackType;
  public times: Float32Array;
  public values: Float32Array;
  public interpolation: InterpolationType;
  public targetNode: Object3D | undefined;

  private _tempQuatA: Quaternion = new Quaternion();
  private _tempQuatB: Quaternion = new Quaternion();
  private _tempVecA: Vector3D = new Vector3D();
  private _tempVecB: Vector3D = new Vector3D();
  private _segment = { i0: 0, i1: 0, alpha: -1 };
  private _lastIndex: number = 0;

  constructor(
    targetName: string,
    property: TrackType,
    times: Float32Array,
    values: Float32Array,
    interpolation: InterpolationType = "LINEAR",
    targetNode?: Object3D,
  ) {
    this.targetName = targetName;
    this.property = property;
    this.times = times;
    this.values = values;
    this.interpolation = interpolation;
    this.targetNode = targetNode;
  }

  /**
   * Samples this track at the given time. Valid only for tracks with `property === "rotation"`.
   * The returned Quaternion is owned scratch state, reused across calls -- copy it before the
   * next call to `sampleQuaternion`/`sampleVector` on this same track if it must be retained.
   */
  public sampleQuaternion(time: number): Quaternion {
    this._findSegment(time, this._segment);
    if (this._segment.alpha < 0) {
      this._readQuaternion(this._segment.i0, this._tempQuatA);
      return this._tempQuatA;
    }
    if (this.interpolation === "CUBICSPLINE") {
      return this._sampleCubicSplineQuaternion(
        this._segment.i0,
        this._segment.i1,
        this._segment.alpha,
      );
    }
    this._readQuaternion(this._segment.i0, this._tempQuatA);
    this._readQuaternion(this._segment.i1, this._tempQuatB);
    return this._tempQuatA.slerp(this._tempQuatB, this._segment.alpha);
  }

  /**
   * Samples this track at the given time. Valid only for tracks with `property === "translation"`
   * or `property === "scale"`. The returned Vector3D is owned scratch state, reused across calls --
   * copy it before the next call to `sampleQuaternion`/`sampleVector` on this same track if it must
   * be retained.
   */
  public sampleVector(time: number): Vector3D {
    this._findSegment(time, this._segment);
    if (this._segment.alpha < 0) {
      this._readVector(this._segment.i0, this._tempVecA);
      return this._tempVecA;
    }
    if (this.interpolation === "CUBICSPLINE") {
      return this._sampleCubicSplineVector(this._segment.i0, this._segment.i1, this._segment.alpha);
    }
    this._readVector(this._segment.i0, this._tempVecA);
    this._readVector(this._segment.i1, this._tempVecB);
    return this._tempVecA.lerp(this._tempVecB, this._segment.alpha);
  }

  /**
   * Number of morph target weights encoded per keyframe for `property === "weights"` tracks.
   * Returns 0 for non-weights or empty tracks.
   */
  public getWeightCount(): number {
    if (this.property !== "weights" || this.times.length === 0) return 0;
    const divisor =
      this.interpolation === "CUBICSPLINE" ? this.times.length * 3 : this.times.length;
    return Math.floor(this.values.length / divisor);
  }

  /**
   * Evaluates a morph-target `"weights"` track at `time` and writes the resulting weights into
   * `out` with zero allocation. Returns the number of weights written.
   */
  public evaluateWeights(time: number, out: Float32Array | number[]): number {
    const targetCount = this.getWeightCount();
    if (targetCount === 0) return 0;
    const count = Math.min(targetCount, out.length);
    if (count === 0) return 0;

    this._findSegment(time, this._segment);
    const { i0, i1, alpha } = this._segment;
    const values = this.values;

    if (alpha < 0) {
      const offset =
        this.interpolation === "CUBICSPLINE" ? (i0 * 3 + 1) * targetCount : i0 * targetCount;
      if (offset + count > values.length) {
        for (let k = 0; k < count; k++) out[k] = 0;
        return count;
      }
      for (let k = 0; k < count; k++) {
        out[k] = values[offset + k]!;
      }
      return count;
    }

    if (this.interpolation === "CUBICSPLINE") {
      const v0Off = (i0 * 3 + 1) * targetCount;
      const b0Off = (i0 * 3 + 2) * targetCount;
      const a1Off = (i1 * 3 + 0) * targetCount;
      const v1Off = (i1 * 3 + 1) * targetCount;
      if (v1Off + count > values.length || b0Off + count > values.length) {
        for (let k = 0; k < count; k++) out[k] = 0;
        return count;
      }
      const dt = this.times[i1]! - this.times[i0]!;
      const s = alpha;
      const s2 = s * s;
      const s3 = s2 * s;
      const c0 = 2 * s3 - 3 * s2 + 1;
      const c1 = dt * (s3 - 2 * s2 + s);
      const c2 = -2 * s3 + 3 * s2;
      const c3 = dt * (s3 - s2);
      for (let k = 0; k < count; k++) {
        out[k] =
          c0 * values[v0Off + k]! +
          c1 * values[b0Off + k]! +
          c2 * values[v1Off + k]! +
          c3 * values[a1Off + k]!;
      }
      return count;
    }

    const off0 = i0 * targetCount;
    const off1 = i1 * targetCount;
    if (off1 + count > values.length) {
      for (let k = 0; k < count; k++) out[k] = 0;
      return count;
    }
    const invA = 1 - alpha;
    for (let k = 0; k < count; k++) {
      out[k] = values[off0 + k]! * invA + values[off1 + k]! * alpha;
    }
    return count;
  }

  /**
   * Locates the keyframe segment containing `time`. Writes into `out`. Sets `alpha: null` when
   * `time` falls exactly on (or outside) a keyframe, or the interpolation is stepped, so the caller
   * should read `out.i0` directly without blending. `out` is a reused scratch object; the result is
   * only valid until the next `_findSegment` call on this track.
   */
  private _findSegment(time: number, out: { i0: number; i1: number; alpha: number }): void {
    const times = this.times;
    const len = times.length;
    if (0 === len) {
      out.i0 = 0;
      out.i1 = 0;
      out.alpha = -1;
      return;
    }
    const lastIdx = len - 1;
    if (lastIdx <= 0 || time <= times[0]!) {
      out.i0 = 0;
      out.i1 = 0;
      out.alpha = -1;
      this._lastIndex = 0;
      return;
    }
    if (time >= times[lastIdx]!) {
      out.i0 = lastIdx;
      out.i1 = lastIdx;
      out.alpha = -1;
      this._lastIndex = lastIdx;
      return;
    }

    let i0 = this._lastIndex;
    let i1 = i0 + 1;

    // Fast paths: cached segment or sequential advance
    if (0 <= i0 && i1 <= lastIdx && times[i0]! <= time && time < times[i1]!) {
      // Still in cached segment
    } else if (i1 < lastIdx && times[i1]! <= time && time < times[i1 + 1]!) {
      // Monotonic forward step
      i0 = i1;
      i1 = i0 + 1;
      this._lastIndex = i0;
    } else {
      // Binary search fallback for time jumps / loops
      let low = 0;
      let high = lastIdx;
      while (low <= high) {
        const mid = (low + high) >> 1;
        if (times[mid]! <= time) {
          i0 = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      if (i0 >= lastIdx) i0 = lastIdx - 1;
      i1 = i0 + 1;
      this._lastIndex = i0;
    }

    if (this.interpolation === "STEP") {
      out.i0 = i0;
      out.i1 = i1;
      out.alpha = -1;
      return;
    }

    const t0 = times[i0]!;
    const t1 = times[i1]!;
    const dt = t1 - t0;
    out.i0 = i0;
    out.i1 = i1;
    out.alpha = dt > 1e-6 ? (time - t0) / dt : 0.0;
  }

  private _readQuaternion(index: number, out: Quaternion): void {
    const stride = 4;
    const offset = this.interpolation === "CUBICSPLINE" ? (index * 3 + 1) * stride : index * stride;
    if (this.times.length === 0 || offset + stride > this.values.length) {
      out.set(0, 0, 0, 1);
      return;
    }
    out.set(
      this.values[offset + 0]!,
      this.values[offset + 1]!,
      this.values[offset + 2]!,
      this.values[offset + 3]!,
    );
  }

  private _readVector(index: number, out: Vector3D): void {
    const stride = 3;
    const offset = this.interpolation === "CUBICSPLINE" ? (index * 3 + 1) * stride : index * stride;
    if (this.times.length === 0 || offset + stride > this.values.length) {
      if (this.property === "scale") {
        out.set(1, 1, 1);
      } else {
        out.set(0, 0, 0);
      }
      return;
    }
    out.set(this.values[offset + 0]!, this.values[offset + 1]!, this.values[offset + 2]!);
  }

  private _sampleCubicSplineVector(i0: number, i1: number, s: number): Vector3D {
    const stride = 3;
    const v0Offset = (i0 * 3 + 1) * stride;
    const b0Offset = (i0 * 3 + 2) * stride;
    const a1Offset = (i1 * 3 + 0) * stride;
    const v1Offset = (i1 * 3 + 1) * stride;
    const values = this.values;
    if (v1Offset + stride > values.length || b0Offset + stride > values.length) {
      this._readVector(i0, this._tempVecA);
      return this._tempVecA;
    }

    const dt = this.times[i1]! - this.times[i0]!;
    const s2 = s * s;
    const s3 = s2 * s;
    const c0 = 2 * s3 - 3 * s2 + 1;
    const c1 = dt * (s3 - 2 * s2 + s);
    const c2 = -2 * s3 + 3 * s2;
    const c3 = dt * (s3 - s2);

    this._tempVecA.set(
      c0 * values[v0Offset + 0]! +
        c1 * values[b0Offset + 0]! +
        c2 * values[v1Offset + 0]! +
        c3 * values[a1Offset + 0]!,
      c0 * values[v0Offset + 1]! +
        c1 * values[b0Offset + 1]! +
        c2 * values[v1Offset + 1]! +
        c3 * values[a1Offset + 1]!,
      c0 * values[v0Offset + 2]! +
        c1 * values[b0Offset + 2]! +
        c2 * values[v1Offset + 2]! +
        c3 * values[a1Offset + 2]!,
    );
    return this._tempVecA;
  }

  private _sampleCubicSplineQuaternion(i0: number, i1: number, s: number): Quaternion {
    const stride = 4;
    const v0Offset = (i0 * 3 + 1) * stride;
    const b0Offset = (i0 * 3 + 2) * stride;
    const a1Offset = (i1 * 3 + 0) * stride;
    const v1Offset = (i1 * 3 + 1) * stride;
    const values = this.values;
    if (v1Offset + stride > values.length || b0Offset + stride > values.length) {
      this._readQuaternion(i0, this._tempQuatA);
      return this._tempQuatA;
    }

    const dt = this.times[i1]! - this.times[i0]!;
    const s2 = s * s;
    const s3 = s2 * s;
    const c0 = 2 * s3 - 3 * s2 + 1;
    const c1 = dt * (s3 - 2 * s2 + s);
    const c2 = -2 * s3 + 3 * s2;
    const c3 = dt * (s3 - s2);

    const x =
      c0 * values[v0Offset + 0]! +
      c1 * values[b0Offset + 0]! +
      c2 * values[v1Offset + 0]! +
      c3 * values[a1Offset + 0]!;
    const y =
      c0 * values[v0Offset + 1]! +
      c1 * values[b0Offset + 1]! +
      c2 * values[v1Offset + 1]! +
      c3 * values[a1Offset + 1]!;
    const z =
      c0 * values[v0Offset + 2]! +
      c1 * values[b0Offset + 2]! +
      c2 * values[v1Offset + 2]! +
      c3 * values[a1Offset + 2]!;
    const w =
      c0 * values[v0Offset + 3]! +
      c1 * values[b0Offset + 3]! +
      c2 * values[v1Offset + 3]! +
      c3 * values[a1Offset + 3]!;

    const lenSq = x * x + y * y + z * z + w * w;
    if (lenSq > 0) {
      const invLen = 1 / Math.sqrt(lenSq);
      this._tempQuatA.set(x * invLen, y * invLen, z * invLen, w * invLen);
    } else {
      this._tempQuatA.set(0, 0, 0, 1);
    }
    return this._tempQuatA;
  }
}
