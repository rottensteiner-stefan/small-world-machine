import { PostProcessingElement } from "../PostProcessingElement.js";
import { PostProcessingEffectType } from "../../../enums/index.js";
import { Vector3D } from "../../../math/index.js";

/**
 * Gravitational Lensing (Black Hole relativistic spacetime distortion & Einstein ring).
 */
export class GravitationalLensingElement extends PostProcessingElement {
  public readonly type = PostProcessingEffectType.GRAVITATIONAL_LENSING;

  /**
   * Screen-space projected singularity position in NDC [-1, 1].
   * Z >= -1 means in front of camera; Z = -2 (sentinel from Camera.project) bypasses lensing.
   */
  public singularityScreenPos: Vector3D = new Vector3D(0, 0, 1);

  /** Radius of the event horizon in normalized screen coordinates (default: 0.03). */
  public eventHorizonRadius: number = 0.03;

  /** Strength of the gravitational space-bending deflection (default: 0.25). */
  public strength: number = 0.25;

  /** Spaghettification factor near event horizon (default: 0.15). */
  public spaghettification: number = 0.15;

  /** Relativistic beaming intensity (default: 1.2). */
  public relativisticBeaming: number = 1.2;

  /** Photon sphere / Einstein ring glow multiplier (default: 2.5). */
  public ringGlowIntensity: number = 2.5;

  public override packUniforms(out: Float32Array, offset: number): void {
    const o = offset;
    out[o + 32] = this.singularityScreenPos.x; // singularityPos.x
    out[o + 33] = this.singularityScreenPos.y; // singularityPos.y
    out[o + 34] = this.singularityScreenPos.z; // singularityPos.z
    out[o + 35] = this.eventHorizonRadius; // singularityPos.w
    out[o + 36] = this.strength; // lensingParams.x
    out[o + 37] = this.spaghettification; // lensingParams.y
    out[o + 38] = this.relativisticBeaming; // lensingParams.z
    out[o + 39] = this.ringGlowIntensity; // lensingParams.w
  }
}
