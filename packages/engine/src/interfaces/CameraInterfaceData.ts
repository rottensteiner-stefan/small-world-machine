import type { CameraStrategy } from "./CameraStrategy.js";
import type { CameraConstraints } from "./CameraConstraints.js";
import type { CameraEffect } from "./CameraEffect.js";
import type { AbstractProjection } from "../math/projections/index.js";
import type { Matrix4, Vector3D } from "../math/index.js";
import type { CameraEffectType, CameraStrategyType } from "../enums/index.js";
import type { Behavior } from "../core/behaviors/index.js";
import type { CameraFlyToOptions } from "../core/behaviors/CameraFlyToBehavior.js";
import type { Color } from "../core/colors/index.js";

/**
 * Interface representing the core data and API of a camera.
 */
export interface CameraInterfaceData {
  /** The behaviors attached to this camera. */
  behaviors: Behavior[];

  /** Horizontal rotation delta accumulated by behaviors. */
  pendingDx: number;
  /** Vertical rotation delta accumulated by behaviors. */
  pendingDy: number;

  /** The currently active camera control strategy. */
  readonly strategy: CameraStrategy;
  /** The position of the camera in world space. */
  position: Vector3D;
  /** The target point the camera is looking at. */
  target: Vector3D;
  /** The up vector of the camera (usually 0, 1, 0). */
  up: Vector3D;

  /** The aspect ratio (width / height). */
  aspect: number;

  /** The active projection (e.g., Perspective, Orthographic). */
  projection: AbstractProjection;

  /** The rotation angle around the Y-axis (yaw). */
  theta: number;
  /** The rotation angle around the X-axis (pitch). */
  phi: number;

  /** The unique type identifier of the active strategy. */
  readonly activeStrategyType: string;

  /** The combined post-processing flash intensity of all active camera effects, in [0, 1]. */
  readonly flashIntensity: number;

  /** The tint color of the currently strongest active flash contribution. */
  readonly flashColor: Color;

  /** The combined view-projection matrix as a Float32Array. */
  viewProjectionMatrix: Float32Array;

  /** The combined view-projection matrix as a Matrix4 instance. */
  viewProjectionMatrix4: Matrix4;

  /** The view matrix as a Float32Array. */
  viewMatrix: Float32Array;

  /** The view matrix as a Matrix4 instance. */
  viewMatrix4: Matrix4;

  /**
   * Adds a behavior to the camera.
   * @param behavior The behavior to add.
   */
  addBehavior(behavior: Behavior): this;

  /**
   * Removes a behavior from the camera.
   * @param behavior The behavior to remove.
   */
  removeBehavior(behavior: Behavior): this;

  /**
   * Switches the camera's control behavior.
   * @param type The type of strategy to use.
   */
  setStrategy(type: CameraStrategyType): void;

  /**
   * Sets or removes spatial constraints for the active strategy.
   * @param constraints The constraints to apply, or undefined to clear.
   */
  setConstraints(constraints?: CameraConstraints): void;

  /**
   * Performs the movement and logic of the active strategy.
   * @param targetPos The target position to follow.
   * @param dx The horizontal rotation delta.
   * @param dy The vertical rotation delta.
   * @param deltaTime Elapsed time since the last frame.
   */
  update(targetPos: Vector3D, dx: number, dy: number, deltaTime?: number): void;

  /**
   * Adds a new effect to the camera. If an existing effect of the same `type` accepts a merge
   * (see `CameraEffect.merge`), `effect` is absorbed into it instead of being added separately.
   * @param effect The effect to add.
   * @returns The effect that now represents this addition: either `effect` itself, or the
   * existing effect `effect` was merged into.
   */
  addEffect(effect: CameraEffect): CameraEffect;

  /**
   * Removes a specific effect instance, e.g. to cancel it before it finishes on its own.
   * @param effect The effect instance to remove.
   */
  removeEffect(effect: CameraEffect): void;

  /**
   * Removes all active effects, or all effects of a specific type.
   * @param type If given, only effects of this type are removed; otherwise all are.
   */
  clearEffects(type?: CameraEffectType): void;

  /**
   * Creates and adds a new effect by its type.
   * @param type The type of effect.
   * @param intensity The intensity factor.
   * @param duration The duration in seconds.
   * @param color The tint color, only used by effects that support one (e.g. Flash).
   * @returns The effect that was added (or the existing effect it was merged into).
   */
  applyEffect(
    type: CameraEffectType,
    intensity?: number,
    duration?: number,
    color?: Color,
  ): CameraEffect;

  /**
   * Adjusts the zoom level (radius, FOV, or orthographic bounds).
   * @param delta The zoom delta.
   */
  zoom(delta: number): void;

  /**
   * Recomputes the projection matrix.
   */
  updateProjectionMatrix(): void;

  /**
   * Recomputes the view matrix and the combined view-projection matrix.
   */
  updateViewMatrix(): void;

  /**
   * Maps screen coordinates (NDC -1 to 1) to world coordinates on the Y=0 plane.
   * @param screenX Normalized X coordinate (-1 to 1).
   * @param screenY Normalized Y coordinate (-1 to 1).
   * @returns The world position on the Y=0 plane.
   */
  screenToWorld(screenX: number, screenY: number): Vector3D;

  /** Whether a cinematic fly transition is active. */
  readonly isFlying?: boolean;

  /** Initiates a smooth cinematic fly-through transition. */
  flyTo?(options: CameraFlyToOptions): Promise<boolean>;

  /** Cancels any active camera flight. */
  cancelFlight?(): void;

  /**
   * Projects a 3D world position into Normalized Device Coordinates (NDC: [-1, 1] on X, Y, Z).
   * After projection, `Z >= -1` means the point is in front of the camera (true NDC depth; with
   * OpenGL-style depth, in-front points closer than ~2x the near plane legitimately have
   * negative NDC Z, so callers MUST NOT gate on `Z > 0`). The sentinel `Z = -2` marks a point
   * behind the camera.
   * @param worldPos The 3D world coordinates.
   * @param result Optional Vector3D to receive the result.
   * @returns The projected NDC vector.
   */
  project(worldPos: Vector3D, result?: Vector3D): Vector3D;
}

/**
 * Type guard to check whether a target is a CameraInterfaceData instance.
 */
export function isCameraTarget(target: unknown): target is CameraInterfaceData {
  return typeof target === "object" && target !== null && "updateProjectionMatrix" in target;
}
