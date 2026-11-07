import { AbstractCameraEffect } from "./AbstractCameraEffect.js";
import type { CameraEffect } from "../../../interfaces/index.js";
import { CameraEffectType } from "../../../enums/index.js";
import { Noise } from "../../../utils/Noise.js";

/**
 * A screen shake effect for the camera, driven by a decaying "trauma" value
 * (trauma^2 envelope, per Squirrel Eiserloh's GDC talk "Juicing Your Cameras With Math")
 * and continuous simplex noise instead of per-frame white noise, so the shake reads as a
 * smooth wobble rather than a jittery flicker.
 *
 * Shakes the camera's pitch/yaw (view direction) rather than its position: rotating the
 * camera can never push it through level geometry, unlike a positional offset.
 */
export class ShakeEffect extends AbstractCameraEffect {
  /** @inheritdoc */
  public override readonly type: CameraEffectType = CameraEffectType.SHAKE;

  /** Simplex noise is sampled at this rate (in Hz-equivalent) along the elapsed time axis. */
  private static readonly _FREQUENCY = 20;

  /** Peak rotation angle (radians) reached at trauma = 1, per unit of `intensity`. */
  private static readonly _MAX_ANGLE_PER_INTENSITY = 0.15;

  /** Current trauma level in [0, 1]; the envelope is `maxAngle * trauma^2`. */
  private _trauma: number;
  private _maxAngle: number;
  private _decayPerSecond: number;
  /** Monotonic time axis for noise sampling, independent of trauma decay/merges. */
  private _elapsed: number = 0;
  private readonly _seed: number;

  /**
   * Creates a new ShakeEffect.
   * @param intensity The maximum rotation intensity of the shake (scaled internally to radians).
   * @param duration The approximate duration of the shake in seconds (controls trauma decay rate).
   */
  constructor(intensity: number = 0.5, duration: number = 0.5) {
    super();
    this._trauma = Math.max(0, Math.min(1, intensity));
    this._maxAngle = intensity * ShakeEffect._MAX_ANGLE_PER_INTENSITY;
    this._decayPerSecond = 1 / Math.max(duration, 0.0001);
    // Per-instance offset so overlapping/simultaneous shakes don't sample identical noise.
    this._seed = 1000 * Math.random();
  }

  /** @inheritdoc */
  public override update(deltaTime: number): void {
    this._elapsed += deltaTime;
    this._trauma = Math.max(0, this._trauma - this._decayPerSecond * deltaTime);

    if (0 === this._trauma) {
      this.isFinished = true;
      this.pitchOffset = 0;
      this.yawOffset = 0;
      return;
    }

    const envelope: number = this._maxAngle * this._trauma * this._trauma;
    const t: number = this._elapsed * ShakeEffect._FREQUENCY;

    this.pitchOffset = Noise.simplex2(t, this._seed) * envelope;
    this.yawOffset = Noise.simplex2(t, this._seed + 100) * envelope;
  }

  /** @inheritdoc */
  public merge(other: CameraEffect): boolean {
    if (!(other instanceof ShakeEffect)) {
      return false;
    }

    this._trauma = Math.min(1, this._trauma + other._trauma);
    this._maxAngle = Math.max(this._maxAngle, other._maxAngle);
    // The slower decay rate wins, so the merged shake lasts at least as long as either would have.
    this._decayPerSecond = Math.min(this._decayPerSecond, other._decayPerSecond);
    return true;
  }
}
