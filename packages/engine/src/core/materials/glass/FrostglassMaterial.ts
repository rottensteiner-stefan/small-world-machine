import fragGLSL from "./shaders/Frostglass.frag.glsl?raw";
import fragGLSL100 from "./shaders/Frostglass.frag.glsl100?raw";
import fragWGSL from "./shaders/Frostglass.frag.wgsl?raw";
import { AbstractMaterial } from "../AbstractMaterial.js";
import { Color } from "../../colors/index.js";
import { MaterialType, ShaderPropertyType, BlendingMode } from "../../../enums/index.js";
import type { Texture } from "../../textures/index.js";
import type { RenderManifest, ShaderDefinition } from "../../../renderers/shaders/index.js";
import { StandardWebGPULayout } from "../../../renderers/shaders/index.js";
import { Vector3D } from "../../../math/index.js";

export interface FrostglassMaterialOptions {
  color?: Color;
  metallic?: number;
  roughness?: number;
  blurRadius?: number;
  transmission?: number;
  clarityPulseCenter?: Vector3D;
  clarityPulseRadius?: number;
  normalMap?: Texture | undefined;
}

export class FrostglassMaterial extends AbstractMaterial {
  public override color: Color;
  public metallic: number;
  public roughness: number;
  public blurRadius: number;
  public transmission: number;
  public clarityPulseCenter: Vector3D;
  public clarityPulseRadius: number;
  public normalMap?: Texture;

  constructor(options: FrostglassMaterialOptions = {}) {
    super(MaterialType.FROSTGLASS);
    this.color = options.color || new Color(1, 1, 1, 1);
    this.metallic = options.metallic ?? 0.0;
    this.roughness = options.roughness ?? 0.4;
    this.blurRadius = options.blurRadius ?? 0.04;
    this.transmission = options.transmission ?? 1.0;
    this.clarityPulseCenter = options.clarityPulseCenter ?? new Vector3D(0, 0, 0);
    this.clarityPulseRadius = options.clarityPulseRadius ?? 0.0;

    if (options.normalMap) {
      this.normalMap = options.normalMap;
    }
  }

  /**
   * Creates an independent copy of this material. Each Frostglass panel needs its own
   * instance so the Controller can animate clarityPulseCenter/clarityPulseRadius per
   * panel without every other panel sharing the same template flashing in sync.
   */
  public override clone(): FrostglassMaterial {
    return new FrostglassMaterial({
      color: new Color(this.color.r, this.color.g, this.color.b, this.color.a),
      metallic: this.metallic,
      roughness: this.roughness,
      blurRadius: this.blurRadius,
      transmission: this.transmission,
      clarityPulseCenter: this.clarityPulseCenter.clone(),
      clarityPulseRadius: this.clarityPulseRadius,
      normalMap: this.normalMap,
    });
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

    // We repurpose liquidParams for frostglass parameters
    (props["u_liquidParams"] as number[])[0] = this.blurRadius;
    (props["u_liquidParams"] as number[])[1] = this.transmission;

    // We repurpose extraParams for clarity pulse (x, y, z, radius)
    (props["u_extraParams"] as number[])[0] = this.clarityPulseCenter.x;
    (props["u_extraParams"] as number[])[1] = this.clarityPulseCenter.y;
    (props["u_extraParams"] as number[])[2] = this.clarityPulseCenter.z;
    (props["u_extraParams"] as number[])[3] = this.clarityPulseRadius;

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
