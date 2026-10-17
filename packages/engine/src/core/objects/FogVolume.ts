import { Object3D } from "../Object3D.js";
import { FogVolumeShape } from "../../enums/FogVolumeShape.js";
import { Color } from "../colors/Color.js";
import { Vector3D, Matrix4 } from "../../math/index.js";
import type { VolumetricTexture } from "../textures/index.js";
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
  noiseScale?: number;
  noiseAmount?: number;
  noiseSpeed?: number;
  densityMask?: VolumetricTexture;
  enabled?: boolean;
}

/**
 * A localized volumetric fog volume (Option R Phase 3 & Phase 5).
 *
 * Supports analytical Signed Distance Fields (SDF) for Box, Sphere, and Cylinder shapes.
 * Positive `density` injects localized mist, smoke, or cloud bodies with custom albedo and emission.
 * Negative `density` (e.g. -1.0) carves out fog from overlapping volumes or global height fog
 * (independent of scene order), allowing clear interiors in caves, bunkers, and indoor rooms.
 * At most 16 enabled volumes are evaluated (a warning is logged beyond that).
 * Procedural 3D noise (`noiseScale`, `noiseAmount`, `noiseSpeed`) creates rolling, animated mist.
 */
export class FogVolume extends Object3D {
  public shape: FogVolumeShape;
  /**
   * Half extents (Box), radius in `x` (Sphere), radius in `x` and half height in `y` (Cylinder), all in
   * local space (the world matrix scale applies on top). The bounds use the full vector as half extents.
   */
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
  /** Spatial frequency of procedural 3D noise (0 = uniform fog). */
  public noiseScale: number;
  /** Modulation strength of 3D noise (0.0 = none, 1.0 = full turbulence). */
  public noiseAmount: number;
  /** Drift velocity of rolling mist in world units/sec. */
  public noiseSpeed: number;
  /**
   * Optional user-authored 3D density mask (see {@link VolumetricTexture}). R multiplies the local
   * density per voxel inside the volume's own box (`pLocal / size` maps to mask UVW), G replaces the
   * volume's per-voxel scattering albedo. `null` keeps the uniform analytical volume.
   */
  public densityMask: VolumetricTexture | null;
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
    this.noiseScale = options.noiseScale ?? 0.0;
    this.noiseAmount = options.noiseAmount ?? 0.0;
    this.noiseSpeed = options.noiseSpeed ?? 0.0;
    this.densityMask = options.densityMask ?? null;
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
