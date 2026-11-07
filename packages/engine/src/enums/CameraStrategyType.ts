/**
 * Types of camera control strategies.
 */
export const CameraStrategyType = {
  /** Developer has full manual control over position and target. No automation. */
  MANUAL: "ManualCamera",
  /** Hybrid strategy that syncs manual position changes with orbital coordinates. */
  HYBRID_SYNC: "HybridSyncCamera",
  /** Camera stays fixed at its position. */
  FIXED: "FixedCamera",
  /** First-person shooter camera. */
  FPS: "FPSCamera",
  /** Smooth third-person following camera. */
  SMOOTH: "SmoothCamera",
  /** Rigid third-person following camera. */
  STIFF: "StiffCamera",
  /** Isometric camera. */
  ISOMETRIC: "IsometricCamera",
  /** The strategy assumed when none is specified. */
  DEFAULT: "ManualCamera",
} as const;

/** Type definition for CameraStrategyType. */
export type CameraStrategyType = (typeof CameraStrategyType)[keyof typeof CameraStrategyType];
