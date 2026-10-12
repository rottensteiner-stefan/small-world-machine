import fragWGSL from "./shaders/Decal.frag.wgsl?raw";
import { AbstractMaterial } from "../AbstractMaterial.js";
import { Texture } from "../../textures/index.js";
import { BlendingMode, CullMode, MaterialType, ShaderPropertyType } from "../../../enums/index.js";
import { Color } from "../../colors/index.js";
import {
  RenderManifest,
  ShaderDefinition,
  StandardWebGPULayout,
} from "../../../renderers/shaders/index.js";

/** Configuration options for `DecalMaterial`. */
export interface DecalMaterialOptions {
  /** Tint multiplied onto the albedo texture; its alpha scales the whole decal. */
  color?: Color;
  /** Albedo (rgb, sRGB) and coverage (a) of the decal. */
  diffuseMap?: Texture | undefined;
  /** Tangent-space normal map of the decal, rotated onto the surface normal beneath it. */
  normalMap?: Texture | undefined;
  /** PBR roughness. Defaults to 0.8. */
  roughness?: number;
  /** PBR metallic. Defaults to 0. */
  metallic?: number;
  /** Fraction of the box (0..0.5) over which the decal fades out towards its edges. Defaults to 0.1. */
  edgeFade?: number;
  /** Surface angle (degrees, against the decal's up axis) where the decal starts fading out. Defaults to 60. */
  angleFadeStart?: number;
  /** Surface angle (degrees) where the decal has faded out completely. Defaults to 85. */
  angleFadeEnd?: number;
}

/**
 * Material of a box-projected `Decal`: lit on top of the already-rendered opaque image, using the
 * opaque depth (and, when `quality.normalBuffer` is on, the normal buffer) beneath it.
 */
export class DecalMaterial extends AbstractMaterial {
  public diffuseMap: Texture | undefined;
  public normalMap: Texture | undefined;
  public roughness: number;
  public metallic: number;
  public edgeFade: number;
  public angleFadeStart: number;
  public angleFadeEnd: number;

  private readonly _fadeParams: Float32Array = new Float32Array(4);

  constructor(options: DecalMaterialOptions = {}) {
    super(MaterialType.DECAL);
    this.color = options.color ?? new Color(1, 1, 1, 1);
    this.diffuseMap = options.diffuseMap;
    this.normalMap = options.normalMap;
    this.roughness = options.roughness ?? 0.8;
    this.metallic = options.metallic ?? 0;
    this.edgeFade = options.edgeFade ?? 0.1;
    this.angleFadeStart = options.angleFadeStart ?? 60;
    this.angleFadeEnd = options.angleFadeEnd ?? 85;
  }

  /** @inheritdoc */
  public override getRenderManifest(): RenderManifest {
    if (undefined === this._renderManifest) {
      const base = this._createBaseManifest();
      base.state = {
        isDecal: true,
        // Back faces only: the box is drawn from the inside, so it also covers the camera being
        // inside it. Coverage is decided per pixel from the depth, not by the rasterised box.
        culling: CullMode.FRONT,
        blending: BlendingMode.ALPHA,
        depthTest: false,
        depthWrite: false,
        // WebGL2 derives its blend toggle from `transparent`; the scene routes by `isDecal` first,
        // so the decal never reaches the transparent list.
        transparent: true,
        skipDepthPrePass: true,
      };
      this._renderManifest = base;
    }

    const manifest = this._renderManifest;
    const props = manifest.properties;
    props["u_color"] = this.color.toFloat32Array();
    props["u_metallic"] = this.metallic;
    props["u_roughness"] = this.roughness;
    props["u_matParam4"] = this._packFadeParams();
    manifest.textures["u_diffuseMap"] = this.diffuseMap;
    manifest.textures["u_normalMap"] = this.normalMap;
    manifest.flags = this.normalMap ? ["USE_NORMAL_MAP"] : [];
    return manifest;
  }

  private _packFadeParams(): Float32Array {
    const toCos = (degrees: number): number => Math.cos((degrees * Math.PI) / 180);
    this._fadeParams[0] = this.edgeFade;
    this._fadeParams[1] = toCos(this.angleFadeStart);
    this._fadeParams[2] = toCos(this.angleFadeEnd);
    return this._fadeParams;
  }

  /** @inheritdoc */
  public override getShaderDefinition(): ShaderDefinition {
    return {
      id: this.type,
      sources: {
        wgsl: `[WGSL_STRUCTS]\n[WGSL_PBR_MATH]\n[WGSL_VS]\n${fragWGSL}`,
      },
      layout: {
        ...StandardWebGPULayout,
        textures: {
          u_diffuseMap: { type: ShaderPropertyType.TEXTURE },
          u_normalMap: { type: ShaderPropertyType.TEXTURE },
          u_emissiveMap: { type: ShaderPropertyType.TEXTURE },
          u_opaqueDepthMap: { type: ShaderPropertyType.TEXTURE },
          u_normalBufferMap: { type: ShaderPropertyType.TEXTURE },
        },
      },
    };
  }
}
