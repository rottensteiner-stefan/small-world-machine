import vertGLSL from "./shaders/FluidSurface.vert.glsl?raw";
import fragGLSL from "./shaders/FluidSurface.frag.glsl?raw";
import vertGLSL100 from "./shaders/FluidSurface.vert.glsl100?raw";
import fragGLSL100 from "./shaders/FluidSurface.frag.glsl100?raw";
import vertWGSL from "./shaders/FluidSurface.vert.wgsl?raw";
import fragWGSL from "./shaders/FluidSurface.frag.wgsl?raw";
import { AbstractMaterial } from "../AbstractMaterial.js";
import { Color } from "../../colors/index.js";
import { MaterialType, ShaderPropertyType } from "../../../enums/index.js";
import type { Texture } from "../../textures/index.js";
import type { RenderManifest, ShaderDefinition } from "../../../renderers/shaders/index.js";
import { StandardWebGPULayout } from "../../../renderers/shaders/index.js";

/**
 * Configuration options for FluidSurfaceMaterial.
 */
export interface FluidSurfaceMaterialOptions {
  /** The base color of the liquid. */
  color?: Color | undefined;
  /** The color of the edge intersection (foam/crust). */
  edgeColor?: Color | undefined;
  /** The speed of the liquid flow animation. */
  flowSpeed?: number | undefined;
  /** The distortion or noise scale. */
  distortion?: number | undefined;
  /**
   * Viscosity: higher = thicker, more sluggish. Drives the vertex displacement towards fewer,
   * larger blobs (lower frequency, bigger amplitude) -- NOT a higher wave frequency like water.
   */
  viscosity?: number | undefined;
  /** Overrides the viscosity-derived vertex wave amplitude (world units). */
  waveAmplitude?: number | undefined;
  /** Fresnel rim glow in `edgeColor` (translucent edge look). 0 = off (default). */
  rimStrength?: number | undefined;
  /** Directional-light specular intensity. 0 = off (default). */
  specularStrength?: number | undefined;
  /** Specular exponent (higher = tighter highlight). Default 48. */
  specularPower?: number | undefined;
  /** Strength of the `normalMap` tilt on the surface normal. 0 = map ignored (default). */
  normalStrength?: number | undefined;
  /**
   * Beer-Lambert absorption density over the opaque depth capture (WebGL2/WebGPU only; WebGL1
   * has no depth capture). Fluid alpha = 1 - exp(-absorption * thickness). 0 = fully opaque (default).
   */
  absorption?: number | undefined;
  /** Wrapped-diffuse shading of the colour by the directional light. 0 = unlit (default). */
  shade?: number | undefined;
  /**
   * 0 = constant additive emissive (legacy). 1 = emissive follows the noise: hot cracks where the
   * noise is low, dark crust where it is high.
   */
  emissiveMask?: number | undefined;
  /** Emissive pulsation amplitude (0 = steady, default). Rolls along the noise field. */
  emissivePulse?: number | undefined;
  /** Emissive pulsation speed in rad/s. Default 2. */
  emissivePulseSpeed?: number | undefined;
  /** Width of the noise transition falloffs (crust/edge/hot mask). 0.2 = legacy two-tone width. */
  transitionSoftness?: number | undefined;
  /** A noise texture map used to generate the flow. */
  noiseMap?: Texture | undefined;
  /** Normal map for surface detail. */
  normalMap?: Texture | undefined;
  /** Glow color for opaque/emissive presets (lava). Defaults to black -- no glow. */
  emissiveColor?: Color | undefined;
  /** Multiplier on `emissiveColor`. 0 disables the glow entirely (the default, plain-fluid look). */
  emissiveStrength?: number | undefined;
  /**
   * Reference domain size anchor for world-anchored noise/edge/vertex wave quantities.
   * `1.0` (default) is a numeric identity and keeps every lane byte-identical to the legacy
   * defaults; use the reciprocal of a node's scale to keep the pattern look invariant on a
   * scaled surface (see the R4/E4-B TDD suite). Length semantics divide by `domainScale`;
   * per-meter frequency semantics multiply by it.
   */
  domainScale?: number | undefined;
}

/**
 * Shared mechanism for opaque/emissive-capable flowing liquid surfaces: noise-driven flow
 * distortion, depth-fade edge blending, and an optional emissive glow. {@link LavaMaterial} and
 * {@link SlimeMaterial} are thin presets on top of this -- see
 * docs/adr/0013-unified-liquid-surface-material.md. Usable directly for a plain flowing liquid.
 */
export class FluidSurfaceMaterial extends AbstractMaterial {
  /** The base color of the fluid. */
  public override color: Color;
  /** The color of the edge intersection. */
  public edgeColor: Color;
  /** The speed of the flow animation. */
  public flowSpeed: number;
  /** The scale of the noise distortion. */
  public distortion: number;
  /** The viscosity (see {@link FluidSurfaceMaterialOptions.viscosity}). */
  public viscosity: number;
  /** Explicit vertex wave amplitude; `undefined` derives it from viscosity. */
  public waveAmplitude: number | undefined;
  /** Fresnel rim strength. */
  public rimStrength: number;
  /** Directional specular intensity. */
  public specularStrength: number;
  /** Specular exponent. */
  public specularPower: number;
  /** Normal map tilt strength. */
  public normalStrength: number;
  /** Beer-Lambert absorption density. */
  public absorption: number;
  /** Wrapped diffuse shading strength. */
  public shade: number;
  /** Noise-driven emissive mask blend (0 constant, 1 fully masked). */
  public emissiveMask: number;
  /** Emissive pulse amplitude. */
  public emissivePulse: number;
  /** Emissive pulse speed (rad/s). */
  public emissivePulseSpeed: number;
  /** Width of the noise transition falloffs. */
  public transitionSoftness: number;
  /** The current time/frame for animation. */
  public time: number = 0.0;
  /** The noise texture. */
  public noiseMap: Texture | undefined;
  /** Optional normal map. */
  public normalMap: Texture | undefined;
  /** Glow color for opaque/emissive presets (lava). */
  public emissiveColor: Color;
  /** Multiplier on `emissiveColor`. */
  public emissiveStrength: number;
  /** See {@link FluidSurfaceMaterialOptions.domainScale}. Defaults to 1.0 (numeric identity). */
  public domainScale: number = 1.0;

  /** Typed semantic lane bank (see the lane table in `getRenderManifest`); the shaders read these for every look parameter. */
  private readonly _matParam0: number[] = [0, 0, 0, 0];
  private readonly _matParam1: number[] = [0, 0, 0, 0];
  private readonly _matParam2: number[] = [0, 0, 0, 0];
  private readonly _matParam3: number[] = [0, 0, 0, 0];
  private readonly _matParam4: number[] = [0, 0, 0, 0];
  private readonly _matParam5: number[] = [0, 0, 0, 0];

  /**
   * Creates a new FluidSurfaceMaterial.
   * @param options The configuration options.
   * @param type Shader-registry ID to register under -- overridden by presets
   * ({@link LavaMaterial}, {@link SlimeMaterial}) so each gets its own compiled shader instead of
   * colliding on the shared "FluidSurfaceMaterial" ID.
   */
  constructor(
    options: FluidSurfaceMaterialOptions = {},
    type: MaterialType = MaterialType.FLUID_SURFACE,
  ) {
    super(type);
    const {
      color = new Color(0.0, 0.4, 0.8),
      edgeColor = new Color(0.8, 0.9, 1.0),
      flowSpeed = 1.0,
      distortion = 2.0,
      viscosity = 5.0,
      noiseMap = undefined,
      normalMap = undefined,
      emissiveColor = new Color(0.0, 0.0, 0.0),
      emissiveStrength = 0.0,
      waveAmplitude = undefined,
      rimStrength = 0.0,
      specularStrength = 0.0,
      specularPower = 48.0,
      normalStrength = 0.0,
      absorption = 0.0,
      shade = 0.0,
      emissiveMask = 0.0,
      emissivePulse = 0.0,
      emissivePulseSpeed = 2.0,
      transitionSoftness = 0.2,
      domainScale = 1.0,
    } = options;

    this.color = color;
    this.edgeColor = edgeColor;
    this.flowSpeed = flowSpeed;
    this.distortion = distortion;
    this.viscosity = viscosity;
    this.noiseMap = noiseMap;
    this.normalMap = normalMap;
    this.emissiveColor = emissiveColor;
    this.emissiveStrength = emissiveStrength;
    this.waveAmplitude = waveAmplitude;
    this.rimStrength = rimStrength;
    this.specularStrength = specularStrength;
    this.specularPower = specularPower;
    this.normalStrength = normalStrength;
    this.absorption = absorption;
    this.shade = shade;
    this.emissiveMask = emissiveMask;
    this.emissivePulse = emissivePulse;
    this.emissivePulseSpeed = emissivePulseSpeed;
    this.transitionSoftness = transitionSoftness;
    this.domainScale = domainScale;

    // Set transparency and blending
    this.transparent = true;
    this.depthWrite = false; // Usually true for liquids, but for soft edges we want blending. Let's keep it false for soft edges to work well, or true if we want opaque body. Let's stick to true transparent for now.
  }

  /** @inheritdoc */
  public override getRenderManifest(): RenderManifest {
    if (undefined === this._renderManifest) {
      this._renderManifest = this._createBaseManifest();
      this._renderManifest.properties["u_specColor"] = this.edgeColor.toFloat32Array();
      // Typed semantic lane table (ADR 0027 / 0039). Every look parameter travels in a dedicated
      // u_matParamN slot declared by FluidSurface.frag.* / .vert.* -- previously these were
      // smuggled through generic slots (u_extraParams, u_liquidParams, u_thresholds,
      // u_shininess, u_isTerrain, u_metallic, u_roughness, u_reflectivity).
      //   u_matParam0 = [shade, rimStrength, specularStrength, normalStrength]
      //   u_matParam1 = [specularPower, absorption, emissiveMask, transitionSoftness]
      //   u_matParam2 = [flowSpeed, distortion, emissivePulse, emissivePulseSpeed]
      //   u_matParam3 = [emissive.r*strength, emissive.g*strength, emissive.b*strength, time]
      //   u_matParam4 = [waveFrequency, waveAmplitude, 0, 0]  (vertex stage only)
      //   u_matParam5 = [worldUVFreq, edgeSoftness, alphaFloor, rimExponent] (R4/E4-B: 0.5·ds,
      //                1.0/ds, 0.25, 3.0 -- world-anchored lengths/freqs pre-scaled by domainScale)
      this._renderManifest.properties["u_matParam0"] = this._matParam0;
      this._renderManifest.properties["u_matParam1"] = this._matParam1;
      this._renderManifest.properties["u_matParam2"] = this._matParam2;
      this._renderManifest.properties["u_matParam3"] = this._matParam3;
      this._renderManifest.properties["u_matParam4"] = this._matParam4;
      this._renderManifest.properties["u_matParam5"] = this._matParam5;
      this._renderManifest.textures["u_diffuseMap"] = this.noiseMap;
    }

    this._syncBaseManifestState();

    const props = this._renderManifest.properties as Record<string, unknown>;
    const texs = this._renderManifest.textures as Record<string, unknown>;

    props["u_specColor"] = this.edgeColor.toFloat32Array();

    const p0 = this._matParam0;
    p0[0] = this.shade;
    p0[1] = this.rimStrength;
    p0[2] = this.specularStrength;
    p0[3] = this.normalStrength;

    const p1 = this._matParam1;
    p1[0] = this.specularPower;
    p1[1] = this.absorption;
    p1[2] = this.emissiveMask;
    p1[3] = this.transitionSoftness;

    const p2 = this._matParam2;
    p2[0] = this.flowSpeed;
    p2[1] = this.distortion;
    p2[2] = this.emissivePulse;
    p2[3] = this.emissivePulseSpeed;

    const p3 = this._matParam3;
    p3[0] = this.emissiveColor.r * this.emissiveStrength;
    p3[1] = this.emissiveColor.g * this.emissiveStrength;
    p3[2] = this.emissiveColor.b * this.emissiveStrength;
    p3[3] = this.time;

    // Viscosity -> sluggish, large blobs: lower frequency, bigger amplitude as it grows.
    // E4-B: world-anchored quantities are pre-scaled by domainScale -- per-meter wave frequency
    // MULTIPLIES, world-meter wave amplitude DIVIDES. domainScale 1.0 is a numeric identity, so
    // every default lane here is byte-identical to the pre-E4-B values.
    const p4 = this._matParam4;
    p4[0] = (3.0 / (1.0 + this.viscosity * 0.1)) * this.domainScale;
    p4[1] = (this.waveAmplitude ?? 0.03 + this.viscosity * 0.006) / this.domainScale;
    p4[2] = 0;
    p4[3] = 0;

    // R4/E4-B u_matParam5 (see the lane table): world-anchored literals moved out of the shader.
    // Length semantics (edge softness) DIVIDE by domainScale; per-meter frequency semantics
    // (world-XZ noise texel frequency) MULTIPLY by domainScale. The two raw dimensionless look
    // scalars (alpha floor, rim exponent) are scale-fixed.
    const p5 = this._matParam5;
    p5[0] = 0.5 * this.domainScale;
    p5[1] = 1.0 / this.domainScale;
    p5[2] = 0.25;
    p5[3] = 3.0;

    texs["u_diffuseMap"] = this.noiseMap;
    if (this.normalMap) texs["u_normalMap"] = this.normalMap;

    // An opaque, vertex-displaced surface must not enter the WebGPU depth pre-pass: that pass
    // draws it with the flat shared DepthMaterial (no wave displacement), so the displaced
    // troughs of the main pass (depth compare less-equal) fail the depth test and the clear
    // colour shows through as horizontal stripes (see RenderManifest.skipDepthPrePass).
    if (this._renderManifest.state) {
      this._renderManifest.state.skipDepthPrePass = !this.transparent && p4[1] > 0;
    }

    return this._renderManifest;
  }

  /** @inheritdoc */
  public override getShaderDefinition(): ShaderDefinition {
    return {
      id: this.type,
      sources: {
        glsl300: {
          vs: vertGLSL,
          fs: fragGLSL,
        },
        glsl100: {
          vs: vertGLSL100,
          fs: fragGLSL100,
        },
        wgsl: `${vertWGSL}\n[WGSL_PBR_MATH]\n[WGSL_DIR_SHADOW]\n${fragWGSL}`,
      },
      layout: {
        ...StandardWebGPULayout,
        textures: {
          u_diffuseMap: { type: ShaderPropertyType.TEXTURE },
          u_normalMap: { type: ShaderPropertyType.TEXTURE },
          u_opaqueDepthMap: { type: ShaderPropertyType.TEXTURE },
        },
      },
    };
  }
}
