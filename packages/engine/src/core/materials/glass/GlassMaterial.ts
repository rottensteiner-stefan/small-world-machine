import fragGLSL from "./shaders/Glass.frag.glsl?raw";
import fragGLSL100 from "./shaders/Glass.frag.glsl100?raw";
import fragWGSL from "./shaders/Glass.frag.wgsl?raw";
import { AbstractMaterial } from "../AbstractMaterial.js";
import { Color } from "../../colors/index.js";
import { MaterialType, ShaderPropertyType, BlendingMode } from "../../../enums/index.js";
import type { Texture } from "../../textures/index.js";
import type { RenderManifest, ShaderDefinition } from "../../../renderers/shaders/index.js";
import { StandardWebGPULayout } from "../../../renderers/shaders/index.js";

export interface GlassMaterialOptions {
  color?: Color;
  metallic?: number;
  roughness?: number;
  ior?: number;
  thickness?: number;
  transmission?: number;
  normalMap?: Texture | undefined;
}

export class GlassMaterial extends AbstractMaterial {
  public override color: Color;
  public metallic: number;
  public roughness: number;
  public ior: number;
  public thickness: number;
  public transmission: number;
  public normalMap?: Texture;

  constructor(options: GlassMaterialOptions = {}) {
    super(MaterialType.GLASS);
    this.color = options.color || new Color(1, 1, 1, 1);
    this.metallic = options.metallic ?? 0.0;
    this.roughness = options.roughness ?? 0.1;
    this.ior = options.ior ?? 1.5;
    this.thickness = options.thickness ?? 1.0;
    this.transmission = options.transmission ?? 1.0;
    if (options.normalMap) {
      this.normalMap = options.normalMap;
    }
  }

  public getRenderManifest(): RenderManifest {
    if (!this._renderManifest) {
      this._renderManifest = this._createBaseManifest();
      this._renderManifest.textures["u_opaqueMap"] = undefined;
    }

    this._syncBaseManifestState();
    this._syncTexOffsetRepeat(this.normalMap);

    const props = this._renderManifest.properties;
    props["u_metallic"] = this.metallic;
    props["u_roughness"] = this.roughness;
    (props["u_liquidParams"] as number[])[0] = this.ior;
    (props["u_liquidParams"] as number[])[1] = this.thickness;
    (props["u_liquidParams"] as number[])[2] = this.transmission;

    this._renderManifest.textures["u_normalMap"] = this.normalMap;

    const flags: string[] = [];
    if (this.normalMap) flags.push("USE_NORMAL_MAP");
    this._renderManifest.flags = flags;

    if (this._renderManifest.state) {
      this._renderManifest.state.transparent = true;
      this._renderManifest.state.blending = BlendingMode.ALPHA;
      this._renderManifest.state.depthWrite = false;
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
          u_opaqueMap: { type: ShaderPropertyType.TEXTURE },
        },
      },
    };
  }
}
