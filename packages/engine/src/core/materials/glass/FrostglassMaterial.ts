import fragGLSL from "./shaders/Frostglass.frag.glsl?raw";
import fragGLSL100 from "./shaders/Frostglass.frag.glsl100?raw";
import fragWGSL from "./shaders/Frostglass.frag.wgsl?raw";
import { AbstractMaterial } from "../AbstractMaterial.js";
import { Color } from "../../colors/index.js";
import {
  MaterialType,
  ShaderFlag,
  ShaderPropertyType,
  BlendingMode,
} from "../../../enums/index.js";
import type { Texture } from "../../textures/index.js";
import type { RenderManifest, ShaderDefinition } from "../../../renderers/shaders/index.js";
import { StandardWebGPULayout } from "../../../renderers/shaders/index.js";
import { Vector3D } from "../../../math/index.js";
import { writeLane4, type MaterialLaneTable } from "../MaterialLanes.js";

/**
 * Typed semantic material-lane table for {@link FrostglassMaterial} (ADR 0027 / ADR 0039).
 * Keeps generic `u_extraParams` (`[ao, alphaTest, normalScale.x, normalScale.y]`) and `u_liquidParams` untouched.
 */
export const FROSTGLASS_LANES = [
  {
    semantic: "frostParameters",
    lane: "u_matParam0",
    note: "x=blurRadius, y=transmission, z/w=0",
  },
  {
    semantic: "clarityPulse",
    lane: "u_matParam1",
    note: "xyz=clarityPulseCenter, w=clarityPulseRadius",
  },
] as const satisfies MaterialLaneTable;

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
    return super.clone() as FrostglassMaterial;
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

    writeLane4(this._renderManifest, FROSTGLASS_LANES[0], this.blurRadius, this.transmission, 0, 0);
    writeLane4(
      this._renderManifest,
      FROSTGLASS_LANES[1],
      this.clarityPulseCenter.x,
      this.clarityPulseCenter.y,
      this.clarityPulseCenter.z,
      this.clarityPulseRadius,
    );

    this._renderManifest.textures["u_normalMap"] = this.normalMap;

    const flags = this._manifestFlags;
    flags.length = 0;
    if (this.normalMap) flags.push(ShaderFlag.NORMAL_MAP);
    this._commitFlags();

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
