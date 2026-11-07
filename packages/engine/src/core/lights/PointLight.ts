import type { LightOptions } from "./AbstractLight.js";
import { AbstractLight, MAX_CLUSTERED_LIGHTS_PER_TYPE } from "./AbstractLight.js";
import { LightType } from "../../enums/index.js";
import type { LightDataInterface } from "../../interfaces/index.js";
import type { InspectorField } from "../Inspectable.js";

/**
 * Configuration options for point light.
 */
export interface PointLightOptions extends LightOptions {
  /** The maximum distance of the light. Defaults to 50.0. */
  distance?: number;
  /** The decay factor of the light. Defaults to 2.0. */
  decay?: number;
}

/**
 * Point light that emits light in all directions from a single point.
 */
export class PointLight extends AbstractLight {
  /** Own fields on top of `AbstractLight.inspector` -- see `collectInspectorSchema()`. */
  public static override readonly inspector: Record<string, InspectorField> = {
    distance: {
      type: "number",
      label: "Distance",
      min: 0,
      max: 100,
      step: 0.1,
      row: "attenuation",
    },
    decay: { type: "number", label: "Decay", min: 0, max: 5, step: 0.01, row: "attenuation" },
  };

  /** @inheritdoc */
  public override readonly type: LightType = LightType.POINT;

  /** The maximum distance of the light. */
  public distance: number;

  /** The decay factor of the light. */
  public decay: number;

  /**
   * Creates a new PointLight.
   * @param options The configuration options for the light.
   */
  constructor(options: PointLightOptions = {}) {
    const { distance = 50.0, decay = 2.0, name = "PointLight" } = options;
    // 256 per ADR 0052: six faces per light share the spot atlas layer size.
    // Point lights read shadowBias in metres toward the light (ADR 0052), not as a depth offset.
    super({ shadowResolution: 256, shadowBias: 0.01, ...options, name });
    this.distance = distance;
    this.decay = decay;
  }

  /** @inheritdoc */
  public override applyTo(data: LightDataInterface): void {
    // Global cap, not per-object nearest-N selection -- see docs/adr/0004-point-spot-light-global-cap.md.
    if (MAX_CLUSTERED_LIGHTS_PER_TYPE > data.pLights.length) {
      data.pLights.push(this);
    }
  }
}
