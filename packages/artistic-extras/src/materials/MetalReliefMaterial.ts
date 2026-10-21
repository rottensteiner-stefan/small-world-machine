import fragGLSL from "./shaders/MetalRelief.frag.glsl?raw";
import fragGLSL100 from "./shaders/MetalRelief.frag.glsl100?raw";
import fragWGSL from "./shaders/MetalRelief.frag.wgsl?raw";
import {
  AbstractMaterial,
  Color,
  ShaderPropertyType,
  StandardWebGPULayout,
} from "@small-world-machine/engine";
import type { RenderManifest, ShaderDefinition, Texture } from "@small-world-machine/engine";

export interface MetalReliefMaterialOptions {
  /** Base albedo tint. Defaults to white. */
  color?: Color;
  /** Diffuse albedo texture. */
  diffuseMap?: Texture | undefined;
  /** Strength of the Worley/Voronoi faceted impasto relief normal perturbation (0..2). Defaults to 0.6. */
  paletteKnifeStrength?: number;
  /** Frequency / scale of palette knife facets. Defaults to 12.0. */
  paletteKnifeScale?: number;
  /** Strength of brushed metal and angle grind scratches (0..1). Defaults to 0.35. */
  scratchIntensity?: number;
  /** Density / frequency of metal scratch grooves. Defaults to 80.0. */
  scratchScale?: number;
  /** Welded edge bevel and curvature highlight strength (0..2). Defaults to 0.8. */
  edgeBevelStrength?: number;
  /** Procedural Streckmetall (diamond wire mesh) lattice blend (0..1). Defaults to 0.0. */
  wireMeshStrength?: number;
  /** Scale of diamond wire mesh lattice. Defaults to 40.0. */
  wireMeshScale?: number;
  /** Vertical glossy wet sheen and rain reflection streaks (0..1). Defaults to 0.4. */
  wetRainStreaks?: number;
  /** Target accent hue to preserve in [0, 1] (0.0 = pure red). Defaults to 0.0. */
  colorPopTargetHue?: number;
  /** Angular tolerance window for the accent hue. Defaults to 0.09. */
  colorPopTolerance?: number;
  /** How completely non-accent areas are converted to steel/rust (0..1). Defaults to 0.95. */
  colorPopDesaturation?: number;
  /** Strength of warm iron oxide / raw umber rust in shadows (0..1). Defaults to 0.75. */
  rustStrength?: number;
  /** Base metalness (0..1). Defaults to 0.4. */
  metallic?: number;
  /** Base roughness (0..1). Defaults to 0.7. */
  roughness?: number;
}

/**
 * Material that replicates sculptural 3D metal wall reliefs, heavy impasto palette knife strokes,
 * angle-grinder scratches, welded seams, and high-contrast color pop (e.g. vibrant scarlet on weathered steel).
 */
export class MetalReliefMaterial extends AbstractMaterial {
  public static readonly TYPE: string = "MetalReliefMaterial";

  public diffuseMap: Texture | undefined;
  public paletteKnifeStrength: number;
  public paletteKnifeScale: number;
  public scratchIntensity: number;
  public scratchScale: number;
  public edgeBevelStrength: number;
  public wireMeshStrength: number;
  public wireMeshScale: number;
  public wetRainStreaks: number;
  public colorPopTargetHue: number;
  public colorPopTolerance: number;
  public colorPopDesaturation: number;
  public rustStrength: number;
  public metallic: number;
  public roughness: number;
  public time: number = 0.0;

  constructor(options: MetalReliefMaterialOptions = {}) {
    super(MetalReliefMaterial.TYPE);

    this.color = options.color ?? new Color(1, 1, 1);
    this.diffuseMap = options.diffuseMap;
    this.paletteKnifeStrength = options.paletteKnifeStrength ?? 0.6;
    this.paletteKnifeScale = options.paletteKnifeScale ?? 12.0;
    this.scratchIntensity = options.scratchIntensity ?? 0.35;
    this.scratchScale = options.scratchScale ?? 80.0;
    this.edgeBevelStrength = options.edgeBevelStrength ?? 0.8;
    this.wireMeshStrength = options.wireMeshStrength ?? 0.0;
    this.wireMeshScale = options.wireMeshScale ?? 40.0;
    this.wetRainStreaks = options.wetRainStreaks ?? 0.4;
    this.colorPopTargetHue = options.colorPopTargetHue ?? 0.0;
    this.colorPopTolerance = options.colorPopTolerance ?? 0.09;
    this.colorPopDesaturation = options.colorPopDesaturation ?? 0.95;
    this.rustStrength = options.rustStrength ?? 0.75;
    this.metallic = options.metallic ?? 0.4;
    this.roughness = options.roughness ?? 0.7;
  }

  /** @inheritdoc */
  public override getRenderManifest(): RenderManifest {
    if (undefined === this._renderManifest) {
      this._renderManifest = this._createBaseManifest();
      this._renderManifest.properties["u_specColor"] = new Float32Array([1.0, 1.0, 1.0, 1.0]);
      this._renderManifest.properties["u_styleA"] = [0.0, 0.0, 0.0, 0.0];
      // Own semantic lanes (ADR 0039). `u_extraParams[1]` is the engine's alpha-test cutoff and
      // `[2..3]` its normal scale: reusing them made the depth/shadow passes discard the surface.
      this._renderManifest.properties["u_matParam0"] = [0.0, 0.0, 0.0, 0.0];
      this._renderManifest.properties["u_matParam1"] = [0.0, 0.0, 0.0, 0.0];
      this._renderManifest.textures["u_diffuseMap"] = this.diffuseMap;
    }

    this._syncBaseManifestState();

    const props = this._renderManifest.properties as Record<string, unknown>;
    const texs = this._renderManifest.textures as Record<string, unknown>;

    texs["u_diffuseMap"] = this.diffuseMap;
    this._syncTexOffsetRepeat(this.diffuseMap);

    props["u_metallic"] = this.metallic;
    props["u_roughness"] = this.roughness;
    props["u_time"] = this.time;

    const extra = props["u_matParam0"] as number[];
    extra[0] = this.paletteKnifeStrength;
    extra[1] = this.paletteKnifeScale;
    extra[2] = this.scratchIntensity;
    extra[3] = this.scratchScale;

    const liquid = props["u_matParam1"] as number[];
    liquid[0] = this.edgeBevelStrength;
    liquid[1] = this.wireMeshStrength;
    liquid[2] = this.wireMeshScale;
    liquid[3] = this.wetRainStreaks;

    const styleA = props["u_styleA"] as number[];
    styleA[0] = this.colorPopTargetHue;
    styleA[1] = this.colorPopTolerance;
    styleA[2] = this.colorPopDesaturation;
    styleA[3] = this.rustStrength;

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
        wgsl: `[WGSL_STRUCTS]\n[WGSL_VS]\n${fragWGSL}`,
      },
      layout: {
        ...StandardWebGPULayout,
        textures: {
          u_diffuseMap: { type: ShaderPropertyType.TEXTURE },
        },
      },
    };
  }
}
