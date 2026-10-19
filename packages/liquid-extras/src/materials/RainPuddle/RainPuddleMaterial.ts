import commonGLSL from "./RainPuddle.common.glsl?raw";
import commonWGSL from "./RainPuddle.common.wgsl?raw";
import fragGLSL from "./RainPuddle.frag.glsl?raw";
import fragGLSL100 from "./RainPuddle.frag.glsl100?raw";
import fragWGSL from "./RainPuddle.frag.wgsl?raw";
import type { RenderManifest, ShaderDefinition, Texture } from "@small-world-machine/engine";
import { AbstractMaterial, StandardWebGPULayout, Vector2D } from "@small-world-machine/engine";

const COMMON_TOKEN = "[RAIN_PUDDLE_COMMON]";

/** Index of refraction of water, analysis.md 3.2. */
const WATER_IOR = 1.333;

/** A puddle basin: an elliptical Gaussian depression in the street, in world units (metres). */
export interface RainPuddleBasin {
  x: number;
  z: number;
  radiusX: number;
  radiusZ: number;
}

/** The shader evaluates exactly this many basins (one matParam lane each). */
export const RAIN_PUDDLE_MAX_BASINS = 4;

const BASIN_LANES: readonly string[] = ["u_matParam4", "u_matParam5", "u_matParam6", "u_matParam7"];

// Far away with a tiny radius: the basin's Gaussian evaluates to exactly 0 everywhere in a scene.
const UNUSED_BASIN: readonly number[] = [1.0e5, 1.0e5, 1.0e-3, 1.0e-3];

/**
 * Configuration options for {@link RainPuddleMaterial}.
 */
export interface RainPuddleMaterialOptions {
  /** Live mirror image, normally `PlanarReflectionNode.renderTarget`. */
  reflectionMap?: Texture | undefined;
  /** The street's asphalt colour texture. Its luminance doubles as the aggregate height field, so
   * the shoreline frays exactly at the stones that are visible on the street. */
  asphaltMap?: Texture | undefined;
  /** World-space metres per asphalt texture repeat. Must match how the street maps the same
   * texture, including sign (a negative axis flips it). Defaults to (1, 1). */
  asphaltTilePeriod?: Vector2D;
  /** Up to {@link RAIN_PUDDLE_MAX_BASINS} basins; extra entries are ignored. */
  basins?: RainPuddleBasin[];
  /** Water depth at a basin centre, mm. Defaults to 6. */
  basinDepthMm?: number;
  /** Height difference between the darkest and brightest asphalt texel, mm. Defaults to 3. */
  heightContrastMm?: number;
  /** Low-frequency wobble of the basins so shorelines aren't ellipses, 0-1. Defaults to 0.6. */
  edgeNoise?: number;
  /** Width of the damp, darkened band around each puddle, mm of virtual height. Defaults to 0.8. */
  dampWidthMm?: number;
  /** How much the damp band darkens the street, 0-1. Defaults to 0.35. */
  dampDarkening?: number;
  /** Share of the street colour that survives the trip through the water, 0-1. Defaults to 0.55. */
  bottomTransmission?: number;
  /** Screen-UV offset of the mirror image per unit of ripple normal tilt. Defaults to 0.35. */
  reflectionDistortion?: number;
  /** Screen-UV blur radius of the mirror image per unit rms slope of unresolved ripples.
   * Defaults to 0.25. */
  reflectionBlur?: number;
  /** Probability per cell and period that a small rain drop lands, 0-1. Defaults to 0.7. */
  rainIntensity?: number;
  /** Probability per cell and period that a big drip (with daughter drop) lands, 0-1.
   * Defaults to 0.5. */
  dripIntensity?: number;
  /** Multiplier on the scene lights' glints on the water. Defaults to 4. */
  specularStrength?: number;
  /** Phong exponent of the light glints. Defaults to 900. */
  shininess?: number;
}

/**
 * A rain puddle layer for a street: physically based water on top of an existing opaque surface.
 *
 * Meant for one large transparent plane laid just above the street. The shader decides per pixel
 * whether there is water (level set of basins against the asphalt height), a damp halo, or nothing
 * (discarded). Rain rings follow the capillary-gravity dispersion relation through a
 * stationary-phase profile, so short waves lead and long waves trail, and each drop differs in
 * size, strength and daughter drop. The water reflects with exact dielectric Fresnel instead of a
 * metallic hack, and ripples both distort and blur the mirror image. Derivation:
 * `.agents/scratches/puddle/analysis.md`.
 *
 * Per frame the owner must advance {@link time} and call {@link setCameraFootprint} (it drives the
 * resolved-vs-roughness split of the ripples). The plane must be in the reflection node's
 * `excludedObjects`.
 */
export class RainPuddleMaterial extends AbstractMaterial {
  public static readonly TYPE = "RainPuddleMaterial";

  public reflectionMap: Texture | undefined;
  public asphaltMap: Texture | undefined;
  public asphaltTilePeriod: Vector2D;
  public basins: RainPuddleBasin[];
  public basinDepthMm: number;
  public heightContrastMm: number;
  public edgeNoise: number;
  public dampWidthMm: number;
  public dampDarkening: number;
  public bottomTransmission: number;
  public reflectionDistortion: number;
  public reflectionBlur: number;
  public rainIntensity: number;
  public dripIntensity: number;
  public specularStrength: number;
  public shininess: number;
  /** Seconds, advanced by the owner's update loop. */
  public time: number = 0;
  /** Radians per screen pixel, see {@link setCameraFootprint}. */
  public pixelAngle: number = 0.001;

  constructor(options: RainPuddleMaterialOptions = {}) {
    super(RainPuddleMaterial.TYPE);
    this.reflectionMap = options.reflectionMap;
    this.asphaltMap = options.asphaltMap;
    this.asphaltTilePeriod = (options.asphaltTilePeriod ?? new Vector2D(1, 1)).clone();
    this.basins = (options.basins ?? []).slice(0, RAIN_PUDDLE_MAX_BASINS).map((b) => ({ ...b }));
    this.basinDepthMm = options.basinDepthMm ?? 6;
    this.heightContrastMm = options.heightContrastMm ?? 3;
    this.edgeNoise = options.edgeNoise ?? 0.6;
    this.dampWidthMm = options.dampWidthMm ?? 0.8;
    this.dampDarkening = options.dampDarkening ?? 0.35;
    this.bottomTransmission = options.bottomTransmission ?? 0.55;
    this.reflectionDistortion = options.reflectionDistortion ?? 0.35;
    this.reflectionBlur = options.reflectionBlur ?? 0.25;
    this.rainIntensity = options.rainIntensity ?? 0.7;
    this.dripIntensity = options.dripIntensity ?? 0.5;
    this.specularStrength = options.specularStrength ?? 4;
    this.shininess = options.shininess ?? 900;

    this.transparent = true;
    this.depthWrite = false;
  }

  /**
   * Derives the per-pixel view angle the ripple shader uses to decide which wavelengths the screen
   * can still resolve. Call whenever the camera FOV or viewport height changes (cheap enough to
   * call every frame).
   * @param fovY Vertical field of view in radians.
   * @param viewportHeightPx Drawing buffer height in pixels.
   */
  public setCameraFootprint(fovY: number, viewportHeightPx: number): void {
    this.pixelAngle = (2 * Math.tan(fovY / 2)) / Math.max(1, viewportHeightPx);
  }

  /** @inheritdoc */
  public override getRenderManifest(): RenderManifest {
    if (undefined === this._renderManifest) {
      this._renderManifest = this._createBaseManifest();
    }
    this._syncBaseManifestState();

    const texs = this._renderManifest.textures;
    texs["u_diffuseMap"] = this.asphaltMap;
    texs["u_reflectionMap"] = this.reflectionMap;

    const props = this._renderManifest.properties as Record<string, unknown>;
    props["u_shininess"] = this.shininess;
    props["u_matParam0"] = [this.time, this.pixelAngle, this.rainIntensity, this.dripIntensity];
    props["u_matParam1"] = [
      this.asphaltTilePeriod.x,
      this.asphaltTilePeriod.y,
      this.heightContrastMm,
      this.edgeNoise,
    ];
    props["u_matParam2"] = [
      WATER_IOR,
      this.bottomTransmission,
      this.reflectionDistortion,
      this.reflectionBlur,
    ];
    props["u_matParam3"] = [
      this.basinDepthMm,
      this.dampWidthMm,
      this.dampDarkening,
      this.specularStrength,
    ];
    for (let b = 0; b < RAIN_PUDDLE_MAX_BASINS; b++) {
      const basin = this.basins[b];
      props[BASIN_LANES[b]!] = basin
        ? [basin.x, basin.z, basin.radiusX, basin.radiusZ]
        : UNUSED_BASIN;
    }

    return this._renderManifest;
  }

  /** @inheritdoc */
  public override getShaderDefinition(): ShaderDefinition {
    return {
      id: RainPuddleMaterial.TYPE,
      sources: {
        glsl300: {
          vs: "[BASE_VERTEX_HEADER][BASE_VERTEX_MAIN]",
          fs: fragGLSL.replace(COMMON_TOKEN, commonGLSL),
        },
        glsl100: {
          vs: "[BASE_VS]",
          fs: fragGLSL100.replace(COMMON_TOKEN, commonGLSL),
        },
        wgsl: `[WGSL_STRUCTS]\n[WGSL_PBR_MATH]\n[WGSL_VS]\n${fragWGSL.replace(COMMON_TOKEN, commonWGSL)}`,
      },
      layout: StandardWebGPULayout,
    };
  }
}
