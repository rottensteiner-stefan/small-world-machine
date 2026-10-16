import { PostProcessingElement } from "../PostProcessingElement.js";
import { PostProcessingEffectType } from "../../../enums/index.js";
import { Color } from "../../../core/colors/index.js";

/**
 * True 3D volumetric fog ("Froxel Stage 3") parameters.
 *
 * V1 is WebGPU-only (compute-based 3D in-scattering against point/spot/directional lights with
 * cascaded-shadow-map self-shadowing), reusing the clustered light grid as the froxel grid
 * (Option R, see ADR 0031 / `.agents/scratches/volumetric-froxel-step3-plan.md`). WebGL2 support
 * (CPU-culling + data texture) is a separate follow-up step; WebGL1 stays with the analytic fog
 * of `Scene.fog`.
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
   * Overall intensity multiplier applied to the accumulated in-scattering before compositing
   * (default: 1.0).
   */
  public intensity: number = 1.0;

  /**
   * Forward-scattering asymmetry factor (-1.0 to 1.0, default: 0.4) corresponding to the
   * Henyey-Greenstein phase function g. Positive g boosts forward scattering towards the light,
   * negative g boosts back scattering. 0 is isotropic.
   */
  public asymmetry: number = 0.4;

  /**
   * Whether directional (sun/moon) light contributes to the in-scattering volume through the
   * cascaded shadow map, giving volumetric self-shadowing in V1 (default: true).
   */
  public castDirectionalShadow: boolean = true;

  /**
   * Tint color applied to the accumulated in-scattering (default: neutral white). Multiplied by
   * each contributing light's own color and intensity.
   */
  public color: Color = new Color(1.0, 1.0, 1.0);

  /**
   * Interleaved gradient noise jitter strength to break up raymarch banding (0..1, default: 0.25).
   * 0 disables jitter entirely for a fixed, deterministic volume.
   */
  public jitter: number = 0.25;
}
