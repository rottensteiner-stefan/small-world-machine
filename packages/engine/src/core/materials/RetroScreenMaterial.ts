import fragGLSL from "./shaders/RetroScreen.frag.glsl?raw";
import fragGLSL100 from "./shaders/RetroScreen.frag.glsl100?raw";
import fragWGSL from "./shaders/RetroScreen.frag.wgsl?raw";
import { AbstractMaterial } from "./AbstractMaterial.js";
import { MaterialType, ShaderPropertyType } from "../../enums/index.js";
import type { Texture } from "../textures/index.js";
import type { RenderManifest, ShaderDefinition } from "../../renderers/shaders/index.js";
import { StandardWebGPULayout } from "../../renderers/shaders/index.js";

/**
 * Modes supported by RetroScreenMaterial.
 */
export type RetroScreenMode = "tv50s" | "film19th";

/**
 * Configuration options for RetroScreenMaterial.
 */
export interface RetroScreenMaterialOptions {
  /** The diffuse texture containing screen contents. */
  diffuseMap?: Texture | undefined;
  /** Active retro screen mode. Defaults to "tv50s". */
  mode?: RetroScreenMode | undefined;
  /** Overall intensity of the retro effects (0.0 to 1.0). Defaults to 1.0. */
  intensity?: number | undefined;
  /** Custom speed multiplier for animations. Defaults to 1.0. */
  speed?: number | undefined;
  /** TV: snow density, Film: scratch count scale. */
  param1?: number | undefined;
  /** TV: scanline count/scale, Film: flicker speed multiplier. */
  param2?: number | undefined;
  /** TV: tearing freq/strength, Film: dirt density. */
  param3?: number | undefined;
  /** TV: roll speed multiplier, Film: sepia strength multiplier. */
  param4?: number | undefined;
}

/**
 * A highly specialized material for rendering retro screen effects (50s TV & 19th Century Film) locally on a mesh.
 */
export class RetroScreenMaterial extends AbstractMaterial {
  /** The screen's content texture. */
  public diffuseMap: Texture | undefined;
  /** Retro mode. */
  public mode: RetroScreenMode;
  /** Effect intensity. */
  public intensity: number;
  /** Animation speed multiplier. */
  public speed: number;
  /** Time parameter updated per frame. */
  public time: number = 0.0;

  // Custom params mapped depending on mode
  public param1: number;
  public param2: number;
  public param3: number;
  public param4: number;

  /**
   * Creates a new RetroScreenMaterial.
   * @param options Configuration options.
   */
  constructor(options: RetroScreenMaterialOptions = {}) {
    super(MaterialType.RETRO_SCREEN);

    this.diffuseMap = options.diffuseMap;
    this.mode = options.mode ?? "tv50s";
    this.intensity = options.intensity ?? 1.0;
    this.speed = options.speed ?? 1.0;

    // Apply defaults based on the chosen mode if not specified
    if (this.mode === "tv50s") {
      this.param1 = options.param1 ?? 0.08; // snow intensity
      this.param2 = options.param2 ?? 800.0; // scanline count
      this.param3 = options.param3 ?? 1.0; // tearing strength
      this.param4 = options.param4 ?? 0.15; // roll speed
    } else {
      this.param1 = options.param1 ?? 1.0; // scratch count scale
      this.param2 = options.param2 ?? 15.0; // flicker speed
      this.param3 = options.param3 ?? 1.0; // dirt density
      this.param4 = options.param4 ?? 1.0; // sepia strength
    }
  }

  /** @inheritdoc */
  public override getRenderManifest(): RenderManifest {
    if (undefined === this._renderManifest) {
      this._renderManifest = this._createBaseManifest();
      this._renderManifest.properties["u_specColor"] = new Float32Array([1.0, 1.0, 1.0, 1.0]);
      this._renderManifest.textures["u_diffuseMap"] = this.diffuseMap;
    }

    this._syncBaseManifestState();

    const props = this._renderManifest.properties as Record<string, unknown>;
    const texs = this._renderManifest.textures as Record<string, unknown>;

    texs["u_diffuseMap"] = this.diffuseMap;
    this._syncTexOffsetRepeat(this.diffuseMap);

    const extra = props["u_extraParams"] as number[];
    extra[0] = this.intensity;
    extra[1] = this.time;
    extra[2] = this.speed;
    extra[3] = this.mode === "tv50s" ? 0.0 : 1.0;

    const params = props["u_liquidParams"] as number[];
    params[0] = this.param1;
    params[1] = this.param2;
    params[2] = this.param3;
    params[3] = this.param4;

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
