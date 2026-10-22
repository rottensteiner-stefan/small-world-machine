import fragGLSL from "./shaders/EvsmMoment.frag.glsl?raw";
import fragGLSL100 from "./shaders/EvsmMoment.frag.glsl100?raw";
import fragWGSL from "./shaders/EvsmMoment.frag.wgsl?raw";
import { AbstractMaterial } from "./AbstractMaterial.js";
import { MaterialType, ShaderPropertyType } from "../../enums/index.js";
import type { Texture } from "../textures/index.js";
import type { RenderManifest, ShaderDefinition } from "../../renderers/shaders/index.js";
import { StandardWebGPULayout } from "../../renderers/shaders/index.js";

/**
 * Configuration options for EvsmMomentMaterial.
 */
export type EvsmMomentMaterialOptions = {
  diffuseMap?: Texture;
  alphaTest?: number;
};

/**
 * A specialized material for rendering the EVSM moment texture (ADR 0043): instead of a depth
 * target it writes the 4 exponentially warped variance channels `(e^{cd}, e^{2cd}, -e^{-cd},
 * e^{-2cd})` into an `rgba32float` color attachment. It only evaluates alpha testing if a diffuse
 * texture is provided. The pass attaches an already-rendered depth array layer as its depth
 * attachment with `depthWrite=false` + `depthTest=true` (LEQUAL), so it re-emits moments only for
 * the exact front-most surface the depth pass just wrote -- no second depth buffer, no
 * self-shadowing mismatch.
 */
export class EvsmMomentMaterial extends AbstractMaterial {
  /** The diffuse texture map used exclusively for alpha testing. */
  public diffuseMap: Texture | undefined;

  /** Alpha cutoff threshold. */
  public alphaTest: number;

  constructor(options?: EvsmMomentMaterialOptions) {
    super(MaterialType.EVSM);
    this.diffuseMap = options?.diffuseMap;
    this.alphaTest = options?.alphaTest ?? 0.0;
  }

  /** @inheritdoc */
  public override getRenderManifest(): RenderManifest {
    if (undefined === this._renderManifest) {
      this._renderManifest = {
        shaderId: this.type,
        properties: {
          u_color: new Float32Array([1, 1, 1, 1]),
          u_specColor: new Float32Array([1, 1, 1, 1]),
          u_texOffset: [0, 0],
          u_texRepeat: [1, 1],
          u_shininess: 0.0,
          u_isTerrain: 0.0,
          u_metallic: 0.0,
          u_roughness: 0.5,
          u_extraParams: [1.0, this.alphaTest, 0, 0], // extraParams.y = alphaTest
          u_liquidParams: [0, 0, 0, 0],
          u_thresholds: [0, 0, 0, 0],
        },
        textures: {
          u_diffuseMap: this.diffuseMap,
        },
      };
    }

    const props = this._renderManifest.properties as Record<string, unknown>;
    const texs = this._renderManifest.textures as Record<string, unknown>;

    (props["u_extraParams"] as number[])[1] = this.alphaTest;

    if (this.diffuseMap) {
      (props["u_texOffset"] as number[])[0] = this.diffuseMap.offset.x;
      (props["u_texOffset"] as number[])[1] = this.diffuseMap.offset.y;
      (props["u_texRepeat"] as number[])[0] = this.diffuseMap.repeat.x;
      (props["u_texRepeat"] as number[])[1] = this.diffuseMap.repeat.y;
      texs["u_diffuseMap"] = this.diffuseMap;
    } else {
      (props["u_texOffset"] as number[])[0] = 0;
      (props["u_texOffset"] as number[])[1] = 0;
      (props["u_texRepeat"] as number[])[0] = 1;
      (props["u_texRepeat"] as number[])[1] = 1;
      // Omit the key entirely -- mirrors DepthMaterial: a shared manifest is a no-op for the
      // diffuse map when the material has none, so the cache never releases a caster's real
      // diffuse texture.
      delete texs["u_diffuseMap"];
    }

    this._renderManifest.state = {
      ...this._renderManifest.state,
      culling: this.cullMode,
      // The moment pass reuses the depth array layer rendered moments earlier. LEQUAL + no write
      // (GPUPipelineCache turns depthTest=true into "less-equal") emits moments for exactly the
      // front-most surface the depth pass stored, and never overwrites that depth.
      depthWrite: false,
      depthTest: true,
      transparent: false, // Never transparent in blending
    };

    return this._renderManifest;
  }

  /** @inheritdoc */
  public override getShaderDefinition(): ShaderDefinition {
    return {
      id: this.type,
      sources: {
        glsl300: {
          vs: "[BASE_VERTEX_HEADER][BASE_VERTEX_MAIN]",
          fs: fragGLSL,
        },
        glsl100: {
          vs: "[BASE_VS]",
          fs: fragGLSL100,
        },
        wgsl: `[WGSL_STRUCTS]\n[WGSL_VS]\n${fragWGSL}`,
      },
      layout: {
        ...StandardWebGPULayout,
        textures: { u_diffuseMap: { type: ShaderPropertyType.TEXTURE } },
      },
    };
  }
}
