import fragGLSL from "./shaders/Phong.frag.glsl?raw";
import fragGLSL100 from "./shaders/Phong.frag.glsl100?raw";
import fragWGSL from "./shaders/Phong.frag.wgsl?raw";
import { AbstractMaterial } from "../AbstractMaterial.js";
import { Color } from "../../colors/index.js";
import { MaterialType, ShaderPropertyType, BlendingMode } from "../../../enums/index.js";
import { Texture } from "../../textures/index.js";
import {
  RenderManifest,
  ShaderDefinition,
  StandardWebGPULayout,
} from "../../../renderers/shaders/index.js";
import { Vector2D } from "../../../math/index.js";
import { InspectorField } from "../../Inspectable.js";

/**
 * Configuration options for Phong material.
 */
export interface PhongMaterialOptions {
  /** The base color of the material. Defaults to white. */
  color?: Color;
  /** The specular reflection color. Defaults to white. */
  specularColor?: Color;
  /** The shininess factor. Defaults to 32.0. */
  shininess?: number;
  /** The diffuse texture map. Defaults to undefined. */
  diffuseMap?: Texture | undefined;
  /** The normal map texture. Defaults to undefined. */
  normalMap?: Texture | undefined;
  /** Scale factor for the normal map to control strength and flip X/Y. Defaults to (1, 1). */
  normalScale?: Vector2D;
  /** The specular map texture. Defaults to undefined. */
  specularMap?: Texture | undefined;
  /** Whether the material is transparent. Defaults to false. */
  transparent?: boolean;
  /** Alpha cutoff threshold. Fragments with alpha below this value are discarded. Defaults to 0.0. */
  alphaTest?: number;
}

/**
 * Material that implements the Phong reflection model.
 */
export class PhongMaterial extends AbstractMaterial {
  /** Own fields on top of `AbstractMaterial.inspector` -- see `collectInspectorSchema()`. */
  public static override readonly inspector: Record<string, InspectorField> = {
    specularColor: { type: "color", label: "Specular" },
    shininess: { type: "number", label: "Shininess", min: 0, max: 256, step: 1 },
    alphaTest: { type: "number", label: "Alpha Test", min: 0, max: 1, step: 0.01 },
  };

  /** The specular reflection color. */
  public specularColor: Color;

  /** The shininess factor. */
  public shininess: number;

  /** The diffuse texture map. */
  public diffuseMap: Texture | undefined;

  /** The normal map texture. */
  public normalMap: Texture | undefined;

  /** Scale factor for the normal map to control strength and flip X/Y. */
  public normalScale: Vector2D;

  /** The specular map texture. */
  public specularMap: Texture | undefined;

  /** Alpha cutoff threshold. */
  public alphaTest: number;

  /**
   * Creates a new PhongMaterial.
   * @param options The configuration options for the material.
   */
  constructor(options: PhongMaterialOptions = {}) {
    super(MaterialType.PHONG);
    const {
      color = new Color(1, 1, 1, 1),
      specularColor = new Color(1, 1, 1, 1),
      shininess = 32.0,
      diffuseMap = undefined,
      normalMap = undefined,
      normalScale = new Vector2D(1, 1),
      specularMap = undefined,
      transparent = false,
      alphaTest = 0.0,
    } = options;
    this.color = Object.isFrozen(color) ? color.clone() : color;
    this.specularColor = Object.isFrozen(specularColor) ? specularColor.clone() : specularColor;
    this.shininess = shininess;
    this.diffuseMap = diffuseMap;
    this.normalMap = normalMap;
    this.normalScale = normalScale;
    this.specularMap = specularMap;
    this.transparent = transparent;
    this.alphaTest = alphaTest;
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

    props["u_color"] = this.color.toFloat32Array();
    props["u_specColor"] = this.specularColor.toFloat32Array();
    props["u_shininess"] = this.shininess;
    (props["u_extraParams"] as number[])[1] = this.alphaTest;
    (props["u_extraParams"] as number[])[2] = this.normalScale.x;
    (props["u_extraParams"] as number[])[3] = this.normalScale.y;

    texs["u_diffuseMap"] = this.diffuseMap;
    texs["u_normalMap"] = this.normalMap;
    texs["u_specularMap"] = this.specularMap;

    const flags: string[] = [];
    if (this.normalMap) flags.push("USE_NORMAL_MAP");
    if (this.specularMap) flags.push("USE_SPECULAR_MAP");
    this._renderManifest.flags = flags;

    if (this._renderManifest.state) {
      this._renderManifest.state.blending = this.transparent
        ? BlendingMode.ALPHA
        : BlendingMode.OPAQUE;
      this._renderManifest.state.depthWrite = !this.transparent;
    }

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
          u_specularMap: { type: ShaderPropertyType.TEXTURE },
        },
      },
    };
  }
}
