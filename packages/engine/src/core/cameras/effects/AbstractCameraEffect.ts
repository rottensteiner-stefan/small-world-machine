import type { CameraEffect } from "../../../interfaces/index.js";
import { Vector3D } from "../../../math/index.js";
import { Color } from "../../colors/index.js";

/**
 * Base class for camera effects.
 */
export abstract class AbstractCameraEffect implements CameraEffect {
  /** @inheritdoc */
  public abstract readonly type: string;

  /** @inheritdoc */
  public isFinished: boolean = false;

  /** @inheritdoc */
  public readonly offset: Vector3D = new Vector3D();

  /** @inheritdoc */
  public readonly targetOffset: Vector3D = new Vector3D();

  /** @inheritdoc */
  public pitchOffset: number = 0;

  /** @inheritdoc */
  public yawOffset: number = 0;

  /** @inheritdoc */
  public flashIntensity: number = 0;

  /** @inheritdoc */
  public readonly flashColor: Color = Color.WHITE.clone();

  /**
   * Updates the effect state.
   * @param deltaTime Time elapsed since the last frame in seconds.
   */
  public abstract update(deltaTime: number): void;
}
