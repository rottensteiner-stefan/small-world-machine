import { Object3D } from "../Object3D.js";
import { FogVolumeShape } from "../../enums/FogVolumeShape.js";
import { Color } from "../colors/Color.js";
import { Vector3D, Matrix4 } from "../../math/index.js";
import { OBB } from "../../physix/index.js";

export interface FogVolumeOptions {
  name?: string;
  shape?: FogVolumeShape;
  size?: Vector3D;
  density?: number;
  edgeFade?: number;
  albedo?: Color;
  emission?: Color;
  emissionIntensity?: number;
  enabled?: boolean;
}

/**
 * A localized volumetric fog volume (Option R Phase 3).
 *
 * Supports analytical Signed Distance Fields (SDF) for Box, Sphere, and Cylinder shapes.
 * Positive `density` injects localized mist, smoke, or cloud bodies with custom albedo and emission.
 * Negative `density` (e.g. -1.0) carves out fog from overlapping volumes or global height fog,
 * allowing clear interiors in caves, bunkers, and indoor rooms.
 */
export class FogVolume extends Object3D {
  public shape: FogVolumeShape;
  public size: Vector3D;
  /** Density multiplier. Negative density carves out fog. */
  public density: number;
  /** Boundary falloff sharpness (0.0 to 1.0). */
  public edgeFade: number;
  /** Volumetric scattering albedo tint. */
  public albedo: Color;
  /** Volumetric emission tint. */
  public emission: Color;
  /** Volumetric emission intensity multiplier. */
  public emissionIntensity: number;
  /** Whether this fog volume actively injects into the froxel/raymarch passes. */
  public enabled: boolean;

  /** Cached inverse world matrix for transforming world coordinates into local volume space. */
  private readonly _invWorldMatrix: Matrix4 = new Matrix4();

  constructor(options: FogVolumeOptions = {}) {
    super(options.name ?? "FogVolume");
    this.shape = options.shape ?? FogVolumeShape.BOX;
    this.size = options.size ? options.size.clone() : new Vector3D(5, 5, 5);
    this.density = options.density ?? 0.1;
    this.edgeFade = options.edgeFade ?? 0.2;
    this.albedo = options.albedo ? options.albedo.clone() : new Color(1, 1, 1);
    this.emission = options.emission ? options.emission.clone() : new Color(0, 0, 0);
    this.emissionIntensity = options.emissionIntensity ?? 0.0;
    this.enabled = options.enabled ?? true;

    this.isCollidable = false;
    this.castShadow = false;
    this.receiveShadow = false;
  }

  /**
   * Computes and returns the inverse world matrix for transforming world-space sample points
   * to local volume space.
   */
  public getInverseWorldMatrix(): Matrix4 {
    this.updateMatrixWorld(false);
    this._invWorldMatrix.data.set(this.worldMatrix.data);
    Matrix4.invert(this._invWorldMatrix, this._invWorldMatrix);
    return this._invWorldMatrix;
  }

  /** @inheritdoc */
  public override computeBounds(): this {
    const obb = this.bounds instanceof OBB ? this.bounds : new OBB();
    obb.setLocalCenter(0, 0, 0);
    obb.setLocalHalfExtents(this.size.x, this.size.y, this.size.z);
    obb.transform(this.worldMatrix);
    this.bounds = obb;
    return this;
  }
}
