import {
  CustomShaderMaterial,
  ShaderPropertyType,
  StandardWebGPULayout,
  VERTEX_COLOR_FLAG,
} from "@small-world-machine/engine";
import type { TextureArray } from "@small-world-machine/engine/core/textures/index.js";
import GLSL_FRAG from "./shaders/BlockMaterial.frag.glsl?raw";
import GLSL_VERT from "./shaders/BlockMaterial.vert.glsl?raw";
import WGSL from "./shaders/BlockMaterial.wgsl?raw";

/**
 * Block material: a `CustomShaderMaterial` whose shaders sample the block palette as an array
 * texture, so atlas tiles can never bleed into each other (array layers are separate textures):
 * `sampler2DArray` in GLSL300 (WebGL2) and `texture_2d_array` in WGSL (WebGPU, M6). WebGL1 has no
 * array textures; a 2D-atlas fallback would be a separate material.
 *
 * - The palette is bound as `u_diffuseMap`, the one texture name WebGPU binds as an array view
 *   (the engine flags a `TextureArray` as `USE_TEXTURE_ARRAY` on its own).
 * - Layer, AO and baked light travel per vertex in the vertex color (`a_color` / location 11,
 *   `USE_VERTEX_COLOR`): `x` = atlas layer, `y` = AO, `z` = baked light.
 * - The dynamic lanes are shared by both tiers: `u_matParam0 = [daylight, sunDirection.xyz]`,
 *   `u_matParam1 = [lightTint.rgb, 0]`. They are written in place, nothing allocates per frame.
 */
export class BlockMaterial extends CustomShaderMaterial {
  constructor(atlas: TextureArray) {
    super({
      sources: {
        glsl300: { vs: GLSL_VERT, fs: GLSL_FRAG },
        wgsl: WGSL,
      },
      // The WGSL path packs the fixed 512-byte object block (`u_matParam0/1` ride in it); GLSL
      // reads the same lanes by name.
      layout: {
        ...StandardWebGPULayout,
        textures: { u_diffuseMap: { type: ShaderPropertyType.TEXTURE } },
      },
      properties: {},
      textures: { u_diffuseMap: atlas },
      flags: [VERTEX_COLOR_FLAG],
      // M2 water (D3): the atlas alpha drives blending per fragment. Opaque tiles sample
      // alpha 1.0 and render opaque; the water layer blends against the opaque bed. depthWrite
      // stays true so opaque geometry keeps writing depth; the rare water-over-water overlap in
      // the transparent pass is an accepted alpha-sort limitation (documented in the plan).
      transparent: true,
      depthWrite: true,
    });
    this.properties["u_matParam0"] = this._sunLane;
    this.properties["u_matParam1"] = this._tintLane;
  }

  /** `u_matParam0`: `[daylight, sunDirection.xyz]`. */
  private readonly _sunLane: number[] = [1, 0.55, 0.82, 0.28];
  /** `u_matParam1`: `[lightTint.rgb, 0]`. */
  private readonly _tintLane: number[] = [1, 1, 1, 0];

  /** Sets the dynamic day/night ambient multiplier [0.15, 1.0]. */
  public setDaylight(value: number): void {
    this._sunLane[0] = value;
  }

  /** Sets the 3D direction vector of the sun. */
  public setSunDirection(dir: readonly [number, number, number]): void {
    this._sunLane[1] = dir[0];
    this._sunLane[2] = dir[1];
    this._sunLane[3] = dir[2];
  }

  /** Sets the colour of the light (warm at sunrise, blue-grey by moonlight; white by day). */
  public setLightTint(r: number, g: number, b: number): void {
    this._tintLane[0] = r;
    this._tintLane[1] = g;
    this._tintLane[2] = b;
  }
}
