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
    const lin = this.linearColor;
    const k = this.intensity;
    const r = lin.r * k;
    const g = lin.g * k;
    const b = lin.b * k;
    data.aCol.set(data.aCol.r + r, data.aCol.g + g, data.aCol.b + b, 1);
    if (data.aGroundCol) {
      data.aGroundCol.set(data.aGroundCol.r + r, data.aGroundCol.g + g, data.aGroundCol.b + b, 1);
    }
    data.aIntensity = 1;
  }
}
