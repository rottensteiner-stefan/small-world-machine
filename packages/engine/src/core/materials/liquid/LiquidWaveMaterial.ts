import { AbstractMaterial } from "../AbstractMaterial.js";
import type { Color } from "../../colors/index.js";
import { ShaderPropertyType } from "../../../enums/index.js";
import type { RenderManifest, ShaderDefinition } from "../../../renderers/shaders/index.js";
import { StandardWebGPULayout } from "../../../renderers/shaders/index.js";

/**
 * Fully-resolved construction values shared by every wave-displaced, refractive liquid surface
 * (open/realistic water, stylized/toon water). Concrete subclasses expose their own
 * `*MaterialOptions` interface with material-specific field names/defaults and map them onto
 * this shape before calling `super()`.
 */
export interface LiquidWaveMaterialInit {
  color: Color;
  deepWaterColor: Color;
  edgeColor: Color;
  edgeSoftness: number;
  speed: number;
  wave1: [number, number, number, number];
  wave2: [number, number, number, number];
  wave3: [number, number, number, number];
  refractionStrength: number;
  waterAbsorption: [number, number, number];
  foamColor: Color;
  foamDistance: number;
  foamCutoff: number;
  foamNoiseScale: number;
  foamNoiseSpeed: number;
  /**
   * Reference domain size anchor (E4-B) for the world-anchored water lanes -- depth limits and
   * Gerstner wavelengths. `1.0` (default) is a numeric identity so every lane stays byte-identical
   * to the legacy defaults ("value-preserving"); set the reciprocal of a node's scale to keep the
   * water look invariant on a scaled surface. Length semantics DIVIDE by domainScale.
   */
  domainScale?: number;
}

/**
 * Shared mechanism for wave-displaced, refractive liquid surfaces: Gerstner-wave vertex
 * displacement, screen-space refraction, Beer-Lambert depth absorption, and Worley-noise
 * shoreline/intersection foam. `OpenWaterMaterial` (realistic PBR look) and
 * `StylizedWaterMaterial` (toon look) are thin presets on top of this -- see
 * docs/adr/0013-unified-liquid-surface-material.md.
 *
 * The uniform layout this packs into (`StandardWebGPULayout`) has zero spare float slots left
 * after wave1/2/3 + foam params, which is why the opaque/emissive liquid family (lava, slime)
 * is built on `FluidSurfaceMaterial` instead -- that layout still has headroom.
 */
export abstract class LiquidWaveMaterial extends AbstractMaterial {
  public override color: Color;
  public deepWaterColor: Color;
  public edgeColor: Color;
  public edgeSoftness: number;
  public speed: number;
  public wave1: [number, number, number, number];
  public wave2: [number, number, number, number];
  public wave3: [number, number, number, number];
  public time: number = 0.0;
  public refractionStrength: number;
  public waterAbsorption: [number, number, number];
  public foamColor: Color;
  public foamDistance: number;
  public foamCutoff: number;
  public foamNoiseScale: number;
  public foamNoiseSpeed: number;
  /** See {@link LiquidWaveMaterialInit.domainScale}. Defaults to 1.0 (numeric identity). */
  public domainScale: number = 1.0;
  /** The `u_styleA` lane in the manifest. Presets own its meaning (see the lane table in docs/guides/liquid-wave-data-model.md). */
  protected readonly _styleAArray: number[] = [0, 0, 0, 0];
  /** The `u_matParam2` lane: `[foamCutoff, foamNoiseScale, foamNoiseSpeed, <preset lane>]`; `w` is free for presets. */
  protected readonly _matParam2Array: number[] = [0, 0, 0, 0];
  /** Typed semantic wave lanes (ADR 0027 / 0039): previously wave1/2/3 rode the generic
   * `u_extraParams`/`u_liquidParams`/`u_thresholds` slots and the edge shading rode
   * `u_texOffset`/`u_texRepeat`. They now live in dedicated lanes:
   *   u_matParam3 = wave1 [dirX, dirY, steepness (Q), wavelength]
   *   u_matParam4 = wave2 [dirX, dirY, steepness (Q), wavelength]
   *   u_matParam5 = wave3 [dirX, dirY, steepness (Q), wavelength]
   *   u_matParam6 = [edgeColor.r, edgeColor.g, edgeColor.b, edgeSoftness]
   */
  protected readonly _matParam3Array: number[] = [0, 0, 0, 0];
  protected readonly _matParam4Array: number[] = [0, 0, 0, 0];
  protected readonly _matParam5Array: number[] = [0, 0, 0, 0];
  protected readonly _matParam6Array: number[] = [0, 0, 0, 0];

  /**
   * Emits an impact ring wave at (x, z). Only presets that render impact rings (OpenWater) act on
   * it; the base implementation is a deliberate no-op so callers can treat every liquid alike.
   */
  public emitSplat(_x: number, _z: number, _spawnTime: number, _energy: number = 1.0): void {}

  /** Hook run at the end of every `getRenderManifest()`: presets write their own lane values here. */
  protected _packVariantLanes(): void {}

  protected constructor(type: string, init: LiquidWaveMaterialInit) {
    super(type);
    this.color = init.color;
    this.deepWaterColor = init.deepWaterColor;
    this.edgeColor = init.edgeColor;
    this.edgeSoftness = init.edgeSoftness;
    this.speed = init.speed;
    this.wave1 = init.wave1;
    this.wave2 = init.wave2;
    this.wave3 = init.wave3;
    this.refractionStrength = init.refractionStrength;
    this.waterAbsorption = init.waterAbsorption;
    this.foamColor = init.foamColor;
    this.foamDistance = init.foamDistance;
    this.foamCutoff = init.foamCutoff;
    this.foamNoiseScale = init.foamNoiseScale;
    this.foamNoiseSpeed = init.foamNoiseSpeed;
    this.domainScale = init.domainScale ?? 1.0;

    this.transparent = true;
    this.depthWrite = false;
  }

  /** Vertex/fragment source per backend -- the only part that differs between presets. */
  protected abstract _getLiquidWaveShaderSources(): ShaderDefinition["sources"];

  public override getRenderManifest(): RenderManifest {
    if (undefined === this._renderManifest) {
      this._renderManifest = this._createBaseManifest();
      // Left undefined so WebGL2 falls back to the live-captured opaque depth texture
      // (see WebGL2Renderer's sampler-bind loop); WebGPU does the equivalent fallback itself.
      this._renderManifest.textures["u_opaqueDepthMap"] = undefined;
      // Same fallback pattern for the opaque *color* capture (see GlassMaterial/FrostglassMaterial,
      // which pioneered this texture for screen-space refraction) -- gives the water surface a real
      // view of what's below it instead of only fading to a flat deepWaterColor.
      this._renderManifest.textures["u_opaqueMap"] = undefined;
      this._renderManifest.properties["u_specColor"] = this.deepWaterColor.toFloat32Array();
      // Semantic lanes for every liquid parameter (ADR 0027 512-byte bank). Wave data and edge
      // shading previously rode the generic u_extraParams/u_liquidParams/u_thresholds and
      // u_texOffset/u_texRepeat slots; they now have dedicated u_matParamN lanes (see the lane
      // table above), keeping the generic slots free for their canonical base meaning.
      this._renderManifest.properties["u_matParam3"] = this._matParam3Array;
      this._renderManifest.properties["u_matParam4"] = this._matParam4Array;
      this._renderManifest.properties["u_matParam5"] = this._matParam5Array;
      this._renderManifest.properties["u_matParam6"] = this._matParam6Array;
      this._renderManifest.properties["u_reflectivity"] = this.speed;
      this._renderManifest.properties["u_time"] = this.time;
      this._renderManifest.properties["u_styleA"] = this._styleAArray;

      // New 512-byte semantic parameter slots (matParam0..2)
      this._renderManifest.properties["u_matParam0"] = [
        this.waterAbsorption[0],
        this.waterAbsorption[1],
        this.waterAbsorption[2],
        this.refractionStrength,
      ];
      this._renderManifest.properties["u_matParam1"] = [
        this.foamColor.r,
        this.foamColor.g,
        this.foamColor.b,
        this.foamDistance,
      ];
      this._renderManifest.properties["u_matParam2"] = this._matParam2Array;
    }

    this._syncBaseManifestState();

    const props = this._renderManifest.properties as Record<string, unknown>;
    props["u_specColor"] = this.deepWaterColor.toFloat32Array();

    const w1 = this._matParam3Array;
    w1[0] = this.wave1[0];
    w1[1] = this.wave1[1];
    w1[2] = this.wave1[2];
    // E4-B: Gerstner wavelength is a world-meter value -- DIVIDED by domainScale (identity at 1.0).
    w1[3] = this.wave1[3] / this.domainScale;

    const w2 = this._matParam4Array;
    w2[0] = this.wave2[0];
    w2[1] = this.wave2[1];
    w2[2] = this.wave2[2];
    w2[3] = this.wave2[3] / this.domainScale;

    const w3 = this._matParam5Array;
    w3[0] = this.wave3[0];
    w3[1] = this.wave3[1];
    w3[2] = this.wave3[2];
    w3[3] = this.wave3[3] / this.domainScale;

    const edge = this._matParam6Array;
    edge[0] = this.edgeColor.r;
    edge[1] = this.edgeColor.g;
    edge[2] = this.edgeColor.b;
    edge[3] = this.edgeSoftness;

    props["u_reflectivity"] = this.speed;
    props["u_time"] = this.time;

    const mp0 = props["u_matParam0"] as number[] | undefined;
    if (mp0) {
      mp0[0] = this.waterAbsorption[0];
      mp0[1] = this.waterAbsorption[1];
      mp0[2] = this.waterAbsorption[2];
      mp0[3] = this.refractionStrength;
    }

    const mp1 = props["u_matParam1"] as number[] | undefined;
    if (mp1) {
      mp1[0] = this.foamColor.r;
      mp1[1] = this.foamColor.g;
      mp1[2] = this.foamColor.b;
      mp1[3] = this.foamDistance;
    }

    const mp2 = this._matParam2Array;
    mp2[0] = this.foamCutoff;
    mp2[1] = this.foamNoiseScale;
    mp2[2] = this.foamNoiseSpeed;

    this._packVariantLanes();

    return this._renderManifest;
  }

  public override getShaderDefinition(): ShaderDefinition {
    return {
      id: this.type,
      sources: this._getLiquidWaveShaderSources(),
      layout: {
        ...StandardWebGPULayout,
        textures: {
          u_opaqueDepthMap: { type: ShaderPropertyType.TEXTURE },
          u_opaqueMap: { type: ShaderPropertyType.TEXTURE },
          // Optional ramp LUT (StylizedWater only; OpenWater ignores it). Must be declared unconditionally:
          // WGSL counts bindings syntactically, so the layout entry cannot depend on the flag.
          u_rampMap: { type: ShaderPropertyType.TEXTURE },
        },
      },
    };
  }
}
