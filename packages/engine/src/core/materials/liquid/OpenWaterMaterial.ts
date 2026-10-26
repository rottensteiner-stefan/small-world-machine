import vertWGSL from "./shaders/OpenWater.vert.wgsl?raw";
import fragWGSL from "./shaders/OpenWater.frag.wgsl?raw";
import vertGLSL from "./shaders/OpenWater.vert.glsl?raw";
import fragGLSL from "./shaders/OpenWater.frag.glsl?raw";
import vertGLSL100 from "./shaders/OpenWater.vert.glsl100?raw";
import fragGLSL100 from "./shaders/OpenWater.frag.glsl100?raw";
import { LiquidWaveMaterial, type LiquidReflectionConfig } from "./LiquidWaveMaterial.js";
import { Color } from "../../colors/index.js";
import { MaterialType } from "../../../enums/index.js";
import type { ShaderDefinition } from "../../../renderers/shaders/index.js";

export interface OpenWaterMaterialOptions extends LiquidReflectionConfig {
  waterColor?: Color;
  deepWaterColor?: Color;
  edgeColor?: Color;
  edgeSoftness?: number;
  speed?: number;
  wave1?: [number, number, number, number];
  wave2?: [number, number, number, number];
  wave3?: [number, number, number, number];
  /** How strongly the wave normal distorts the sampled opaque (below-water) scene color, i.e.
   * screen-space refraction strength. 0 disables distortion (straight screen-space sample). */
  refractionStrength?: number;
  /** Per-channel Beer-Lambert absorption coefficient -- how quickly each color channel fades out
   * with water depth (thicker water = more of `deepWaterColor`, less of the tinted seabed).
   * Higher values fade faster. Red typically fades fastest in real water. */
  waterAbsorption?: [number, number, number];
  /** Color of the procedural shoreline/intersection foam. */
  foamColor?: Color;
  /** Depth-fade distance (in world units) at which the intersection foam band fully fades out.
   * Independent of `edgeSoftness` -- lets the foam band be wider or narrower than the edge-color
   * blend. Defaults to `edgeSoftness` (matching this material's previous, coupled behavior). */
  foamDistance?: number;
  /** Worley-noise threshold below which a foam cell is considered "inside" the foam pattern.
   * Lower values produce more foam coverage. */
  foamCutoff?: number;
  /** World-space UV scale of the foam's Worley-noise cells. */
  foamNoiseScale?: number;
  /** How fast the foam pattern drifts over time. */
  foamNoiseSpeed?: number;
  /**
   * Half extent of the square basin (centred on the world origin) whose walls reflect the waves
   * (S3 clapotis): the walls sit at |x| = poolHalfExtent and |z| = poolHalfExtent. 0 disables the
   * wall reflection. Defaults to 4.0, the basin of Showcase 10. Travels in `u_matParam2.w`.
   */
  poolHalfExtent?: number;
  /** See {@link LiquidWaveMaterialInit.domainScale} (E4-B). Defaults to 1.0.
   * @domain reference domain size of the water surface in meters (>0); reciprocal of a node's scale keeps the look scale-invariant. */
  domainScale?: number;
}

const SPLAT_IDLE: readonly [number, number, number, number] = [0, 0, -9999, 0];

/** Realistic, PBR-leaning open water preset on top of {@link LiquidWaveMaterial}. */
export class OpenWaterMaterial extends LiquidWaveMaterial {
  /** See {@link OpenWaterMaterialOptions.poolHalfExtent}. Must match the `OpenWaterSurfaceProbe` option of the same name. */
  public poolHalfExtent: number;
  private readonly _splat: [number, number, number, number] = [
    SPLAT_IDLE[0],
    SPLAT_IDLE[1],
    SPLAT_IDLE[2],
    SPLAT_IDLE[3],
  ];
  /**
   * R5 owned depth lane `u_matParam7`: `[refrDepth 0.3m ÷ ds, causticsMaxDepth 3.0m ÷ ds, 0, 0]`.
   * Value-preserving at domainScale 1.0; pre-scaled by `domainScale` here (length semantics ÷).
   */
  private readonly _matParam7Array: number[] = [0, 0, 0, 0];

  constructor(options: OpenWaterMaterialOptions = {}) {
    const {
      waterColor = new Color(0.0, 0.5, 0.8),
      deepWaterColor = new Color(0.0, 0.1, 0.3),
      edgeColor = new Color(0.8, 0.9, 1.0),
      edgeSoftness = 1.0,
      speed = 1.0,
      wave1 = [1.0, 0.5, 0.1, 10.0],
      wave2 = [0.2, 0.8, 0.15, 6.0],
      wave3 = [-0.3, 0.7, 0.05, 3.0],
      refractionStrength = 0.03,
      waterAbsorption = [0.3, 0.06, 0.02],
      foamColor = new Color(1.0, 1.0, 1.0),
      foamDistance = edgeSoftness,
      foamCutoff = 0.6,
      foamNoiseScale = 3.0,
      foamNoiseSpeed = 0.5,
      poolHalfExtent = 4.0,
      domainScale = 1.0,
      reflectionMap,
      reflectionStrength,
      reflectionDistortion,
    } = options;

    super(MaterialType.OPEN_WATER, {
      color: waterColor,
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
      reflectionMap,
      reflectionStrength,
      reflectionDistortion,
    });
    this.poolHalfExtent = poolHalfExtent;
  }

  /** S2 splat lane `[x, z, spawnTime, energy]` as last emitted. Read-only view; use {@link emitSplat} to change it. */
  public get splat(): readonly [number, number, number, number] {
    return this._splat;
  }

  /** Emits an impact ring wave at (x, z) at `spawnTime` (engine time) with the given energy. Only one ring is active at a time. */
  public override emitSplat(x: number, z: number, spawnTime: number, energy: number = 1.0): void {
    this._splat[0] = x;
    this._splat[1] = z;
    this._splat[2] = spawnTime;
    this._splat[3] = energy;
  }

  protected override _packVariantLanes(): void {
    const styleA = this._styleAArray;
    styleA[0] = this._splat[0];
    styleA[1] = this._splat[1];
    styleA[2] = this._splat[2];
    styleA[3] = this._splat[3];
    this._matParam2Array[3] = this.poolHalfExtent;
    // R5/E4-B: world-meter depth constants in the owned lane, ÷ domainScale (identity at 1.0).
    const p7 = this._matParam7Array;
    p7[0] = 0.3 / this.domainScale; // screen-space refraction damping depth (m)
    p7[1] = 3.0 / this.domainScale; // caustics max projection depth (m)
    p7[2] = 0;
    p7[3] = 0;
    // Runs at the end of the base getRenderManifest, after the manifest has been created.
    const rm = this._renderManifest;
    if (rm) rm.properties["u_matParam7"] = p7;
  }

  protected override _getLiquidWaveShaderSources(): ShaderDefinition["sources"] {
    return {
      glsl300: {
        vs: vertGLSL,
        fs: fragGLSL,
      },
      glsl100: {
        vs: vertGLSL100,
        fs: fragGLSL100,
      },
      wgsl: `${vertWGSL}\n[WGSL_PBR_MATH]\n[WGSL_DIR_SHADOW]\n${fragWGSL}`,
    };
  }
}
