import fragGLSL from "./shaders/World.frag.glsl?raw";
import fragGLSL100 from "./shaders/World.frag.glsl100?raw";
import fragWGSL from "./shaders/World.frag.wgsl?raw";
import { AbstractMaterial } from "./AbstractMaterial.js";
import { MaterialType, ShaderPropertyType } from "../../enums/index.js";
import { Color } from "../colors/index.js";
import { Texture } from "../textures/index.js";
import {
  RenderManifest,
  ShaderDefinition,
  StandardWebGPULayout,
} from "../../renderers/shaders/index.js";

export type WorldMaterialOptions = {
  color?: Color;
  diffuseMap?: Texture;
};

/**
 * A lit, matte material that uses triplanar mapping to render seamless textures across world space
 * coordinates. Receives directional/point lights and cascaded shadows.
 * Ideal for terrain, rocks, walls, and architectural structures.
 */
export class WorldMaterial extends AbstractMaterial {
  /** The diffuse texture map. */
  public diffuseMap: Texture | undefined;

  constructor(options?: WorldMaterialOptions) {
    super(MaterialType.WORLD);
    if (options) {
      if (options.color) {
        this.color.copyFrom(options.color);
      }
      this.diffuseMap = options.diffuseMap;
    }
  }

  /** @inheritdoc */
  public override getRenderManifest(): RenderManifest {
    if (undefined === this._renderManifest) {
      this._renderManifest = this._createBaseManifest();
      this._renderManifest.properties["u_specColor"] = new Float32Array([0, 0, 0, 1]);
      this._renderManifest.properties["u_extraParams"] = [1.0, 0, 0, 0];
      this._renderManifest.textures["u_diffuseMap"] = this.diffuseMap;
    }

    this._syncBaseManifestState();

    const props = this._renderManifest.properties as Record<string, unknown>;
    const texs = this._renderManifest.textures as Record<string, unknown>;

    if (this.diffuseMap) {
      (props["u_texRepeat"] as number[])[0] = this.diffuseMap.repeat.x;
      (props["u_texRepeat"] as number[])[1] = this.diffuseMap.repeat.y;
    } else {
      (props["u_texRepeat"] as number[])[0] = 1;
      (props["u_texRepeat"] as number[])[1] = 1;
    }

    texs["u_diffuseMap"] = this.diffuseMap;

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
        wgsl: `[WGSL_STRUCTS]\n[WGSL_PBR_MATH]\n[WGSL_VS]\n${fragWGSL}`,
      },
      layout: {
        ...StandardWebGPULayout,
        textures: { u_diffuseMap: { type: ShaderPropertyType.TEXTURE } },
      },
    };
  }
}
