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

    // Set transparency and blending
    this.transparent = true;
    this.depthWrite = false; // Usually true for liquids, but for soft edges we want blending. Let's keep it false for soft edges to work well, or true if we want opaque body. Let's stick to true transparent for now.
  }

  /** @inheritdoc */
  public override getRenderManifest(): RenderManifest {
    if (undefined === this._renderManifest) {
      this._renderManifest = this._createBaseManifest();
      this._renderManifest.properties["u_specColor"] = this.edgeColor.toFloat32Array();
      // u_extraParams.x and u_liquidParams.z/.w are unread by the base flow shader (x was a
      // fixed 1.0 placeholder, z/w always 0) -- repurposed to carry emissiveColor.rgb
      // (pre-multiplied by emissiveStrength) for opaque/emissive presets like LavaMaterial.
      this._renderManifest.properties["u_extraParams"] = [
        this.emissiveColor.r * this.emissiveStrength,
        this.time,
        this.flowSpeed,
        this.distortion,
      ];
      this._renderManifest.properties["u_liquidParams"] = [
        0,
        0,
        this.emissiveColor.g * this.emissiveStrength,
        this.emissiveColor.b * this.emissiveStrength,
      ];
      // Free StandardWebGPULayout slots carrying the optional look parameters (this shader reads
      // them under these names; GLSL declarations carry the same comments):
      // u_thresholds = [rim, specular, normalStrength, absorption], u_shininess = specularPower,
      // u_isTerrain = emissiveMask, u_metallic = pulse amplitude, u_roughness = pulse speed,
      // u_reflectivity = transitionSoftness, u_pad1 = shade.
      this._renderManifest.properties["u_thresholds"] = [0, 0, 0, 0];
      this._renderManifest.textures["u_diffuseMap"] = this.noiseMap;
    }

    this._syncBaseManifestState();

    const props = this._renderManifest.properties as Record<string, unknown>;
    const texs = this._renderManifest.textures as Record<string, unknown>;

    props["u_specColor"] = this.edgeColor.toFloat32Array();

    const extra = props["u_extraParams"] as number[];
    extra[0] = this.emissiveColor.r * this.emissiveStrength;
    extra[1] = this.time;
    extra[2] = this.flowSpeed;
    extra[3] = this.distortion;

    const liquid = props["u_liquidParams"] as number[];
    // Viscosity -> sluggish, large blobs: lower frequency, bigger amplitude as it grows.
    liquid[0] = 3.0 / (1.0 + this.viscosity * 0.1);
    const effectiveWaveAmplitude = this.waveAmplitude ?? 0.03 + this.viscosity * 0.006;
    liquid[1] = effectiveWaveAmplitude;
    liquid[2] = this.emissiveColor.g * this.emissiveStrength;
    liquid[3] = this.emissiveColor.b * this.emissiveStrength;

    const thr = props["u_thresholds"] as number[];
    thr[0] = this.rimStrength;
    thr[1] = this.specularStrength;
    thr[2] = this.normalStrength;
    thr[3] = this.absorption;
    props["u_shininess"] = this.specularPower;
    props["u_isTerrain"] = this.emissiveMask;
    props["u_metallic"] = this.emissivePulse;
    props["u_roughness"] = this.emissivePulseSpeed;
    props["u_reflectivity"] = this.transitionSoftness;
    props["u_pad1"] = this.shade;

    texs["u_diffuseMap"] = this.noiseMap;
    if (this.normalMap) texs["u_normalMap"] = this.normalMap;

    // An opaque, vertex-displaced surface must not enter the WebGPU depth pre-pass: that pass
    // draws it with the flat shared DepthMaterial (no wave displacement), so the displaced
    // troughs of the main pass (depth compare less-equal) fail the depth test and the clear
    // colour shows through as horizontal stripes (see RenderManifest.skipDepthPrePass).
    if (this._renderManifest.state) {
      this._renderManifest.state.skipDepthPrePass = !this.transparent && effectiveWaveAmplitude > 0;
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
