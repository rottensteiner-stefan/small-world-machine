import { PostProcessingElement } from "../PostProcessingElement.js";
import { PostProcessingEffectType } from "../../../enums/index.js";

export interface ContactShadowsOptions {
  /** Opt-in: whether effect is enabled (default: false). */
  enabled?: boolean;
  /** Strength of shadow darkening in [0, 1] (default: 1.0). */
  intensity?: number;
  /** Maximum ray distance in world space units (default: 0.5). */
  maxDistance?: number;
  /** Thickness of occluding geometry in world space units (default: 0.05). */
  thickness?: number;
  /** Number of raymarching steps along the light vector (default: 16). */
  raySteps?: number;
  /** Distance from camera where shadows fade out (default: 30.0). */
  fadeDistance?: number;
  /** Depth bias preventing self-occlusion / acne (default: 0.005). */
  bias?: number;
}

/**
 * Screen-Space Contact Shadows (Bend Studio method / Days Gone).
 *
 * Casts short screen-space rays towards the primary directional light from the depth buffer
 * to provide fine contact shadows, crevices, micro-occlusion, and self-shadowing on foliage
 * and ground clutter outside the shadow map cascade resolution.
 */
export class ContactShadowsElement extends PostProcessingElement {
  public readonly type = PostProcessingEffectType.CONTACT_SHADOWS;

  /** Opt-in: disabled by default. */
  public override enabled: boolean = false;

  /** Strength of shadow darkening in [0, 1] (default: 1.0). */
  public intensity: number = 1.0;
  /** Maximum ray distance in world space units (default: 0.5). */
  public maxDistance: number = 0.5;
  /** Thickness of occluding geometry in world space units (default: 0.05). */
  public thickness: number = 0.05;
  /** Number of raymarching steps along the light vector (default: 16). */
  public raySteps: number = 16;
  /** Distance from camera where shadows fade out (default: 30.0). */
  public fadeDistance: number = 30.0;
  /** Depth bias preventing self-occlusion / acne (default: 0.005). */
  public bias: number = 0.005;

  constructor(options: ContactShadowsOptions = {}) {
    super();
    if (undefined !== options.enabled) this.enabled = options.enabled;
    if (undefined !== options.intensity) this.intensity = options.intensity;
    if (undefined !== options.maxDistance) this.maxDistance = options.maxDistance;
    if (undefined !== options.thickness) this.thickness = options.thickness;
    if (undefined !== options.raySteps) this.raySteps = options.raySteps;
    if (undefined !== options.fadeDistance) this.fadeDistance = options.fadeDistance;
    if (undefined !== options.bias) this.bias = options.bias;
  }

  public override structuralKey(): string {
    return `${this.enabled ? 1 : 0}|${this.raySteps}`;
  }

  /**
   * Packs continuous parameters into the post-processing Uber-Shader DynUniforms buffer.
   * Slot 48 (formerly unread shaftsColor.x) carries contact shadow intensity.
   */
  public override packUniforms(target: Float32Array, _offset: number): void {
    target[48] = this.enabled ? this.intensity : 0.0;
  }
}
