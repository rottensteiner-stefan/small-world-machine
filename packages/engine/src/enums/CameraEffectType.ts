/**
 * Types of camera effects.
 */
export const CameraEffectType = {
  /** Screen shake effect. */
  SHAKE: "ShakeEffect",
  /** Screen flash effect. */
  FLASH: "FlashEffect",
} as const;

/** Type definition for CameraEffectType. */
export type CameraEffectType = (typeof CameraEffectType)[keyof typeof CameraEffectType];
