import { Color } from "../colors/index.js";
import { LightType } from "../../enums/index.js";
import { Object3D } from "../Object3D.js";
import { LightDataInterface } from "../../interfaces/index.js";
import { Camera } from "../cameras/Camera.js";
import { InspectorField } from "../Inspectable.js";

/**
 * Global scene-wide cap on pushed point/spot lights per type -- see
 * docs/adr/0004-point-spot-light-global-cap.md and docs/adr/0007-clustered-lighting-webgl2-webgpu-only.md.
 * WebGPU consumes up to this many; WebGL2/WebGL1 currently only read the first 16.
 */
export const MAX_CLUSTERED_LIGHTS_PER_TYPE = 64;

/**
 * Configuration options for lights.
 */
export interface LightOptions {
  /** The color of the light. Defaults to white. */
  color?: Color;
  /** The intensity of the light. Defaults to 1.0. */
  intensity?: number;
  /** The name of the light object. Defaults to "Light". */
  name?: string;
  /** Whether the light casts shadows. Defaults to false. */
  castShadow?: boolean;
  /** The resolution of the shadow map for this light. Defaults to 512. */
  shadowResolution?: number;
  /** A small offset to prevent shadow acne. Defaults to 0.005. */
  shadowBias?: number;
  /** How much this light contributes to volumetric fog (0 = none). Defaults to 1.0. */
  volumetricIntensity?: number;
  /** An offset along the surface normal to prevent shadow acne. Defaults to 0.0. */
  shadowNormalBias?: number;
}

/**
 * Base class for all light types.
 */
export abstract class AbstractLight extends Object3D {
  /** Fields common to every light, merged with `Object3D.inspector` (transform/visibility)
   * and a concrete subclass's own map (e.g. `PointLight`'s distance/decay) via
   * `collectInspectorSchema()`. */
  public static override readonly inspector: Record<string, InspectorField> = {
    color: { type: "color", label: "Color" },
    intensity: { type: "number", label: "Intensity", min: 0, max: 200, step: 0.01 },
    volumetricIntensity: {
      type: "number",
      label: "Volumetric Intensity",
      min: 0,
      max: 10,
      step: 0.01,
    },
    shadowBias: { type: "number", label: "Shadow Bias", min: 0, max: 0.05, step: 0.0001 },
    shadowNormalBias: {
      type: "number",
      label: "Shadow Normal Bias",
      min: 0,
      max: 0.5,
      step: 0.001,
    },
  };

  /** The type of the light. */
  public abstract readonly type: LightType;

  /** The color of the light. */
  public color: Color;

  /** The intensity of the light. */
  public intensity: number;

  /**
   * Multiplier of this light's in-scattering in volumetric fog (like Unreal's Volumetric Scattering
   * Intensity, Godot's per-light volumetric fog energy). 0 removes the light from the fog entirely,
   * which is useful for short-lived flashes that would ghost in the temporal filter.
   */
  public volumetricIntensity: number;

  /** Whether the light casts shadows. */
  public override castShadow: boolean;

  /** The resolution of the shadow map for this light. */
  public shadowResolution: number;

  /** A small offset to prevent shadow acne. */
  public shadowBias: number;

  /** An offset along the surface normal to prevent shadow acne. */
  public shadowNormalBias: number;

  /** The camera used to render the shadow map for this light. */
  public shadowCamera: Camera | undefined;

  /**
   * Applies the light's data to the collective light data structure.
   * @param data The structure to populate.
   */
  public abstract applyTo(data: LightDataInterface): void;

  /**
   * Creates a new AbstractLight.
   * @param options The configuration options for the light.
   */
  protected constructor(options: LightOptions = {}) {
    const {
      color = new Color(1, 1, 1, 1),
      intensity = 1.0,
      name = "Light",
      castShadow = false,
      shadowResolution = 512,
      shadowBias = 0.005,
      shadowNormalBias = 0.0,
      volumetricIntensity = 1.0,
    } = options;
    super(name);
    this.color = Object.isFrozen(color) ? color.clone() : color;
    this.intensity = intensity;
    this.volumetricIntensity = volumetricIntensity;
    this.castShadow = castShadow;
    this.shadowResolution = shadowResolution;
    this.shadowBias = shadowBias;
    this.shadowNormalBias = shadowNormalBias;
    this.shadowCamera = undefined;
  }
}
