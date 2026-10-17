import vertGLSL from "./shaders/Skybox.vert.glsl?raw";
import fragGLSL from "./shaders/Skybox.frag.glsl?raw";
import vertGLSL100 from "./shaders/Skybox.vert.glsl100?raw";
import fragGLSL100 from "./shaders/Skybox.frag.glsl100?raw";
import fragWGSL from "./shaders/Skybox.frag.wgsl?raw";
import { AbstractMaterial } from "./AbstractMaterial.js";
import type { CubeTexture } from "../textures/index.js";
import { CullMode, MaterialType, ShaderPropertyType } from "../../enums/index.js";
import { Color } from "../colors/index.js";
import type { RenderManifest, ShaderDefinition } from "../../renderers/shaders/index.js";
import { StandardWebGPULayout } from "../../renderers/shaders/index.js";

/**
 * Configuration options for skybox material.
 */
export interface SkyboxMaterialOptions {
  /** The base color. Defaults to white. */
  color?: Color;
  /** The cube map texture. Defaults to undefined. */
  cubeMap?: CubeTexture | undefined;
}

/**
 * A material for skyboxes.
 */
export class SkyboxMaterial extends AbstractMaterial {
  /** The cube map texture. */
  public cubeMap: CubeTexture | undefined;

  /**
   * Creates a new SkyboxMaterial.
   * @param options The configuration options.
   */
  constructor(options: SkyboxMaterialOptions = {}) {
    super(MaterialType.SKYBOX);
    const { color = new Color(1, 1, 1, 1), cubeMap = undefined } = options;
    this.color = Object.isFrozen(color) ? color.clone() : color;
    this.cubeMap = cubeMap;
  }

  /** @inheritdoc */
  public override getRenderManifest(): RenderManifest {
    if (undefined === this._renderManifest) {
      this._renderManifest = {
        shaderId: this.type,
        properties: {
          u_color: this.color.toFloat32Array(),
          u_specColor: new Float32Array([1, 1, 1, 1]),
          u_texOffset: [0, 0],
          u_texRepeat: [1, 1],
          u_shininess: 32.0,
          u_isTerrain: 0.0,
          u_metallic: 0.0,
          u_roughness: 0.5,
          u_extraParams: [1.0, 0, 0, 0],
          u_liquidParams: [0, 0, 0, 0],
          u_thresholds: [0, 0, 0, 0],
        },
        textures: {
          u_skybox: this.cubeMap || undefined,
        },
        state: {
          depthWrite: false,
          culling: CullMode.NONE, // Skybox is visible from the inside
        },
      };
    }

    const props = this._renderManifest.properties as Record<string, unknown>;
    const texs = this._renderManifest.textures as Record<string, unknown>;

    props["u_color"] = this.color.toFloat32Array();
    texs["u_skybox"] = this.cubeMap || undefined;

    return this._renderManifest;
  }

  /** @inheritdoc */
  public override getShaderDefinition(): ShaderDefinition {
    return {
      id: this.type,
      sources: {
        glsl300: {
          vs: vertGLSL,
          fs: fragGLSL,
        },
        glsl100: {
          vs: vertGLSL100,
          fs: fragGLSL100,
        },
        wgsl: `[WGSL_STRUCTS]\n${fragWGSL}`,
      },
      layout: {
        ...StandardWebGPULayout,
        textures: { u_skybox: { type: ShaderPropertyType.TEXTURE } },
      },
    };
  }
}
