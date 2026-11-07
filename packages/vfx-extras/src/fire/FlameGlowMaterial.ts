import fragGLSL from "./FlameGlow.frag.glsl?raw";
import fragGLSL100 from "./FlameGlow.frag.glsl100?raw";
import fragWGSL from "./FlameGlow.frag.wgsl?raw";
import type { RenderManifest, ShaderDefinition } from "@small-world-machine/engine";
import {
  AbstractMaterial,
  BlendingMode,
  Color,
  CullMode,
  StandardWebGPULayout,
} from "@small-world-machine/engine";

/**
 * Configuration options for {@link FlameGlowMaterial}.
 */
export interface FlameGlowMaterialOptions {
  /** Glow temperature in Kelvin. Defaults to 1900. */
  temperatureK?: number;
  /** Emission multiplier. Defaults to 0.6. */
  intensity?: number;
  /** Gaussian falloff; higher = tighter halo. Defaults to 4. */
  falloff?: number;
  /** Explicit sRGB glow colour; overrides `temperatureK` (e.g. a palette's body colour). */
  tint?: Color | undefined;
}

/**
 * Camera-facing radial halo around a flame: the cheap "practical light" near-field glow. It carries
 * the warm bloom on its own where HDR bloom is unavailable (WebGL1, LOW tier). Put it on a unit
 * `Plane`; the renderer billboards it.
 */
export class FlameGlowMaterial extends AbstractMaterial {
  public static readonly TYPE = "FlameGlowMaterial";

  /** @domain glow temperature in Kelvin [1000, 6000]. Ignored while `tint` is set. */
  public temperatureK: number;
  /** @domain explicit sRGB glow colour; undefined = blackbody colour from `temperatureK`. */
  public tint: Color | undefined;
  /** @domain emission multiplier (>=0); a flicker behavior may scale it per frame. */
  public intensity: number;
  /** @domain Gaussian falloff exponent (>0); higher = tighter halo. */
  public falloff: number;

  private readonly _color: Color = new Color();
  private _colorTemperatureK: number = Number.NaN;

  constructor(options: FlameGlowMaterialOptions = {}) {
    super(FlameGlowMaterial.TYPE);
    this.temperatureK = options.temperatureK ?? 1900;
    this.intensity = options.intensity ?? 0.6;
    this.falloff = options.falloff ?? 4;
    this.tint = options.tint;

    this.transparent = true;
    this.depthWrite = false;
    this.cullMode = CullMode.NONE;
  }

  /** @inheritdoc */
  public override getRenderManifest(): RenderManifest {
    if (undefined === this._renderManifest) {
      this._renderManifest = this._createBaseManifest();
      this._renderManifest.properties["u_matParam0"] = [0, 0, 0, 0];
      this._renderManifest.properties["u_matParam1"] = [0, 0, 0, 0];
      const state = this._renderManifest.state!;
      state.blending = BlendingMode.ADDITIVE;
      state.isSprite = true;
      // Billboarding happens per draw, which the shared depth pre-pass pipeline cannot reproduce.
      state.skipDepthPrePass = true;
    }
    this._syncBaseManifestState();

    if (this._colorTemperatureK !== this.temperatureK) {
      this._colorTemperatureK = this.temperatureK;
      Color.fromTemperature(this.temperatureK, this._color);
    }

    const props = this._renderManifest.properties;
    const p0 = props["u_matParam0"] as number[];
    p0[0] = this.intensity;
    p0[1] = this.falloff;
    const color = this.tint ?? this._color;
    const p1 = props["u_matParam1"] as number[];
    p1[0] = color.r;
    p1[1] = color.g;
    p1[2] = color.b;

    return this._renderManifest;
  }

  /** @inheritdoc */
  public override getShaderDefinition(): ShaderDefinition {
    return {
      id: FlameGlowMaterial.TYPE,
      sources: {
        glsl300: { vs: "[BASE_VERTEX_HEADER][BASE_VERTEX_MAIN]", fs: fragGLSL },
        glsl100: { vs: "[BASE_VS]", fs: fragGLSL100 },
        wgsl: `[WGSL_STRUCTS]\n[WGSL_VS]\n${fragWGSL}`,
      },
      layout: StandardWebGPULayout,
    };
  }
}
