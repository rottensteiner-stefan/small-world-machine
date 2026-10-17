import type { LightOptions } from "./AbstractLight.js";
import { AbstractLight } from "./AbstractLight.js";
import { LightType } from "../../enums/index.js";
import type { LightDataInterface } from "../../interfaces/index.js";

/**
 * Configuration options for area light.
 */
export interface AreaLightOptions extends LightOptions {
  /** The width of the light area. Defaults to 5.0. */
  width?: number;
  /** The height/length of the light area. Defaults to 5.0. */
  height?: number;
  /** The maximum distance of the light. Defaults to 0.0 (infinite). */
  distance?: number;
  /** The decay factor of the light. Defaults to 2.0. */
  decay?: number;
}

/** Maximum number of simultaneous AreaLights supported by shader forward pipelines. Raising this
 * requires also raising every hardcoded `AreaLight u_areaLights[4]` GLSL array declaration in
 * lockstep -- GLSL can't import a TS constant, so these are kept in sync by hand:
 * `web_gl2/chunks/lights.frag.glsl`, `web_gl2/chunks/base_vertex_header.vert.glsl`,
 * `core/materials/shaders/FluidSurface.vert.glsl`. */
export const MAX_AREA_LIGHTS = 4;

/**
 * Area light that emits light from a rectangular plane.
 */
export class AreaLight extends AbstractLight {
  /** @inheritdoc */
  public override readonly type: LightType = LightType.AREA;

  /** The width of the light area. */
  public width: number;

  /** The height/length of the light area. */
  public height: number;

  /** The maximum distance of the light. */
  public distance: number;

  /** The decay factor of the light. */
  public decay: number;

  /**
   * Creates a new AreaLight.
   * @param options The configuration options for the light.
   */
  constructor(options: AreaLightOptions = {}) {
    const { width = 5.0, height = 5.0, distance = 0.0, decay = 2.0, name = "AreaLight" } = options;
    super({ ...options, name });
    this.width = width;
    this.height = height;
    this.distance = distance;
    this.decay = decay;
  }

  /** @inheritdoc */
  public override applyTo(data: LightDataInterface): void {
    if (MAX_AREA_LIGHTS > data.aLights.length) {
      data.aLights.push(this);
    }
  }
}
