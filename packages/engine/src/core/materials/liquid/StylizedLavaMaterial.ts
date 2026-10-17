import vertWGSL from "./shaders/StylizedLava.vert.wgsl?raw";
import fragWGSL from "./shaders/StylizedLava.frag.wgsl?raw";
import vertGLSL from "./shaders/StylizedLava.vert.glsl?raw";
import fragGLSL from "./shaders/StylizedLava.frag.glsl?raw";
import vertGLSL100 from "./shaders/StylizedLava.vert.glsl100?raw";
import fragGLSL100 from "./shaders/StylizedLava.frag.glsl100?raw";
import { AbstractMaterial } from "../AbstractMaterial.js";
import { Color } from "../../colors/index.js";
import { MaterialType, ShaderPropertyType, TextureWrap } from "../../../enums/index.js";
import type { RenderManifest, ShaderDefinition } from "../../../renderers/shaders/index.js";
import { StandardWebGPULayout, VERTEX_COLOR_FLAG } from "../../../renderers/shaders/index.js";
import type { Texture } from "../../textures/index.js";

/**
 * Options for {@link StylizedLavaMaterial}: MinionsArt's "Simple Lava" shader parameters
 * one-to-one (names in brackets are the Unity properties). Defaults are the Astro Kat settings
 * (https://i.imgur.com/f7xrwGX.png).
 */
export interface StylizedLavaMaterialOptions {
  /** [_Color] Main Tint Start (default: #241a1c). */
  crustColor?: Color;
  /** [_Color2] Main Tint End (default: #983400). */
  magmaColor?: Color;
  /** [_Color3] Top Layer Tint (default: #ff672d). */
  fissureColor?: Color;
  /** [_EdgeC] Edge Color (default: #ff4b00). */
  shoreColor?: Color;

  /** [_Offset] Start/End Tint Offset (default: 1.43). */
  tintOffset?: number;
  /** [_Scale] Scale Main (default: 0.328). */
  scaleMain?: number;
  /** [_SpeedMainX] (default: 1.43). */
  speedMainX?: number;
  /** [_SpeedMainY] (default: 1.04). */
  speedMainY?: number;
  /** [_Strength] Brightness Under Lava (default: 1.48). */
  brightnessUnderLava?: number;
  /** [_StrengthTop] Brightness Top Lava, also scales the edge (default: 4.94). */
  brightnessTopLava?: number;
  /** [_Cutoff] Cutoff Top (default: 0.815). */
  cutoffTop?: number;
  /** [_TopBlur] (default: 0.1). */
  topBlur?: number;

  /** [_EdgeBlur] (default: 0.753). */
  edgeBlur?: number;
  /** [_Edge] Edge Thickness (default: 5.25). */
  edgeThickness?: number;

  /** [_ScaleDist] Scale Distortion (default: 0.325). */
  scaleDistort?: number;
  /** [_SpeedDistortX] (default: 0.91). */
  speedDistortX?: number;
  /** [_SpeedDistortY] (default: 1.17). */
  speedDistortY?: number;
  /** [_Distortion] Distort Strength (default: 0.292). */
  distortionStrength?: number;
  /** [_VertexDistortion] Extra Vertex Color Distortion (default: 0.649). */
  vertexDistortion?: number;

  /** [_Speed] Wave Speed (default: 0.257). */
  waveSpeed?: number;
  /** [_Amount] Wave Amount (default: 0.203). */
  waveAmount?: number;
  /** [_Height] Wave Height (default: 0.282). */
  waveHeight?: number;

  /**
   * [_MainTex] Main texture: the cell/vein pattern, projected over world XZ. Must use
   * `TextureWrap.REPEAT`. Without one the sampler yields white (Unity's `"white"` default).
   */
  mainMap?: Texture;
  /**
   * [_DistortTex] Soft noise texture that distorts the main UVs, projected over world XZ. Must
   * use `TextureWrap.REPEAT`. Without one the sampler yields white.
   */
  distortMap?: Texture;
  /** Optional 256-color thermal ramp that replaces the two-color lerp (ADR 0026, not in Unity). */
  rampMap?: Texture;

  /** Current simulation time in seconds (Unity's `_Time.y`); drives flow and waves. */
  time?: number;
}

/**
 * Port of MinionsArt's "Simple Lava" (and its Shader Graph variant): world-space scrolling distortion noise, a scrolling main texture, a
 * two-color tint lerp, a depth-based edge, a glowing top layer and a vertex-color-masked wave.
 * The painted red vertex channel (`Geometry.colors`) fades the texture, top layer and wave and
 * adds extra UV distortion; meshes without vertex colors behave as all-white. The math follows
 * the original line by line -- see `.agents/collaborate/assets/lava/minionsart_lava_shader.shader`.
 *
 * Deliberate differences: colors are converted sRGB->linear and the result is encoded back
 * (engine convention), negative results are clamped to 0, `smoothstep` with a zero-width blur
 * becomes a hard step, a missing scene-depth capture reads as "nothing behind" (the WebGL1
 * backend has no scene depth at all), and `rampMap` is an optional extension.
 */
export class StylizedLavaMaterial extends AbstractMaterial {
  public crustColor: Color;
  public magmaColor: Color;
  public fissureColor: Color;
  public shoreColor: Color;

  public tintOffset: number;
  public scaleMain: number;
  public speedMainX: number;
  public speedMainY: number;
  public brightnessUnderLava: number;
  public brightnessTopLava: number;
  public cutoffTop: number;
  public topBlur: number;

  public edgeBlur: number;
  public edgeThickness: number;

  public scaleDistort: number;
  public speedDistortX: number;
  public speedDistortY: number;
  public distortionStrength: number;
  public vertexDistortion: number;

  public waveSpeed: number;
  public waveAmount: number;
  public waveHeight: number;

  public mainMap: Texture | undefined;
  public distortMap: Texture | undefined;
  public rampMap: Texture | undefined;

  /** Current simulation time in seconds; the showcase feeds its loop clock here each frame. */
  public time: number;

  private _flags: string[] = [VERTEX_COLOR_FLAG];
  private _flagsHaveRamp: boolean = false;
  private readonly _matParam0: number[] = [0, 0, 0, 0];
  private readonly _matParam1: number[] = [0, 0, 0, 0];
  private readonly _matParam2: number[] = [0, 0, 0, 0];
  private readonly _matParam3: number[] = [0, 0, 0, 0];
  private readonly _matParam4: number[] = [0, 0, 0, 0];
  private readonly _matParam6: number[] = [0, 0, 0, 1];
  private readonly _matParam7: number[] = [0, 0, 0, 1];
  private readonly _matParam8: number[] = [0, 0, 0, 1];
  private readonly _matParam9: number[] = [0, 0, 0, 1];

  constructor(options: StylizedLavaMaterialOptions = {}) {
    super(MaterialType.STYLIZED_LAVA);

    this.crustColor = options.crustColor ?? new Color(0.14, 0.1, 0.11);
    this.magmaColor = options.magmaColor ?? new Color(0.6, 0.2, 0.0);
    this.fissureColor = options.fissureColor ?? new Color(1.0, 0.4, 0.18);
    this.shoreColor = options.shoreColor ?? new Color(1.0, 0.29, 0.0);

    this.tintOffset = options.tintOffset ?? 1.43;
    this.scaleMain = options.scaleMain ?? 0.328;
    this.speedMainX = options.speedMainX ?? 1.43;
    this.speedMainY = options.speedMainY ?? 1.04;
    this.brightnessUnderLava = options.brightnessUnderLava ?? 1.48;
    this.brightnessTopLava = options.brightnessTopLava ?? 4.94;
    this.cutoffTop = options.cutoffTop ?? 0.815;
    this.topBlur = options.topBlur ?? 0.1;

    this.edgeBlur = options.edgeBlur ?? 0.753;
    this.edgeThickness = options.edgeThickness ?? 5.25;

    this.scaleDistort = options.scaleDistort ?? 0.325;
    this.speedDistortX = options.speedDistortX ?? 0.91;
    this.speedDistortY = options.speedDistortY ?? 1.17;
    this.distortionStrength = options.distortionStrength ?? 0.292;
    this.vertexDistortion = options.vertexDistortion ?? 0.649;

    this.waveSpeed = options.waveSpeed ?? 0.257;
    this.waveAmount = options.waveAmount ?? 0.203;
    this.waveHeight = options.waveHeight ?? 0.282;

    this.mainMap = options.mainMap;
    this.distortMap = options.distortMap;
    this.rampMap = options.rampMap;
    this.time = options.time ?? 0.0;

    // Depth reading requires transparent render queue with depthWrite
    this.transparent = true;
    this.depthWrite = true;
  }

  public getShaderDefinition(): ShaderDefinition {
    return {
      id: this.type,
      sources: {
        glsl300: { vs: vertGLSL, fs: fragGLSL },
        glsl100: { vs: vertGLSL100, fs: fragGLSL100 },
        wgsl: `${vertWGSL}\n[WGSL_PBR_MATH]\n${fragWGSL}`,
      },
      layout: {
        ...StandardWebGPULayout,
        textures: {
          u_diffuseMap: { type: ShaderPropertyType.TEXTURE },
          u_distortMap: { type: ShaderPropertyType.TEXTURE },
          u_rampMap: { type: ShaderPropertyType.TEXTURE },
          u_opaqueDepthMap: { type: ShaderPropertyType.TEXTURE },
        },
      },
    };
  }

  public getRenderManifest(): RenderManifest {
    if (!this._renderManifest) {
      this._renderManifest = this._createBaseManifest();
    }
    this._syncBaseManifestState();

    // The textures are sampled at world XZ and scrolled far outside 0..1.
    this._assertRepeat("mainMap", this.mainMap);
    this._assertRepeat("distortMap", this.distortMap);

    const manifest = this._renderManifest;
    const props = manifest.properties as Record<string, unknown>;

    if (this._flagsHaveRamp !== (undefined !== this.rampMap)) {
      this._flagsHaveRamp = undefined !== this.rampMap;
      this._flags = this._flagsHaveRamp ? [VERTEX_COLOR_FLAG, "USE_RAMP_LUT"] : [VERTEX_COLOR_FLAG];
    }
    manifest.flags = this._flags;

    manifest.textures["u_diffuseMap"] = this.mainMap;
    manifest.textures["u_distortMap"] = this.distortMap;
    manifest.textures["u_rampMap"] = this.rampMap;

    props["u_time"] = this.time;
    props["u_matParam0"] = this._set4(
      this._matParam0,
      this.scaleMain,
      this.scaleDistort,
      this.distortionStrength,
      this.vertexDistortion,
    );
    props["u_matParam1"] = this._set4(
      this._matParam1,
      this.speedMainX,
      this.speedMainY,
      this.speedDistortX,
      this.speedDistortY,
    );
    props["u_matParam2"] = this._set4(
      this._matParam2,
      this.cutoffTop,
      this.topBlur,
      this.tintOffset,
      this.brightnessUnderLava,
    );
    props["u_matParam3"] = this._set4(
      this._matParam3,
      this.edgeThickness,
      this.edgeBlur,
      this.brightnessTopLava,
      0.0,
    );
    props["u_matParam4"] = this._set4(
      this._matParam4,
      this.waveSpeed,
      this.waveAmount,
      this.waveHeight,
      0.0,
    );
    props["u_matParam6"] = this._setColor(this._matParam6, this.crustColor);
    props["u_matParam7"] = this._setColor(this._matParam7, this.magmaColor);
    props["u_matParam8"] = this._setColor(this._matParam8, this.fissureColor);
    props["u_matParam9"] = this._setColor(this._matParam9, this.shoreColor);

    return manifest;
  }

  private _assertRepeat(name: string, texture: Texture | undefined): void {
    if (undefined === texture) return;
    if (
      TextureWrap.REPEAT !== texture.addressModeU ||
      TextureWrap.REPEAT !== texture.addressModeV
    ) {
      throw new Error(
        `[StylizedLavaMaterial] ${name} must use TextureWrap.REPEAT on U and V: it is projected over world XZ and scrolled.`,
      );
    }
  }

  private _set4(target: number[], x: number, y: number, z: number, w: number): number[] {
    target[0] = x;
    target[1] = y;
    target[2] = z;
    target[3] = w;
    return target;
  }

  private _setColor(target: number[], color: Color): number[] {
    return this._set4(target, color.r, color.g, color.b, 1.0);
  }
}
