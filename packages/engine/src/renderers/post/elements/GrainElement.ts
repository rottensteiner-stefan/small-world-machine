import { PostProcessingElement } from "../PostProcessingElement.js";
import { PostProcessingEffectType } from "../../../enums/index.js";

export class GrainElement extends PostProcessingElement {
  public readonly type = PostProcessingEffectType.GRAIN;

  /** Controls the intensity/opacity of the film grain (default: 0.05) */
  public intensity: number = 0.05;

  public override packUniforms(out: Float32Array, offset: number): void {
    out[offset + 6] = this.intensity; // b.z: grainIntensity
  }

  public override structuralKey(): string {
    return `${this.enabled ? 1 : 0}`;
  }
}
