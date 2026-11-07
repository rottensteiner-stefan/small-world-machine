import { AbstractCameraEffect } from "./AbstractCameraEffect.js";
import { CameraEffectType } from "../../../enums/index.js";
import { Color } from "../../colors/index.js";

/**
 * A post-processing screen flash for the camera (e.g. an explosion or impact hit-flash).
 * Drives `flashIntensity`/`flashColor`, which the engine forwards each frame into the
 * renderer's post-processing `FlashElement` -- this is a real full-screen overlay, not a
 * camera-position jolt.
 */
export class FlashEffect extends AbstractCameraEffect {
  /** @inheritdoc */
  public override readonly type: CameraEffectType = CameraEffectType.FLASH;

  private _peakIntensity: number;
  private _duration: number;
  private _elapsed: number = 0;

  /**
   * Creates a new FlashEffect.
   * @param intensity The peak flash intensity in [0, 1].
   * @param duration The duration of the flash in seconds.
   * @param color The tint color of the flash (defaults to white).
   */
  constructor(intensity: number = 1.0, duration: number = 0.2, color: Color = Color.WHITE) {
    super();
    this._peakIntensity = intensity;
    this._duration = duration;
    this.flashColor.copyFrom(color);
  }

  /** @inheritdoc */
  public override update(deltaTime: number): void {
    this._elapsed += deltaTime;

    if (this._elapsed >= this._duration) {
      this.isFinished = true;
      this.flashIntensity = 0;
      return;
    }

    // Instant attack, quadratic decay -- reads as a snappy hit-flash rather than a fade-in.
    const remaining: number = 1 - this._elapsed / this._duration;
    this.flashIntensity = this._peakIntensity * remaining * remaining;
  }
}
