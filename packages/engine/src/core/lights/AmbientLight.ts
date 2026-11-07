import type { LightOptions } from "./AbstractLight.js";
import { AbstractLight } from "./AbstractLight.js";
import { LightType } from "../../enums/index.js";
import type { LightDataInterface } from "../../interfaces/index.js";

/**
 * Ambient light that illuminates all objects in the scene equally.
 */
export class AmbientLight extends AbstractLight {
  /** @inheritdoc */
  public override readonly type: LightType = LightType.AMBIENT;

  /**
   * Creates a new AmbientLight.
   * @param options The configuration options for the light.
   */
  constructor(options: LightOptions = {}) {
    const { name = "AmbientLight" } = options;
    super({ ...options, name });
  }

  /** @inheritdoc */
  public override applyTo(data: LightDataInterface): void {
    data.aCol.copyFrom(this.linearColor);
    data.aIntensity = this.intensity;
  }
}
