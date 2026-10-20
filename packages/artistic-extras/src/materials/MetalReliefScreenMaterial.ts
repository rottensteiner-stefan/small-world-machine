import fragGLSL from "./shaders/MetalReliefScreen.frag.glsl?raw";
import fragGLSL100 from "./shaders/MetalReliefScreen.frag.glsl100?raw";
import fragWGSL from "./shaders/MetalReliefScreen.frag.wgsl?raw";
import {
  AbstractMaterial,
  Color,
  ShaderPropertyType,
  StandardWebGPULayout,
} from "@small-world-machine/engine";
import type { RenderManifest, ShaderDefinition, Texture } from "@small-world-machine/engine";

export interface MetalReliefScreenMaterialOptions {
  /** The 2D input diffuse texture containing the photo/painting. */
  diffuseMap?: Texture | undefined;
  /** Color tint. Defaults to white. */
  color?: Color;
  /** Strength of the Sobel luminance relief extrusion (0..4). Defaults to 1.5. */
  reliefStrength?: number;
  /** Strength of the Voronoi palette knife faceting (0..2). Defaults to 0.5. */
  paletteKnifeStrength?: number;
  /** Frequency / scale of palette knife facets. Defaults to 24.0. */
  paletteKnifeScale?: number;
  /** Strength of brushed metal and angle grinder scratches (0..1). Defaults to 0.35. */
  scratchIntensity?: number;
  /** Density / frequency of scratch grooves. Defaults to 120.0. */
  scratchScale?: number;
  /** Specular highlight on raised edges and contours (0..3). Defaults to 1.2. */
  edgeGlintStrength?: number;
  /** Vertical glossy wet sheen and rain reflection streaks in bottom half (0..1). Defaults to 0.5. */
  wetRainStreaks?: number;
  /** Procedural diamond wire mesh overlay (0..1). Defaults to 0.0. */
  wireMeshStrength?: number;
  /** Target accent hue to preserve in [0, 1] (0.0 = pure red). Defaults to 0.0. */
  targetHue?: number;
  /** Angular tolerance window for the accent hue. Defaults to 0.09. */
  hueTolerance?: number;
  /** How completely non-accent areas are converted to steel/rust (0..1). Defaults to 0.95. */
  desaturation?: number;
  /** Strength of warm iron oxide / raw umber rust in shadows (0..1). Defaults to 0.8. */
  rustStrength?: number;
}

/**
 * Screen/Canvas material that takes any 2D image/texture and transforms it into a sculptural
 * metal wall relief painting with Sobel embossing, palette knife impasto, flex scratches, and color pop.
 */
export class MetalReliefScreenMaterial extends AbstractMaterial {
  public static readonly TYPE: string = "MetalReliefScreenMaterial";

  public diffuseMap: Texture | undefined;
  public reliefStrength: number;
  public paletteKnifeStrength: number;
  public paletteKnifeScale: number;
  public scratchIntensity: number;
  public scratchScale: number;
  public edgeGlintStrength: number;
  public wetRainStreaks: number;
  public wireMeshStrength: number;
  public targetHue: number;
  public hueTolerance: number;
  public desaturation: number;
  public rustStrength: number;
  public time: number = 0.0;

  constructor(options: MetalReliefScreenMaterialOptions = {}) {
    super(MetalReliefScreenMaterial.TYPE);

    this.diffuseMap = options.diffuseMap;
    this.color = options.color ?? new Color(1, 1, 1);
    this.reliefStrength = options.reliefStrength ?? 1.5;
    this.paletteKnifeStrength = options.paletteKnifeStrength ?? 0.5;
    this.paletteKnifeScale = options.paletteKnifeScale ?? 24.0;
    this.scratchIntensity = options.scratchIntensity ?? 0.35;
    this.scratchScale = options.scratchScale ?? 120.0;
    this.edgeGlintStrength = options.edgeGlintStrength ?? 1.2;
    this.wetRainStreaks = options.wetRainStreaks ?? 0.5;
    this.wireMeshStrength = options.wireMeshStrength ?? 0.0;
    this.targetHue = options.targetHue ?? 0.0;
    this.hueTolerance = options.hueTolerance ?? 0.09;
    this.desaturation = options.desaturation ?? 0.95;
    this.rustStrength = options.rustStrength ?? 0.8;
  }

  /** @inheritdoc */
  public override getRenderManifest(): RenderManifest {
    if (undefined === this._renderManifest) {
      this._renderManifest = this._createBaseManifest();
      this._renderManifest.properties["u_specColor"] = new Float32Array([1.0, 1.0, 1.0, 1.0]);
      this._renderManifest.properties["u_styleA"] = [0.0, 0.0, 0.0, 0.0];
      this._renderManifest.textures["u_diffuseMap"] = this.diffuseMap;
    }

    this._syncBaseManifestState();

    const props = this._renderManifest.properties as Record<string, unknown>;
    const texs = this._renderManifest.textures as Record<string, unknown>;

    texs["u_diffuseMap"] = this.diffuseMap;
    this._syncTexOffsetRepeat(this.diffuseMap);

    props["u_time"] = this.time;

    const extra = props["u_extraParams"] as number[];
    extra[0] = this.reliefStrength;
    extra[1] = this.paletteKnifeStrength;
    extra[2] = this.paletteKnifeScale;
    extra[3] = this.scratchIntensity;

    const liquid = props["u_liquidParams"] as number[];
    liquid[0] = this.scratchScale;
    liquid[1] = this.edgeGlintStrength;
    liquid[2] = this.wetRainStreaks;
    liquid[3] = this.wireMeshStrength;

    const styleA = props["u_styleA"] as number[];
    styleA[0] = this.targetHue;
    styleA[1] = this.hueTolerance;
    styleA[2] = this.desaturation;
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
