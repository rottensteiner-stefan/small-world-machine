import { Matrix4 } from "../Matrix4.js";
import type { ProjectionType } from "../../enums/index.js";

/**
 * Base class for all camera projection types.
 */
export abstract class AbstractProjection {
  /** The type of the projection. */
  public abstract readonly type: ProjectionType;

  /** Near clip plane distance. */
  public near: number = 0.1;
  /** Far clip plane distance. */
  public far: number = 1000;

  /** The projection matrix. */
  protected _matrix: Matrix4 = new Matrix4();

  /**
   * Returns the calculated projection matrix.
   * @returns The projection matrix.
   */
  public abstract getMatrix(): Matrix4;

  /**
   * Updates the projection matrix based on current properties.
   */
  public abstract update(): void;

  /**
   * Sets the aspect ratio of the projection.
   * @param value The aspect ratio (width / height).
   */
  public abstract setAspect(value: number): void;

  /**
   * Adjusts the zoom/scale of the projection.
   * @param delta The zoom delta.
   */
  public abstract zoom(delta: number): void;
}
