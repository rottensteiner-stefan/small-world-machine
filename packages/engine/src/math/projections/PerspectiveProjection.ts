import { AbstractProjection } from "./AbstractProjection.js";
import { Matrix4 } from "../Matrix4.js";
import { MathUtils } from "../MathUtils.js";
import { ProjectionType } from "../../enums/index.js";
import type { ProjectionOptions } from "../../interfaces/index.js";

/**
 * Configuration options for perspective projection.
 */
export interface PerspectiveOptions {
  /** Field of view in radians. Defaults to 75 degrees. */
  fov?: number;
  /** Aspect ratio (width / height). Defaults to 1. */
  aspect?: number;
  /** Near plane distance. Defaults to 0.1. */
  near?: number;
  /** Far plane distance. Defaults to 1000. */
  far?: number;
}

/**
 * Perspective camera projection for 3D views.
 */
export class PerspectiveProjection extends AbstractProjection {
  /** Field of view in radians. */
  public fov: number;
  /** Aspect ratio (width / height). */
  public aspect: number;

  /** @inheritdoc */
  public override readonly type: ProjectionType = ProjectionType.PERSPECTIVE;

  /**
   * Creates a new PerspectiveProjection.
   * @param options The configuration options.
   */
  constructor(options: PerspectiveOptions = {}) {
    super();
    const { fov = MathUtils.degToRad(75), aspect = 1, near = 0.1, far = 1000 } = options;
    this.fov = fov;
    this.aspect = aspect;
    this.near = near;
    this.far = far;
    this.update();
  }

  /**
   * Creates a PerspectiveProjection from engine config options.
   * @param options The projection options from EngineOptions.
   * @param initialAspect The initial aspect ratio.
   */
  public static fromConfig(
    options: ProjectionOptions | undefined,
    initialAspect: number,
  ): PerspectiveProjection {
    return new PerspectiveProjection({
      fov: options?.fov ?? MathUtils.degToRad(75),
      aspect: initialAspect,
      near: options?.near ?? 0.1,
      far: options?.far ?? 1000,
    });
  }

  /** @inheritdoc */
  public override update(): void {
    Matrix4.perspective(this.fov, this.aspect, this.near, this.far, this._matrix);
  }

  public override setAspect(value: number): void {
    this.aspect = value;
    this.update();
  }

  public override zoom(delta: number): void {
    this.fov += delta * this.fov;
    // Clamp FOV between 10 and 120 degrees
    this.fov = MathUtils.clamp(this.fov, MathUtils.degToRad(10), MathUtils.degToRad(120));
    this.update();
  }

  /** @inheritdoc */
  public override getMatrix(): Matrix4 {
    return this._matrix;
  }
}
