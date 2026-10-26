import { CullMode, CustomShaderMaterial, StandardWebGPULayout } from "@small-world-machine/engine";
import GLSL_FRAG from "./shaders/SkyMaterial.frag.glsl?raw";
import GLSL_VERT from "./shaders/SkyMaterial.vert.glsl?raw";
import WGSL from "./shaders/SkyMaterial.wgsl?raw";
import type { SkyColor } from "./DayNightCycle.js";

/**
 * Procedural sky of the voxel prototype (M6): horizon-to-zenith gradient, sun and moon discs and
 * twinkling stars, drawn by a `CustomShaderMaterial` on a cube that follows the camera (GLSL300
 * for WebGL2, WGSL for WebGPU; the two sources must keep the same look). Everything that changes
 * over the day arrives through three lanes written in place, so a frame allocates nothing:
 *
 * - `u_matParam0 = [sunDirection.xyz, starVisibility]` (the moon is opposite the sun)
 * - `u_matParam1 = [horizonColor.rgb, time]`
 * - `u_matParam2 = [zenithColor.rgb, 0]`
 */
export class SkyMaterial extends CustomShaderMaterial {
  private readonly _sunLane: number[] = [0, 1, 0, 0];
  private readonly _horizonLane: number[] = [0.45, 0.65, 0.95, 0];
  private readonly _zenithLane: number[] = [0.2, 0.4, 0.82, 0];

  constructor() {
    super({
      sources: {
        glsl300: { vs: GLSL_VERT, fs: GLSL_FRAG },
        wgsl: WGSL,
      },
      layout: { ...StandardWebGPULayout, textures: {} },
      properties: {},
      cullMode: CullMode.NONE,
      depthWrite: false,
    });
    this.properties["u_matParam0"] = this._sunLane;
    this.properties["u_matParam1"] = this._horizonLane;
    this.properties["u_matParam2"] = this._zenithLane;
  }

  /** Sets where the sun is (it may be below the horizon) and how visible the stars are [0, 1]. */
  public setSun(direction: readonly [number, number, number], starVisibility: number): void {
    this._sunLane[0] = direction[0];
    this._sunLane[1] = direction[1];
    this._sunLane[2] = direction[2];
    this._sunLane[3] = starVisibility;
  }

  /** Sets the gradient: the colour at the horizon and at the zenith (display-referred sRGB). */
  public setGradient(horizon: SkyColor, zenith: SkyColor): void {
    this._horizonLane[0] = horizon.r;
    this._horizonLane[1] = horizon.g;
    this._horizonLane[2] = horizon.b;
    this._zenithLane[0] = zenith.r;
    this._zenithLane[1] = zenith.g;
    this._zenithLane[2] = zenith.b;
  }

  /** Sets the animation clock (seconds) that drives the star twinkle. */
  public setTime(seconds: number): void {
    this._horizonLane[3] = seconds;
  }
}
