import fragGLSL from "./shaders/Depth.frag.glsl?raw";
import fragGLSL100 from "./shaders/Depth.frag.glsl100?raw";
import fragWGSL from "./shaders/Depth.frag.wgsl?raw";
import { AbstractMaterial } from "./AbstractMaterial.js";
import { MaterialType, ShaderPropertyType } from "../../enums/index.js";
import { Texture } from "../textures/index.js";
import {
  RenderManifest,
  ShaderDefinition,
  StandardWebGPULayout,
} from "../../renderers/shaders/index.js";

/**
 * Configuration options for DepthMaterial.
 */
export type DepthMaterialOptions = {
  diffuseMap?: Texture;
  alphaTest?: number;
};

/**
 * A specialized material for rendering into a shadow map (depth buffer).
 * It only evaluates alpha testing if a diffuse texture is provided, otherwise it is extremely fast.
 */
export class DepthMaterial extends AbstractMaterial {
  /** The diffuse texture map used exclusively for alpha testing. */
  public diffuseMap: Texture | undefined;

  /** Alpha cutoff threshold. */
  public alphaTest: number;

  constructor(options?: DepthMaterialOptions) {
    super(MaterialType.DEPTH);
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
      // Omit the key entirely rather than setting it to `undefined` -- this manifest is shared
      // across every opaque object in DepthPrePassGPU's fast (no alpha-cutout) path, and
      // GPUTextureResourceCache.acquireTextures() diffs `Object.keys(textures)` per object
      // against that object's OWN main-pass manifest (which DOES carry a real `u_diffuseMap`).
      // An explicit `undefined` value here would still count as "this pass touched the key",
      // spuriously releasing (and destroying) the object's actual diffuse GPU texture every
      // frame even though nothing about it changed -- omitting the key makes this pass a no-op
      // for `u_diffuseMap` instead.
      delete texs["u_diffuseMap"];
    }

    this._renderManifest.state = {
      ...this._renderManifest.state,
      culling: this.cullMode,
      depthWrite: true, // Depth must ALWAYS be written
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
