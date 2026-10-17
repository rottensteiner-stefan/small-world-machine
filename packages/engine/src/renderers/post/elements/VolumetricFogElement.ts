import { PostProcessingElement } from "../PostProcessingElement.js";
import { PostProcessingEffectType } from "../../../enums/index.js";
import { Color } from "../../../core/colors/index.js";

/**
 * True 3D volumetric fog ("Froxel Stage 3") parameters.
 *
 * WebGPU: compute-based froxel pipeline (inject -> temporal reprojection -> in-register integration
 * with cascaded-shadow-map sunlight -> single-tap composite), reusing the clustered light grid as the
 * froxel grid (Option R, ADR 0031). WebGL2: per-pixel raymarch of the same parameters (a different
 * algorithm, so the look is close but not identical). WebGL1 stays with the analytic fog of `Scene.fog`.
 *
 * Opt-in post-processing effect, off by default just like `LightShaftsElement`.
 */
export class VolumetricFogElement extends PostProcessingElement {
  public readonly type = PostProcessingEffectType.VOLUMETRIC_FOG;

  /** Off by default -- opt-in post-processing effect. */
  public override enabled: boolean = false;

  /**
   * Scattering extinction coefficient sigma_t of the participating medium (default: 0.02).
   * Higher values make the volume denser and the light shafts more pronounced.
   */
  public density: number = 0.02;

  /**
   * World-space height of the fog volume baseline (default: 0.0). The volume density falls off
   * exponentially above this height, like a height-based atmosphere layer.
   */
  public height: number = 0.0;

  /**
   * Exponential height falloff coefficient (default: 1.0). 0 disables the height falloff and the
   * fog becomes a uniform density volume between `height` and `maxDistance`.
   */
  public heightFalloff: number = 1.0;

  /**
   * Maximum world-space distance from the camera at which the volume is evaluated (default: 80.0 m).
   * Clamped against the scene far plane.
   */
  public maxDistance: number = 80.0;

  /**
   * Intensity multiplier of the accumulated in-scattering, applied once in the composite pass
   * (default: 1.0). Transmittance is not affected.
   */
  public intensity: number = 1.0;

  /**
   * Forward-scattering asymmetry factor (-1.0 to 1.0, default: 0.4) corresponding to the
   * Henyey-Greenstein phase function g. Positive g boosts forward scattering towards the light,
   * negative g boosts back scattering. 0 is isotropic.
   */
  public asymmetry: number = 0.4;

  /**
   * Whether directional (sun/moon) light is shadowed by the cascaded shadow map inside the volume
   * (default: true).
   */
  public castDirectionalShadow: boolean = true;

  /**
   * Single-scattering albedo omega = sigma_s / sigma_t (0..1, default: 1). The fraction of the
   * extinction that scatters light towards the camera; the rest is absorbed. 1 is a pure scattering
   * mist (light shafts glow), lower values make smoke or dust that darkens what is behind it without
   * brightening itself, 0 is pure absorption.
   */
  public scatteringAlbedo: number = 1.0;

  /**
   * Whether spot lights that cast shadows are shadowed inside the fog, so objects cut shafts and
   * dark wedges out of their light cone (default: true). Reuses the lights' existing spot shadow
   * maps (at most 4, see `SpotLight.castShadow`), costs one shadow-map lookup per froxel and
   * shadowed spot, and needs no extra render pass. Point lights have no shadow maps in the engine,
   * so they scatter unshadowed.
   */
  public localLightShadows: boolean = true;

  /**
   * How strongly the scene's ambient light (ambient colour and, on WebGPU, the IBL irradiance from
   * above) scatters in the fog (default: 0 = off), like Godot's Ambient Inject. Lifts fog that lies in
   * shadow, which otherwise goes black. Scaled by the local density.
   */
  public ambientInject: number = 0.0;

  /**
   * Tint of the scattered light (default: neutral white), applied to the sun, local lights and ambient
   * on top of each light's own colour and intensity.
   */
  public color: Color = new Color(1.0, 1.0, 1.0);

  /**
   * Interleaved gradient noise jitter strength to break up raymarch banding (0..1, default: 0.25).
   * 0 disables jitter entirely for a fixed, deterministic volume.
   */
  public jitter: number = 0.25;
}
