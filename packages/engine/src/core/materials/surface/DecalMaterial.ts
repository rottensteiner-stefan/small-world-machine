import fragWGSL from "./shaders/Decal.frag.wgsl?raw";
import fragGLSL from "./shaders/Decal.frag.glsl?raw";
import { AbstractMaterial } from "../AbstractMaterial.js";
import type { Texture } from "../../textures/index.js";
import { BlendingMode, CullMode, MaterialType, ShaderPropertyType } from "../../../enums/index.js";
import { Color } from "../../colors/index.js";
import type { RenderManifest, ShaderDefinition } from "../../../renderers/shaders/index.js";
import { StandardWebGPULayout } from "../../../renderers/shaders/index.js";

/** Configuration options for `DecalMaterial`. */
export interface DecalMaterialOptions {
  /** Tint multiplied onto the albedo texture; its alpha scales the whole decal. */
  color?: Color;
  /** Albedo (rgb, sRGB) and coverage (a) of the decal. */
  diffuseMap?: Texture | undefined;
  /** Tangent-space normal map of the decal, rotated onto the surface normal beneath it. */
  normalMap?: Texture | undefined;
  /**
   * Packed occlusion/roughness/metallic map (engine convention, same as glTF): R = ambient
   * occlusion, G = roughness, B = metallic. Multiplied with `roughness` / `metallic`; R scales the
   * ambient term. Linear data. Bound to the shared `u_aoMap` slot (the WebGPU material bind group
   * has no dedicated ORM binding).
   */
  ormMap?: Texture | undefined;
  /** Emissive texture (rgb, sRGB), multiplied with `emissiveColor` and `emissiveIntensity`. Lit decals only. */
  emissiveMap?: Texture | undefined;
  /** Emissive tint. Defaults to black (no emission, also with an `emissiveMap`). */
  emissiveColor?: Color;
  /** Emissive strength multiplier. Defaults to 1. */
  emissiveIntensity?: number;
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
  /** LOD bias in mip levels applied to the finite-difference gradients (negative = sharper). Defaults to 0. */
  mipBias?: number;
  /**
   * Skip lighting: the decal draws its flat albedo, shaded like nothing else in the scene. Far
   * cheaper for large overlapping decals (no light loop per covered pixel), meant for emissive or
   * painted signs and evenly lit scenes. Defaults to false (lit).
   */
  unlit?: boolean;
}

/**
 * Material of a box-projected `Decal`: lit on top of the already-rendered opaque image, using the
 * opaque depth (and, when `quality.normalBuffer` is on, the normal buffer) beneath it.
 */
export class DecalMaterial extends AbstractMaterial {
  public diffuseMap: Texture | undefined;
  public normalMap: Texture | undefined;
  public ormMap: Texture | undefined;
  public emissiveMap: Texture | undefined;
  public emissiveColor: Color;
  public emissiveIntensity: number;
  public roughness: number;
  public metallic: number;
  public edgeFade: number;
  public angleFadeStart: number;
  public angleFadeEnd: number;
  public mipBias: number;
  public unlit: boolean;

  private readonly _fadeParams: Float32Array = new Float32Array(4);
  private readonly _ormParams: Float32Array = new Float32Array(4);

  constructor(options: DecalMaterialOptions = {}) {
    super(MaterialType.DECAL);
    this.color = options.color ?? new Color(1, 1, 1, 1);
    this.diffuseMap = options.diffuseMap;
    this.normalMap = options.normalMap;
    this.ormMap = options.ormMap;
    this.emissiveMap = options.emissiveMap;
    this.emissiveColor = options.emissiveColor ?? new Color(0, 0, 0, 1);
    this.emissiveIntensity = options.emissiveIntensity ?? 1;
    this.roughness = options.roughness ?? 0.8;
    this.metallic = options.metallic ?? 0;
    this.edgeFade = options.edgeFade ?? 0.1;
    this.angleFadeStart = options.angleFadeStart ?? 60;
    this.angleFadeEnd = options.angleFadeEnd ?? 85;
    this.mipBias = options.mipBias ?? 0;
    this.unlit = options.unlit ?? false;
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
    const emissive = props["u_specColor"] as Float32Array;
    emissive[0] = this.emissiveColor.r;
    emissive[1] = this.emissiveColor.g;
    emissive[2] = this.emissiveColor.b;
    emissive[3] = this.emissiveIntensity;
    props["u_matParam6"] = this._ormParams; // x = ORM map present (WGSL has no per-flag constant)
    this._ormParams[0] = this.ormMap ? 1 : 0;
    const fade = this._packFadeParams();
    props["u_matParam4"] = fade;
    props["u_decalFade"] = fade;
    manifest.textures["u_diffuseMap"] = this.diffuseMap;
    manifest.textures["u_normalMap"] = this.normalMap;
    manifest.textures["u_aoMap"] = this.ormMap;
    manifest.textures["u_emissiveMap"] = this.emissiveMap;
    manifest.flags = ["USE_DECAL_GRADIENTS"];
    if (this.ormMap) manifest.flags.push("USE_DECAL_ORM");
    if (this.emissiveMap) manifest.flags.push("USE_EMISSIVE_MAP");
    if (this.normalMap) manifest.flags.push("USE_NORMAL_MAP");
    if (this.unlit) manifest.flags.push("USE_DECAL_UNLIT");
    return manifest;
  }

  private _packFadeParams(): Float32Array {
    const toCos = (degrees: number): number => Math.cos((degrees * Math.PI) / 180);
    this._fadeParams[0] = this.edgeFade;
    this._fadeParams[1] = toCos(this.angleFadeStart);
    this._fadeParams[2] = toCos(this.angleFadeEnd);
    this._fadeParams[3] = Math.pow(2, this.mipBias);
    return this._fadeParams;
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
        wgsl: `[WGSL_STRUCTS]\n[WGSL_PBR_MATH]\n[WGSL_VS]\n${fragWGSL}`,
      },
      layout: {
        ...StandardWebGPULayout,
        textures: {
          u_diffuseMap: { type: ShaderPropertyType.TEXTURE },
          u_normalMap: { type: ShaderPropertyType.TEXTURE },
          u_emissiveMap: { type: ShaderPropertyType.TEXTURE },
          u_aoMap: { type: ShaderPropertyType.TEXTURE },
          u_opaqueDepthMap: { type: ShaderPropertyType.TEXTURE },
          u_normalBufferMap: { type: ShaderPropertyType.TEXTURE },
        },
      },
    };
  }
}
