import { CustomShaderMaterial, ShaderPropertyType } from "@small-world-machine/engine";
import type { TextureArray } from "@small-world-machine/engine/core/textures/index.js";
import GLSL_FRAG from "./shaders/BlockMaterial.frag.glsl?raw";
import GLSL_VERT from "./shaders/BlockMaterial.vert.glsl?raw";

/**
 * M0 block material: a `CustomShaderMaterial` (triplet convention) whose GLSL300 pair samples
 * the block palette through a `sampler2DArray`. Scope traceability (dossier §4.2 / Dave-Report
 * §4 M0, §5.4 asset-cleanliness):
 *
 * - **WebGL2 only for M0** -- the dossier roadmap (§4.4 #5) fixes WebGL2 as the default and
 *   WebGPU as a later quality path. A WebGPU (`wgsl`) variant is deliberately NOT shipped yet:
 *   the engine's shared WebGPU material bind group binds a fixed set of 2D texture views
 *   (`u_diffuseMap`, ...), not arbitrary array-texture views, so `texture_2d_array` needs a
 *   small engine-side bind-group extension first -- tracked in `docs/log.md` as a follow-up,
 *   not as scope creep inside M0.
 * - **WebGL1 also deferred** -- WebGL1 has no `sampler2DArray` at all; a 2D-atlas fallback is a
 *   separate material (later milestone).
 *
 * The atlas layer index travels per-vertex in `a_color.x` (engine-fixed attribute location 11);
 * `texture()` samples `vec3(uv, layer)` in the fragment, which makes cross-tile bleeding
 * impossible by construction (array layers are separate textures).
 */
export class BlockMaterial extends CustomShaderMaterial {
  constructor(atlas: TextureArray) {
    super({
      sources: {
        glsl300: { vs: GLSL_VERT, fs: GLSL_FRAG },
      },
      layout: {
        uniforms: {
          u_daylight: { type: ShaderPropertyType.FLOAT },
          u_sunDirection: { type: ShaderPropertyType.VEC3 },
        },
        textures: { u_blockAtlas: { type: ShaderPropertyType.TEXTURE } },
      },
      properties: {
        u_daylight: 1.0,
        u_sunDirection: [0.55, 0.82, 0.28],
      },
      textures: { u_blockAtlas: atlas },
      // M2 water (D3): the atlas alpha drives blending per fragment. Opaque tiles sample
      // alpha 1.0 and render opaque; the water layer blends against the opaque bed. depthWrite
      // stays true so opaque geometry keeps writing depth; the rare water-over-water overlap in
      // the transparent pass is an accepted alpha-sort limitation (documented in the plan).
      transparent: true,
      depthWrite: true,
    });
  }

  /** Sets the dynamic day/night ambient multiplier [0.15, 1.0]. */
  public setDaylight(value: number): void {
    this.properties["u_daylight"] = value;
  }

  /** Sets the 3D direction vector of the sun. */
  public setSunDirection(dir: [number, number, number]): void {
    this.properties["u_sunDirection"] = dir;
  }
}
