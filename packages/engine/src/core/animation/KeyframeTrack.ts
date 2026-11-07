import { Vector3D } from "../../math/Vector3D.js";
import { Quaternion } from "../../math/Quaternion.js";

export type TrackType = "translation" | "rotation" | "scale";
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

  private _tempQuatA: Quaternion = new Quaternion();
  private _tempQuatB: Quaternion = new Quaternion();
  private _tempVecA: Vector3D = new Vector3D();
  private _tempVecB: Vector3D = new Vector3D();
  private _segment = { i0: 0, i1: 0, alpha: null as number | null };
  private _lastIndex: number = 0;

  constructor(
    targetName: string,
    property: TrackType,
    times: Float32Array,
    values: Float32Array,
    interpolation: InterpolationType = "LINEAR",
  ) {
    this.targetName = targetName;
    this.property = property;
    this.times = times;
    this.values = values;
    this.interpolation = interpolation;
  }

  /**
   * Samples this track at the given time. Valid only for tracks with `property === "rotation"`.
   * The returned Quaternion is owned scratch state, reused across calls -- copy it before the
   * next call to `sampleQuaternion`/`sampleVector` on this same track if it must be retained.
   */
  public sampleQuaternion(time: number): Quaternion {
    this._findSegment(time, this._segment);
    if (this._segment.alpha === null) {
      this._readQuaternion(this._segment.i0, this._tempQuatA);
      return this._tempQuatA;
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
    if (this._segment.alpha === null) {
      this._readVector(this._segment.i0, this._tempVecA);
      return this._tempVecA;
    }
    this._readVector(this._segment.i0, this._tempVecA);
    this._readVector(this._segment.i1, this._tempVecB);
    return this._tempVecA.lerp(this._tempVecB, this._segment.alpha);
  }

  /**
   * Locates the keyframe segment containing `time`. Writes into `out`. Sets `alpha: null` when
   * `time` falls exactly on (or outside) a keyframe, or the interpolation is stepped, so the caller
   * should read `out.i0` directly without blending. `out` is a reused scratch object; the result is
   * only valid until the next `_findSegment` call on this track.
   */
  private _findSegment(time: number, out: { i0: number; i1: number; alpha: number | null }): void {
    const times = this.times;
    const len = times.length;
    if (0 === len) {
      out.i0 = 0;
      out.i1 = 0;
      out.alpha = null;
      return;
    }
    const lastIdx = len - 1;
    if (lastIdx <= 0 || time <= times[0]!) {
      out.i0 = 0;
      out.i1 = 0;
      out.alpha = null;
      this._lastIndex = 0;
      return;
    }
    if (time >= times[lastIdx]!) {
      out.i0 = lastIdx;
      out.i1 = lastIdx;
      out.alpha = null;
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
      out.alpha = null;
      return;
    }

    const t0 = times[i0]!;
    const t1 = times[i1]!;
    out.i0 = i0;
    out.i1 = i1;
    out.alpha = (time - t0) / (t1 - t0);
  }

  private _readQuaternion(index: number, out: Quaternion): void {
    const stride = 4;
    const offset = index * stride;
    if (offset + stride > this.values.length) return;
    out.set(
      this.values[offset + 0]!,
      this.values[offset + 1]!,
      this.values[offset + 2]!,
      this.values[offset + 3]!,
    );
  }

  private _readVector(index: number, out: Vector3D): void {
    const stride = 3;
    const offset = index * stride;
    if (offset + stride > this.values.length) return;
    out.set(this.values[offset + 0]!, this.values[offset + 1]!, this.values[offset + 2]!);
  }
}
