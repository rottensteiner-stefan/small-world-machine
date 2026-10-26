import vertWGSL from "./shaders/StylizedWater.vert.wgsl?raw";
import fragWGSL from "./shaders/StylizedWater.frag.wgsl?raw";
import vertGLSL from "./shaders/StylizedWater.vert.glsl?raw";
import fragGLSL from "./shaders/StylizedWater.frag.glsl?raw";
import vertGLSL100 from "./shaders/StylizedWater.vert.glsl100?raw";
import fragGLSL100 from "./shaders/StylizedWater.frag.glsl100?raw";
import { LiquidWaveMaterial, type LiquidReflectionConfig } from "./LiquidWaveMaterial.js";
import { Color } from "../../colors/index.js";
import { MaterialType } from "../../../enums/index.js";
import type { RenderManifest, ShaderDefinition } from "../../../renderers/shaders/index.js";
import { RAMP_LUT_FLAG } from "../../../renderers/shaders/index.js";
import type { Texture } from "../../textures/index.js";

export interface StylizedWaterExtensionHooks {
  decl?: string;
  surface?: string;
}

export function composeStylizedWaterSources(
  ext?: StylizedWaterExtensionHooks,
): ShaderDefinition["sources"] {
  const decl = ext?.decl ?? "";
  const surface = ext?.surface ?? "";

  const replaceHooks = (source: string, isWgsl = false): string => {
    const declToken = isWgsl ? "[WGSL_WATER_EXT_DECL]" : "[WATER_EXT_DECL]";
    const surfaceToken = isWgsl ? "[WGSL_WATER_EXT_SURFACE]" : "[WATER_EXT_SURFACE]";
    return source.replace(declToken, decl).replace(surfaceToken, surface);
  };

  return {
    glsl300: {
      vs: vertGLSL,
      fs: replaceHooks(fragGLSL),
    },
    glsl100: {
      vs: vertGLSL100,
      fs: replaceHooks(fragGLSL100),
    },
    wgsl: `${vertWGSL}\n[WGSL_PBR_MATH]\n[WGSL_DIR_SHADOW]\n${replaceHooks(fragWGSL, true)}`,
  };
}

export interface StylizedWaterMaterialOptions extends LiquidReflectionConfig {
  shallowWaterColor?: Color;
  deepWaterColor?: Color;
  edgeColor?: Color;
  edgeSoftness?: number;
  speed?: number;
  wave1?: [number, number, number, number];
  wave2?: [number, number, number, number];
  wave3?: [number, number, number, number];
  refractionStrength?: number;
  waterAbsorption?: [number, number, number];
  foamColor?: Color;
  foamDistance?: number;
  foamCutoff?: number;
  foamNoiseScale?: number;
  foamNoiseSpeed?: number;
  /** Brightness of the toon caustic pattern on the ground, 0 = off. Default 0.6. */
  causticStrength?: number;
  /** Brightness of the toon sun-glint specular, 0 = off. Default 0.4. */
  specularStrength?: number;
  /** Depth ramp softness (0 = banded cel ramp, 1 = smooth painterly wash). */
  rampSoftness?: number;
  /** Low-frequency brush stroke noise modulation on depth. */
  washAmount?: number;
  /** Ripple stroke lines density. */
  lineDensity?: number;
  /**
   * Ripple stroke thickness (0..1) for the painterly styles (styleId 1, 2, 4, 5); noise-warped, broken strokes.
   * Toon (0) and extensions (3) keep the old meaning: sin frequency in rad/unit.
   */
  lineWidth?: number;
  /** Shoreline foam edge softness (0.02 = crisp cel edge, 0.15 = soft painterly foam). */
  foamSoftness?: number;
  /** Sky/cloud reflection blend factor (0.0 to 1.0). */
  skyTint?: number;
  /** Sun-glint star sparkle strength (0 = off, 1.0 = full sparkling stars). */
  glitterStrength?: number;
  /** Style ID (0 = legacy toon, 1 = soft anime/Ghibli, 2 = sparkle anime, 3 = custom extension, 4 = dredge murk, 5 = bold). */
  styleId?: number;
  /** Style-ladder preset; explicit options override its values. Default "toon". */
  style?: StylizedWaterStyle;
  /**
   * Optional 256x1 depth-to-colour ramp (see `RampLUT`). While set, it replaces the shallow/mid/deep
   * blend at full weight and `rampSoftness` is ignored (ADR 0026 route (a)).
   */
  rampMap?: Texture;
  /** See {@link LiquidWaveMaterialInit.domainScale} (E4-B). Defaults to 1.0.
   * @domain reference domain size of the water surface in meters (>0); reciprocal of a node's scale keeps the look scale-invariant. */
  domainScale?: number;
}

/** Style ladder across the anime/stylized spectrum. */
export type StylizedWaterStyle =
  "flat" | "toon" | "bold" | "soft" | "sparkle" | "dredge" | "custom";

export interface StylizedWaterStyleVector {
  causticStrength: number;
  specularStrength: number;
  rampSoftness: number;
  washAmount: number;
  lineDensity: number;
  lineWidth: number;
  foamSoftness: number;
  skyTint: number;
  glitterStrength: number;
  styleId: number;
}

const STYLE_PRESETS: Record<Exclude<StylizedWaterStyle, "custom">, StylizedWaterStyleVector> = {
  flat: {
    causticStrength: 0.0,
    specularStrength: 0.0,
    rampSoftness: 0.0,
    washAmount: 0.0,
    lineDensity: 0.0,
    lineWidth: 0.0,
    foamSoftness: 0.02,
    skyTint: 0.0,
    glitterStrength: 0.0,
    styleId: 0.0,
  },
  toon: {
    causticStrength: 0.6,
    specularStrength: 0.4,
    rampSoftness: 0.3,
    washAmount: 0.0,
    lineDensity: 0.0,
    lineWidth: 0.0,
    foamSoftness: 0.06,
    skyTint: 0.45,
    glitterStrength: 0.0,
    styleId: 0.0,
  },
  bold: {
    causticStrength: 1.2,
    specularStrength: 0.4,
    rampSoftness: 0.0,
    washAmount: 0.0,
    lineDensity: 0.0,
    lineWidth: 0.0,
    foamSoftness: 0.06,
    skyTint: 0.45,
    glitterStrength: 0.0,
    styleId: 5.0, // bold: anime cellular caustic net, crisp ink look, no painterly lines
  },
  soft: {
    causticStrength: 0.22,
    specularStrength: 0.1,
    rampSoftness: 0.9,
    washAmount: 0.5,
    lineDensity: 0.22,
    lineWidth: 0.18,
    foamSoftness: 0.16,
    skyTint: 0.55,
    glitterStrength: 0.0,
    styleId: 1.0,
  },
  sparkle: {
    causticStrength: 0.85,
    specularStrength: 0.5,
    rampSoftness: 0.6,
    washAmount: 0.25,
    lineDensity: 0.7,
    lineWidth: 0.2,
    foamSoftness: 0.08,
    skyTint: 0.5,
    glitterStrength: 1.0,
    styleId: 2.0,
  },
  // styleId lane (u_styleB.w) is a plain integer selector, no spare uniform lane exists:
  // 0 toon (legacy), 1 soft, 2 sparkle, 3 extensions (Noir/Oil), 4 dredge (soft family + depth fog), 5 bold.
  // Any value above 0 switches to the anime caustic network and soft foam; the shaders derive their flags from it.
  dredge: {
    causticStrength: 0.3,
    specularStrength: 0.15,
    rampSoftness: 0.5,
    washAmount: 0.6,
    lineDensity: 0.3,
    lineWidth: 0.25,
    foamSoftness: 0.1,
    skyTint: 0.15,
    glitterStrength: 0.0,
    styleId: 4.0, // dredge: soft family plus depth fog (murk)
  },
};

/**
 * StylizedWaterMaterial implements a high-quality stylized 3D water surface
 * based on Gerstner waves, dual-noise toon shoreline/intersection foam, wave crest steepness foam,
 * and directional ground-reconstructed caustics projection. A toon preset on top of
 * {@link LiquidWaveMaterial}.
 */
export class StylizedWaterMaterial extends LiquidWaveMaterial {
  public causticStrength: number;
  public specularStrength: number;
  public rampSoftness: number;
  public washAmount: number;
  public lineDensity: number;
  public lineWidth: number;
  public foamSoftness: number;
  public skyTint: number;
  public glitterStrength: number;
  public styleId: number;
  /** Optional depth-to-colour ramp LUT; `undefined` keeps the built-in 3-colour ramp (default). */
  public rampMap: Texture | undefined;

  private readonly _colorWithSpecular: number[] = [0, 0, 0, 0];
  private readonly _deepWithCaustic: number[] = [0, 0, 0, 0];
  /**
   * Typed semantic lane bank (ADR 0027 / 0039) -- see `getRenderManifest`. `specularStrength`
   * previously rode `u_color.a` (alpha of the shallow-water colour); it now lives in the
   * dedicated `u_matParam7` lane and `u_color.a` is the real alpha (1.0).
   */
  private readonly _matParam7Array: number[] = [0, 0, 0, 0];
  /**
   * R5 owned depth lane `u_matParam8`: `[refrDepth 0.3m ÷ ds, depthCut 0.25m ÷ ds,
   * causticsMaxDepth 6.0m ÷ ds, depthRampEnd 4.0m ÷ ds]` (StylizedWater-only, A2 attribution).
   * Value-preserving at domainScale 1.0; pre-scaled by `domainScale` (length semantics ÷).
   */
  private readonly _matParam8Array: number[] = [0, 0, 0, 0];
  /** The `u_styleB` lane; subclasses may overwrite entries after `super.getRenderManifest()`. */
  protected readonly _styleBArray: number[] = [0, 0, 0, 0];
  private readonly _flagsWithRamp: string[] = [RAMP_LUT_FLAG];
  private readonly _flagsNoRamp: string[] = [];

  constructor(
    options: StylizedWaterMaterialOptions = {},
    materialType: string = MaterialType.STYLIZED_WATER,
  ) {
    const {
      shallowWaterColor = new Color(0.05, 0.45, 0.55),
      deepWaterColor = new Color(0.01, 0.1, 0.18),
      edgeColor = new Color(0.8, 1.0, 0.95),
      edgeSoftness = 0.35,
      speed = 1.0,
      wave1 = [1.0, 0.4, 0.08, 3.2],
      wave2 = [0.3, 0.9, 0.06, 2.0],
      wave3 = [-0.4, 0.6, 0.04, 1.3],
      refractionStrength = 0.03,
      waterAbsorption = [0.25, 0.08, 0.03],
      foamColor = new Color(1.0, 1.0, 1.0),
      foamDistance = 1.1,
      foamCutoff = 0.4,
      foamNoiseScale = 3.5,
      foamNoiseSpeed = 0.6,
      style = "toon",
      domainScale = 1.0,
    } = options;

    const preset = style === "custom" ? STYLE_PRESETS.toon : STYLE_PRESETS[style];
    const {
      causticStrength = preset.causticStrength,
      specularStrength = preset.specularStrength,
      rampSoftness = preset.rampSoftness,
      washAmount = preset.washAmount,
      lineDensity = preset.lineDensity,
      lineWidth = preset.lineWidth,
      foamSoftness = preset.foamSoftness,
      skyTint = preset.skyTint,
      glitterStrength = preset.glitterStrength,
      styleId = preset.styleId,
    } = options;

    super(materialType, {
      color: shallowWaterColor,
      deepWaterColor,
      edgeColor,
      edgeSoftness,
      speed,
      wave1,
      wave2,
      wave3,
      refractionStrength,
      waterAbsorption,
      foamColor,
      foamDistance,
      foamCutoff,
      foamNoiseScale,
      foamNoiseSpeed,
      domainScale,
      reflectionMap: options.reflectionMap,
      reflectionStrength: options.reflectionStrength,
      reflectionDistortion: options.reflectionDistortion,
    });

    this.causticStrength = causticStrength;
    this.specularStrength = specularStrength;
    this.rampSoftness = rampSoftness;
    this.washAmount = washAmount;
    this.lineDensity = lineDensity;
    this.lineWidth = lineWidth;
    this.foamSoftness = foamSoftness;
    this.skyTint = skyTint;
    this.glitterStrength = glitterStrength;
    this.styleId = styleId;
    this.rampMap = options.rampMap;
  }

  public override getRenderManifest(): RenderManifest {
    const manifest = super.getRenderManifest();
    const props = manifest.properties as Record<string, unknown>;

    const c = this._colorWithSpecular;
    c[0] = this.color.r;
    c[1] = this.color.g;
    c[2] = this.color.b;
    c[3] = 1.0; // real alpha: specularStrength moved to u_matParam7.x (no more alpha-channel smuggling)
    props["u_color"] = c;

    const p7 = this._matParam7Array;
    p7[0] = this.specularStrength;
    p7[1] = 0;
    p7[2] = 0;
    p7[3] = 0;
    props["u_matParam7"] = p7;

    // R5/E4-B: StylizedWater-only world-meter depth constants (A2 ownership), ÷ domainScale.
    const p8 = this._matParam8Array;
    p8[0] = 0.3 / this.domainScale; // refraction damping depth (m)
    p8[1] = 0.25 / this.domainScale; // depth-discontinuity guard (m)
    p8[2] = 6.0 / this.domainScale; // caustics max projection depth (m)
    p8[3] = 4.0 / this.domainScale; // depth ramp End (m)
    props["u_matParam8"] = p8;

    const d = this._deepWithCaustic;
    d[0] = this.deepWaterColor.r;
    d[1] = this.deepWaterColor.g;
    d[2] = this.deepWaterColor.b;
    d[3] = this.causticStrength;
    props["u_specColor"] = d;

    const sA = this._styleAArray;
    sA[0] = this.rampSoftness;
    sA[1] = this.washAmount;
    sA[2] = this.lineDensity;
    sA[3] = this.lineWidth;

    const sB = this._styleBArray;
    sB[0] = this.foamSoftness;
    sB[1] = this.skyTint;
    sB[2] = this.glitterStrength;
    sB[3] = this.styleId;
    props["u_styleB"] = sB;

    manifest.textures["u_rampMap"] = this.rampMap;

    // The style is selected at runtime via u_styleB.w; only the ramp LUT changes the compiled
    // program. The array reference is stable and only swapped when the ramp presence flips.
    manifest.flags = undefined !== this.rampMap ? this._flagsWithRamp : this._flagsNoRamp;

    return manifest;
  }

  protected override _getLiquidWaveShaderSources(): ShaderDefinition["sources"] {
    return composeStylizedWaterSources();
  }
}
