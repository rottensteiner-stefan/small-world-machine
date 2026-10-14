import { PostProcessingElement } from "../PostProcessingElement.js";
import { PostProcessingEffectType } from "../../../enums/index.js";
import { Color } from "../../../core/colors/index.js";

/**
 * Atmospheric crepuscular rays / god rays effect parameters.
 * Supports a 2-tier architecture:
 * - WebGL2 & WebGPU (Tier 2): Half-resolution raymarching against Cascaded Shadow Maps (CSM)
 *   with Schlick phase function, Interleaved Gradient Noise (IGN) jitter, and 2x2 depth-aware
 *   cross-bilateral upsampling.
 * - WebGL1 (Tier 1): 2D screen-space radial pull-blur with sky/depth luminance masking and
 *   camera-Z inversion falloff guard.
 */
export class LightShaftsElement extends PostProcessingElement {
  public readonly type = PostProcessingEffectType.LIGHT_SHAFTS;

  /** Off by default -- opt-in post-processing effect. */
  public override enabled: boolean = false;

  /** Overall intensity multiplier for the scattered in-scattering light (default: 1.0). */
  public intensity: number = 1.0;

  /**
   * Atmospheric scattering coefficient sigma_s in participating media (default: 0.05).
   * Higher values make the haze denser and beams more pronounced.
   */
  public density: number = 0.05;

  /**
   * Forward-scattering asymmetry factor (-1.0 to 1.0, default: 0.7).
   * Corresponds to Henyey-Greenstein g or Schlick k factor. Values between 0.6 and 0.8
   * produce realistic atmospheric forward scattering around the sun.
   */
  public asymmetry: number = 0.7;

  /**
   * Maximum world-space distance along the camera ray to march through participating media (default: 40.0 m).
   */
  public maxDistance: number = 40.0;

  /**
   * Raymarching step count along each ray (clamped between 4 and 32, default: 16).
   */
  public samples: number = 16;

  /**
   * Step attenuation decay factor for Tier 1 radial blur (default: 0.95).
   */
  public decay: number = 0.95;

  /**
   * Accumulation sample weight for Tier 1 radial blur (default: 0.5).
   */
  public weight: number = 0.5;

  /**
   * Sunlight color tint applied to the in-scattered light shafts (default: warm sunlight).
   */
  public color: Color = new Color(1.0, 0.95, 0.85);

  /**
   * Relative depth discontinuity threshold for the 2x2 depth-aware cross-bilateral upsample filter (default: 0.05).
   * Edges with relative depth steps greater than this threshold are preserved to eliminate edge bleeding.
   */
  public depthThreshold: number = 0.05;
}
