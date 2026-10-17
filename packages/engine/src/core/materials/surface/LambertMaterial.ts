import fragGLSL from "./shaders/Lambert.frag.glsl?raw";
import fragGLSL100 from "./shaders/Lambert.frag.glsl100?raw";
import fragWGSL from "./shaders/Lambert.frag.wgsl?raw";
import { AbstractMaterial } from "../AbstractMaterial.js";
import { MaterialType, ShaderPropertyType } from "../../../enums/index.js";
import { Color } from "../../colors/index.js";
import type { Texture } from "../../textures/index.js";
import type { RenderManifest, ShaderDefinition } from "../../../renderers/shaders/index.js";
import { StandardWebGPULayout } from "../../../renderers/shaders/index.js";
import { Vector2D } from "../../../math/index.js";

/**
 * Configuration options for Lambert material.
 */
export interface LambertMaterialOptions {
  /** The base color of the material. Defaults to white. */
  color?: Color;
  /** The diffuse texture map. Defaults to undefined. */
  diffuseMap?: Texture | undefined;
  /** The normal texture map. Defaults to undefined. */
  normalMap?: Texture | undefined;
  /** Scale factor for the normal map to control strength and flip X/Y. Defaults to (1, 1). */
  normalScale?: Vector2D;
}

/**
 * A material that uses the Lambertian reflectance model.
 */
export class LambertMaterial extends AbstractMaterial {
  /** The diffuse texture map. */
  public diffuseMap: Texture | undefined;
  /** The normal map texture. */
  public normalMap: Texture | undefined;

  /** Scale factor for the normal map to control strength and flip X/Y. */
  public normalScale: Vector2D;

  constructor(options: LambertMaterialOptions = {}) {
    super(MaterialType.LAMBERT);
    const {
      color = new Color(1, 1, 1, 1),
      diffuseMap = undefined,
      normalMap = undefined,
      normalScale = new Vector2D(1, 1),
    } = options;
    this.color = Object.isFrozen(color) ? color.clone() : color;
    this.diffuseMap = diffuseMap;
    this.normalMap = normalMap;
    this.normalScale = normalScale;
  }

  /** @inheritdoc */
  public override getRenderManifest(): RenderManifest {
    if (undefined === this._renderManifest) {
      this._renderManifest = this._createBaseManifest();
    }

    this._syncBaseManifestState();
    this._syncTexOffsetRepeat(this.diffuseMap);

    const props = this._renderManifest.properties as Record<string, unknown>;
    const texs = this._renderManifest.textures as Record<string, unknown>;

    (props["u_extraParams"] as number[])[2] = this.normalScale.x;
    (props["u_extraParams"] as number[])[3] = this.normalScale.y;

    texs["u_diffuseMap"] = this.diffuseMap;
    texs["u_normalMap"] = this.normalMap;

    const flags: string[] = [];
    if (this.normalMap) flags.push("USE_NORMAL_MAP");
    this._renderManifest.flags = flags;

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
        textures: {
          u_diffuseMap: { type: ShaderPropertyType.TEXTURE },
          u_normalMap: { type: ShaderPropertyType.TEXTURE },
        },
      },
    };
  }
}
