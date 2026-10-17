import { AbstractProjection } from "./AbstractProjection.js";
import { Matrix4 } from "../Matrix4.js";
import { ProjectionType } from "../../enums/index.js";
import type { ProjectionOptions } from "../../interfaces/index.js";

/**
 * Configuration options for oblique projection.
 */
export interface ObliqueOptions {
  /** Left plane distance. Defaults to -1. */
  left?: number;
  /** Right plane distance. Defaults to 1. */
  right?: number;
  /** Bottom plane distance. Defaults to -1. */
  bottom?: number;
  /** Top plane distance. Defaults to 1. */
  top?: number;
  /** Near plane distance. Defaults to 0.1. */
  near?: number;
  /** Far plane distance. Defaults to 1000. */
  far?: number;
  /** Angle (radians) of the receding depth axis in screen space. Defaults to 45deg. */
  shearAngle?: number;
  /** Scale factor applied to the depth-axis shear (0 = orthographic, 1 = cavalier, 0.5 = cabinet). Defaults to 0.5 (cabinet). */
  shearScale?: number;
}

/**
 * Oblique camera projection for specialized 2.5D views.
 */
export class ObliqueProjection extends AbstractProjection {
  /** Left clip plane. */
  public left: number;
  /** Right clip plane. */
  public right: number;
  /** Bottom clip plane. */
  public bottom: number;
  /** Top clip plane. */
  public top: number;
  /** Angle (radians) of the receding depth axis in screen space. */
  public shearAngle: number;
  /** Scale factor applied to the depth-axis shear. */
  public shearScale: number;

  /** @inheritdoc */
  public override readonly type: ProjectionType = ProjectionType.OBLIQUE;

  /**
   * Creates an ObliqueProjection from engine config options.
   * @param options The projection options from EngineOptions.
   * @param initialAspect The initial aspect ratio.
   */
  public static fromConfig(
    options: ProjectionOptions | undefined,
    initialAspect: number,
  ): ObliqueProjection {
    const size = options?.orthoSize ?? 10;
    return new ObliqueProjection({
      left: -size * initialAspect,
      right: size * initialAspect,
      bottom: -size,
      top: size,
      near: options?.near ?? 0.1,
      far: options?.far ?? 1000,
    });
  }

  /**
   * Creates a new ObliqueProjection.
   * @param options The configuration options.
   */
  constructor(options: ObliqueOptions = {}) {
    super();
    const {
      left = -1,
      right = 1,
      bottom = -1,
      top = 1,
      near = 0.1,
      far = 1000,
      shearAngle = Math.PI / 4,
      shearScale = 0.5,
    } = options;
    this.left = left;
    this.right = right;
    this.bottom = bottom;
    this.top = top;
    this.near = near;
    this.far = far;
    this.shearAngle = shearAngle;
    this.shearScale = shearScale;
    this.update();
  }

  /** @inheritdoc */
  public override update(): void {
    Matrix4.orthographic(
      this.left,
      this.right,
      this.bottom,
      this.top,
      this.near,
      this.far,
      this._matrix,
    );

    // Shear the depth axis into X/Y directly in closed form, avoiding a full 4x4 matrix multiply.
    const d = this._matrix.data;
    d[8] = -d[0]! * Math.cos(this.shearAngle) * this.shearScale;
    d[9] = -d[5]! * Math.sin(this.shearAngle) * this.shearScale;
  }

  public override setAspect(aspect: number): void {
    const height: number = this.top - this.bottom;
    const centerX: number = (this.left + this.right) / 2;
    this.left = centerX - (height * aspect) / 2;
    this.right = centerX + (height * aspect) / 2;
    this.update();
  }

  public override zoom(delta: number): void {
    const factor: number = 1.0 + delta;
    this.left *= factor;
    this.right *= factor;
    this.top *= factor;
    this.bottom *= factor;
    this.update();
  }

  /** @inheritdoc */
  public override getMatrix(): Matrix4 {
    return this._matrix;
  }
}
