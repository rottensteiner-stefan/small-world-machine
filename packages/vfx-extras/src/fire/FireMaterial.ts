import fragGLSL from "./Fire.frag.glsl?raw";
import fragGLSL100 from "./Fire.frag.glsl100?raw";
import fragWGSL from "./Fire.frag.wgsl?raw";
import vertGLSL from "./Fire.vert.glsl?raw";
import vertGLSL100 from "./Fire.vert.glsl100?raw";
import vertWGSL from "./Fire.vert.wgsl?raw";
import type { RenderManifest, ShaderDefinition } from "@small-world-machine/engine";
import {
  AbstractMaterial,
  BlendingMode,
  Color,
  CullMode,
  StandardWebGPULayout,
  Vector3D,
} from "@small-world-machine/engine";

/** Core and tip temperatures relative to the body temperature (2000 K body -> 2800 K / 1300 K). */
const CORE_TEMPERATURE_RATIO = 1.4;
const TIP_TEMPERATURE_RATIO = 0.65;

/**
 * Explicit three-stop flame ramp (sRGB-authored), hottest to coolest. Replaces the blackbody ramp
 * for fire that no real fuel produces (spectral, cursed, chemical).
 */
export interface FlamePalette {
  /** Hottest inner region. */
  readonly core: Color;
  /** Main flame body. */
  readonly body: Color;
  /** Cooling tips and flame edge. */
  readonly tip: Color;
}

/** Ready-made non-blackbody palettes. */
export const FlamePalettes = {
  /** Ghostly blue: pale cyan core, saturated blue body, violet tips. */
  SPECTRAL: {
    core: new Color(0.85, 0.97, 1),
    body: new Color(0.2, 0.55, 1),
    tip: new Color(0.25, 0.1, 0.6),
  },
  /** Will-o'-the-wisp green: pale lime core, green body, deep teal tips. */
  WISP: {
    core: new Color(0.9, 1, 0.75),
    body: new Color(0.3, 0.95, 0.35),
    tip: new Color(0.02, 0.35, 0.3),
  },
  /** Cursed violet: pink-white core, magenta body, dark purple tips. */
  CURSED: {
    core: new Color(1, 0.85, 1),
    body: new Color(0.8, 0.25, 1),
    tip: new Color(0.3, 0.02, 0.4),
  },
} as const satisfies Record<string, FlamePalette>;

/**
 * Configuration options for {@link FireMaterial}.
 */
export interface FireMaterialOptions {
  /** Body temperature in Kelvin. Defaults to 2000 (torch / campfire). */
  temperatureK?: number;
  /** HDR emission multiplier. Defaults to 2.5. */
  intensity?: number;
  /** Flow distortion strength. Defaults to 1. */
  turbulence?: number;
  /** Upward flow speed multiplier. Defaults to 1. */
  flowSpeed?: number;
  /** World-space lean of the flame tip. Defaults to none. */
  lean?: Vector3D;
  /** Per-instance noise offset so neighbouring flames never move in sync. Defaults to 0. */
  seed?: number;
  /** Explicit colour ramp; overrides `temperatureK`. Defaults to none (blackbody). */
  palette?: FlamePalette | undefined;
}

/**
 * Procedural flame body for crossed flame cards (see {@link createFlameCardGeometry}): two upward
 * scrolling value-noise layers, the first distorting the second, eroded against a teardrop mask and
 * coloured through a blackbody ramp. Rendered additively without depth writes, so it composes with
 * bloom and with other flames in any order.
 */
export class FireMaterial extends AbstractMaterial {
  public static readonly TYPE = "FireMaterial";

  /** @domain body temperature in Kelvin [1000, 6000]; core and tip are derived from it. Ignored while `palette` is set. */
  public temperatureK: number;
  /** @domain explicit sRGB colour ramp; undefined = blackbody ramp from `temperatureK`. */
  public palette: FlamePalette | undefined;
  /** @domain HDR emission multiplier (>=0); values above 1 feed bloom. */
  public intensity: number;
  /** @domain flow distortion strength (>=0); 0 = laminar candle, 1.5 = windy campfire. */
  public turbulence: number;
  /** @domain upward flow speed multiplier (>=0). */
  public flowSpeed: number;
  /** World-space lean direction of the flame tip in meters, with a quadratic falloff to zero at
   *  the base. Applied as a vertex shear in WORLD space on every tier, so all crossed cards lean
   *  identically — the card-relative fragment shear this replaces could not lean a card
   *  perpendicular to the wind and visibly split the flame. */
  public lean: Vector3D;
  /** @domain per-instance noise offset, any real number. */
  public seed: number;
  /** @domain animation time in seconds, advanced by the owner every frame. */
  public time: number = 0;
  /** @fixed facing ratio below which a card fades out (hides edge-on crossed cards). */
  public edgeFadeAngle: number = 0.35;

  private readonly _coreColor: Color = new Color();
  private readonly _bodyColor: Color = new Color();
  private readonly _tipColor: Color = new Color();
  private _rampTemperatureK: number = Number.NaN;

  constructor(options: FireMaterialOptions = {}) {
    super(FireMaterial.TYPE);
    this.temperatureK = options.temperatureK ?? 2000;
    this.intensity = options.intensity ?? 2.5;
    this.turbulence = options.turbulence ?? 1;
    this.flowSpeed = options.flowSpeed ?? 1;
    this.lean = options.lean ? options.lean.clone() : new Vector3D(0, 0, 0);
    this.seed = options.seed ?? 0;
    this.palette = options.palette;

    this.transparent = true;
    this.depthWrite = false;
    this.cullMode = CullMode.NONE;
  }

  /** @inheritdoc */
  public override getRenderManifest(): RenderManifest {
    if (undefined === this._renderManifest) {
      this._renderManifest = this._createBaseManifest();
      const props = this._renderManifest.properties;
      for (let lane = 0; lane < 5; lane++) {
        props[`u_matParam${lane}`] = [0, 0, 0, 0];
      }
      this._renderManifest.state!.blending = BlendingMode.ADDITIVE;
      this._renderManifest.state!.skipDepthPrePass = true;
    }
    this._syncBaseManifestState();
    this._syncRamp();

    const props = this._renderManifest.properties;
    const p0 = props["u_matParam0"] as number[];
    p0[0] = this.time;
    p0[1] = this.intensity;
    p0[2] = this.turbulence;
    p0[3] = this.flowSpeed;
    const palette = this.palette;
    writeColorLane(
      props["u_matParam1"] as number[],
      palette ? palette.core : this._coreColor,
      this.seed,
    );
    writeColorLane(
      props["u_matParam2"] as number[],
      palette ? palette.body : this._bodyColor,
      this.edgeFadeAngle,
    );
    writeColorLane(props["u_matParam3"] as number[], palette ? palette.tip : this._tipColor, 0);
    const p4 = props["u_matParam4"] as number[];
    p4[0] = this.lean.x;
    p4[1] = this.lean.y;
    p4[2] = this.lean.z;

    return this._renderManifest;
  }

  /** @inheritdoc */
  public override getShaderDefinition(): ShaderDefinition {
    return {
      id: FireMaterial.TYPE,
      sources: {
        glsl300: { vs: vertGLSL, fs: fragGLSL },
        glsl100: { vs: vertGLSL100, fs: fragGLSL100 },
        wgsl: `[WGSL_STRUCTS]\n${vertWGSL}\n${fragWGSL}`,
      },
      layout: StandardWebGPULayout,
    };
  }

  private _syncRamp(): void {
    if (this.palette || this._rampTemperatureK === this.temperatureK) {
      return;
    }
    this._rampTemperatureK = this.temperatureK;
    Color.fromTemperature(this.temperatureK * CORE_TEMPERATURE_RATIO, this._coreColor);
    Color.fromTemperature(this.temperatureK, this._bodyColor);
    Color.fromTemperature(this.temperatureK * TIP_TEMPERATURE_RATIO, this._tipColor);
  }
}

function writeColorLane(lane: number[], color: Color, w: number): void {
  lane[0] = color.r;
  lane[1] = color.g;
  lane[2] = color.b;
  lane[3] = w;
}
