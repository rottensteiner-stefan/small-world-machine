import { CameraEffectType } from "../../enums/index.js";
import type { CameraEffect } from "../../interfaces/index.js";
import { Color } from "../colors/index.js";
import { ShakeEffect, FlashEffect } from "./effects/index.js";

/**
 * Factory for creating camera effects.
 */
export class CameraEffectFactory {
  /**
   * Creates a new camera effect of the specified type.
   * @param type The type of effect to create.
   * @param intensity The intensity of the effect.
   * @param duration The duration of the effect in seconds.
   * @param color The tint color, only used by effects that support one (e.g. Flash).
   * @returns The created camera effect.
   */
  public static create(
    type: CameraEffectType,
    intensity: number = 0.5,
    duration: number = 0.5,
    color: Color = Color.WHITE,
  ): CameraEffect {
    switch (type) {
      case CameraEffectType.SHAKE:
        return new ShakeEffect(intensity, duration);
      case CameraEffectType.FLASH:
        return new FlashEffect(intensity, duration, color);
      default:
        throw new Error(`Unknown camera effect type: ${type}`);
    }
  }
}
