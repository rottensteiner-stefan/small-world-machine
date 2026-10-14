import fragGLSL from "./OilPuddle.frag.glsl?raw";
import fragGLSL100 from "./OilPuddle.frag.glsl100?raw";
import fragWGSL from "./OilPuddle.frag.wgsl?raw";
import {
  AbstractMaterial,
  Color,
  RenderManifest,
  ShaderDefinition,
  ShaderPropertyType,
  StandardWebGPULayout,
  Vector2D,
} from "@small-world-machine/engine";
import { THIN_FILM_GLSL_DECL, THIN_FILM_WGSL_DECL } from "../../shading/thinFilm/thinFilm.js";

/** The six established Graphic-Noir oil puddle looks (v1..v6 of the concept direction). */
export type OilPuddleLook =
  | "mutedSheen" // v2: restrained painterly sheen, the production-established default
  | "tar" // v1: pure tar pitch, essentially no colour at all
  | "chiaroscuro" // v3: near-black body, single hard lamp glint, strong env response
  | "tarSkin" // v4: weathered folded skim, tar-skin creases
  | "whaleOil" // v5: warm amber body with a strong drip-point glow
  | "posterRings"; // v6: flat Graphic-Noir poster rings around the drip point

/** The petroleum family; tunes volatility (shimmer speed) and how much colour can read. */
export type OilPuddleFluid = "crude" | "petrol" | "diesel";

/**
 * Configuration options for {@link OilPuddleMaterial}.
 */
export interface OilPuddleMaterialOptions {
  /** The base colour of the settled oil. Defaults to a near-black, faintly warm brown. */
  color?: Color;
  /** Tint of the dynamic specular highlight and the fixed drip-point glow (both read as "the
   * warm sheen of the oil catching light"). Defaults to a warm amber. */
  highlightColor?: Color;
  /** Specular tightness for the dynamic light highlight. Higher = smaller, glassier glint.
   * Defaults to 180. */
  shininess?: number;
  /** How strongly the muted thin-film iridescence tints the fresnel rim, 0-1. Defaults to 0.3 --
   * matches the "restrained sheen, not a rainbow" look established for this style. */
  iridescenceStrength?: number;
  /** Local UV-space (0-1) position of the fixed warm glow, i.e. where the oil actually drips
   * from. Defaults to (0.5, 0.22). */
  highlightPoint?: Vector2D;
  /** Falloff radius (UV units) of the fixed drip-point glow. Defaults to 0.22. */
  highlightRadius?: number;
  /** Intensity of the fixed drip-point glow. Defaults to 0.35. */
  highlightIntensity?: number;
  /** Base radius (UV units, before noise) of the organic splatter shape. Defaults to 0.32. */
  splatterBaseRadius?: number;
  /** Noise amplitude (UV units) added to the splatter edge for an irregular, non-circular
   * silhouette. Defaults to 0.12. */
  splatterNoiseAmp?: number;
  /** Width of the ink outline ring that extends beyond the oil silhouette onto the floor (UV units).
   * Defaults to 0.035. */
  outlineWidth?: number;
  /** Opacity of the outer ink outline ring, 0-1. Defaults to 0.85. */
  outlineAlpha?: number;
  /** Strength of the synthetic meniscus rim (normal perturbation at the edge), 0-1. Defaults to
   * 0.65 -- the rim catches dynamic light as a curved glint. */
  meniscusStrength?: number;
  /** How strongly the warm core colour fades to deep ink black toward the edges of the oil body, 0-1.
   * Defaults to 0.95. */
  rimDarkening?: number;
  /** How much of the real, captured floor color (tinted dark by the oil) shows through at the
   * puddle's thin rim, instead of the flat procedural ink-black edge, 0-1. 0 keeps the original
   * flat edge; 1 makes the rim read as fully translucent oil film over the actual pavement.
   * Defaults to 0.6. */
  floorVisibility?: number;
  /** Tint of the constant, analytic environment reflection (no real cubemap in this scene --
   * it doubles as the fallback before reflection routing is wired). Defaults to a cool, damp
   * basement-air tone, deliberately distinct from the warm `highlightColor` so grazing-angle
   * glints read as "reflected surroundings" rather than more lamp light. */
  envColor?: Color;
  /** Strength of the environment reflection term, 0-1. Defaults to 0.4 -- a restrained addition,
   * not a mirror finish. Set to 0 to disable. */
  envReflectivity?: number;
  /** Shimmer volatility multiplier, drives how fast the thin-film thickness noise drifts.
   * Preset by {@link fluidType} when not given explicitly. Defaults to 1.0. */
  timeScale?: number;
  /** v4 Tar-Skin: strength of the optional wrinkle perturbation on the oil body, 0-1. 0 = smooth
   * settled pool (default). */
  wrinkleStrength?: number;
  /** v6 Poster rings: whether the flat Graphic-Noir poster rings are drawn around the drip
   * point. Defaults to false. */
  ringEnabled?: boolean;
  /** Number of concentric ring bands, only used when `ringEnabled` is true. Defaults to 5. */
  ringCount?: number;
  /** Maximum reach of the ring field (UV units from the drip point). Defaults to 0.55. */
  ringReach?: number;
  /** Edge softness of the ring bands, 0-1. Lower = harder (more poster/flat). Defaults to 0.1. */
  ringSoftness?: number;
  /** Applies one of the six established Graphic-Noir looks as the parameter baseline. Explicite
   * options always win over the look. Defaults to "mutedSheen". */
  look?: OilPuddleLook;
  /** Petroleum family; adjusts shimmer volatility and the colour ceiling without overriding
   * explicit options. Defaults to "crude". */
  fluidType?: OilPuddleFluid;
}

/** Resolved preset parameter set for a look, plus the fluid modifier if any. */
interface OilPuddleParameters {
  color: Color;
  highlightColor: Color;
  shininess: number;
  iridescenceStrength: number;
  highlightPoint: Vector2D;
  highlightRadius: number;
  highlightIntensity: number;
  splatterBaseRadius: number;
  splatterNoiseAmp: number;
  outlineWidth: number;
  outlineAlpha: number;
  meniscusStrength: number;
  rimDarkening: number;
  floorVisibility: number;
  envColor: Color;
  envReflectivity: number;
  timeScale: number;
  wrinkleStrength: number;
  ringEnabled: boolean;
  ringCount: number;
  ringReach: number;
  ringSoftness: number;
}

const _mutedSheen: Omit<
  OilPuddleParameters,
  "color" | "highlightColor" | "envColor" | "highlightPoint"
> = {
  shininess: 180,
  iridescenceStrength: 0.3,
  highlightRadius: 0.22,
  highlightIntensity: 0.35,
  splatterBaseRadius: 0.32,
  splatterNoiseAmp: 0.12,
  outlineWidth: 0.035,
  outlineAlpha: 0.85,
  meniscusStrength: 0.65,
  rimDarkening: 0.95,
  floorVisibility: 0.6,
  envReflectivity: 0.4,
  timeScale: 1.0,
  wrinkleStrength: 0.0,
  ringEnabled: false,
  ringCount: 5,
  ringReach: 0.55,
  ringSoftness: 0.1,
};

const _looks: Record<OilPuddleLook, OilPuddleParameters> = {
  mutedSheen: {
    ..._mutedSheen,
    color: new Color(0.035, 0.028, 0.022, 0.95),
    highlightColor: new Color(1.0, 0.62, 0.28),
    highlightPoint: new Vector2D(0.5, 0.22),
    envColor: new Color(0.05, 0.06, 0.08),
  },
  tar: {
    ..._mutedSheen,
    color: new Color(0.012, 0.01, 0.008, 0.98),
    highlightColor: new Color(0.9, 0.85, 0.8),
    shininess: 240,
    iridescenceStrength: 0.02,
    highlightIntensity: 0.22,
    envReflectivity: 0.12,
    rimDarkening: 0.99,
    floorVisibility: 0.4,
    highlightPoint: new Vector2D(0.5, 0.22),
    envColor: new Color(0.04, 0.04, 0.05),
  },
  chiaroscuro: {
    ..._mutedSheen,
    color: new Color(0.004, 0.003, 0.003, 0.98),
    highlightColor: new Color(1.0, 0.55, 0.2),
    shininess: 320,
    iridescenceStrength: 0.04,
    highlightIntensity: 0.6,
    envReflectivity: 0.8,
    rimDarkening: 0.99,
    floorVisibility: 0.3,
    highlightPoint: new Vector2D(0.5, 0.22),
    envColor: new Color(0.05, 0.07, 0.1),
  },
  tarSkin: {
    ..._mutedSheen,
    color: new Color(0.02, 0.016, 0.012, 0.97),
    highlightColor: new Color(0.95, 0.8, 0.6),
    shininess: 130,
    iridescenceStrength: 0.12,
    highlightIntensity: 0.25,
    envReflectivity: 0.25,
    rimDarkening: 0.98,
    floorVisibility: 0.85,
    wrinkleStrength: 0.5,
    highlightPoint: new Vector2D(0.5, 0.22),
    envColor: new Color(0.04, 0.045, 0.06),
  },
  whaleOil: {
    ..._mutedSheen,
    color: new Color(0.028, 0.022, 0.016, 0.95),
    highlightColor: new Color(1.0, 0.5, 0.15),
    highlightIntensity: 0.55,
    iridescenceStrength: 0.18,
    envReflectivity: 0.35,
    rimDarkening: 0.9,
    highlightPoint: new Vector2D(0.5, 0.22),
    envColor: new Color(0.06, 0.05, 0.04),
  },
  posterRings: {
    ..._mutedSheen,
    color: new Color(0.006, 0.005, 0.004, 0.98),
    highlightColor: new Color(1.0, 0.75, 0.5),
    shininess: 60,
    iridescenceStrength: 0.06,
    highlightIntensity: 0.3,
    envReflectivity: 0.3,
    rimDarkening: 0.99,
    floorVisibility: 0.35,
    ringEnabled: true,
    ringCount: 5,
    ringReach: 0.55,
    ringSoftness: 0.1,
    highlightPoint: new Vector2D(0.5, 0.22),
    envColor: new Color(0.04, 0.05, 0.07),
  },
};

const _fluidMods: Record<OilPuddleFluid, { timeScale: number; iridescenceMultiplier: number }> = {
  crude: { timeScale: 1.0, iridescenceMultiplier: 1.0 },
  petrol: { timeScale: 1.7, iridescenceMultiplier: 0.85 },
  diesel: { timeScale: 0.85, iridescenceMultiplier: 0.7 },
};

/**
 * A settled, viscous oil puddle: muted thin-film iridescence and a real dynamic specular
 * highlight (driven by the scene's actual lights, e.g. a wall lamp) for the "hard glassy glint",
 * plus a fixed warm glow pooling at the drip point, for the "Graphic Noir" look established for
 * `character-diorama`. First-class standalone material (ADR 0025), lifted from the-whisper's
 * app-local `OilSlickMaterial` into `@small-world-machine/liquid-extras` so the production floor-puddle
 * shader and the v1..v6 look palette are maintainable and reusable; the app-local copy is
 * deprecated in favour of this one.
 *
 * Deliberately has NO vertex displacement or spreading/rippling animation -- unlike showcase 12's
 * `OilPuddleMaterial` (built for raindrop-style impact ripples), this is a thick, settled pool
 * that never moves; only its thin-film shimmer drifts slowly (scaled by `timeScale`).
 *
 * The thin-film model is the canonical shared module (`../../shading/thinFilm/thinFilm.ts`), injected into
 * all three backend sources -- never a fork. All parameter carriage goes through the dedicated
 * semantic `u_matParam0..5` lanes, so no standard slot is repurposed.
 */
export class OilPuddleMaterial extends AbstractMaterial {
  public static readonly TYPE = "OilPuddleMaterial";

  /** The base colour of the settled oil. */
  public override color: Color;
  /** Tint of the specular highlight and the fixed drip-point glow. */
  public highlightColor: Color;
  /** Specular tightness for the dynamic light highlight. */
  public shininess: number;
  /** Strength of the muted thin-film iridescence, 0-1. */
  public iridescenceStrength: number;
  /** Local UV-space position of the fixed drip-point glow. */
  public highlightPoint: Vector2D;
  /** Falloff radius (UV units) of the fixed drip-point glow. */
  public highlightRadius: number;
  /** Intensity of the fixed drip-point glow. */
  public highlightIntensity: number;
  /** Base radius (UV units) of the organic splatter shape. */
  public splatterBaseRadius: number;
  /** Noise amplitude (UV units) of the splatter edge. */
  public splatterNoiseAmp: number;
  /** Width of the ink outline ring extending beyond the oil silhouette (UV units). */
  public outlineWidth: number;
  /** Opacity of the outer ink outline ring, 0-1. */
  public outlineAlpha: number;
  /** Strength of the synthetic meniscus rim (edge normal perturbation), 0-1. */
  public meniscusStrength: number;
  /** How strongly the core colour darkens to ink black toward the edges, 0-1. */
  public rimDarkening: number;
  /** How much of the real, captured floor color shows through at the puddle's thin rim, 0-1. */
  public floorVisibility: number;
  /** Tint of the constant, analytic environment reflection. */
  public envColor: Color;
  /** Strength of the environment reflection term, 0-1. */
  public envReflectivity: number;
  /** Shimmer volatility multiplier (petroleum family tuning). */
  public timeScale: number;
  /** v4 Tar-Skin: strength of the optional wrinkle perturbation, 0-1. */
  public wrinkleStrength: number;
  /** v6 Poster rings: whether the flat Graphic-Noir poster rings are drawn. */
  public ringEnabled: boolean;
  /** Number of concentric ring bands. */
  public ringCount: number;
  /** Maximum reach of the ring field (UV units). */
  public ringReach: number;
  /** Edge softness of the ring bands, 0-1. */
  public ringSoftness: number;
  /** Current time/frame, advanced externally by the scene's update loop -- drives only the slow
   * thin-film shimmer, nothing spatial. */
  public time: number = 0;

  constructor(options: OilPuddleMaterialOptions = {}) {
    super(OilPuddleMaterial.TYPE);
    const {
      look = "mutedSheen",
      fluidType = "crude",
      color,
      highlightColor,
      highlightPoint,
      envColor,
      iridescenceStrength,
      timeScale,
      ...explicit
    } = options;

    const base = _looks[look];
    const fluid = _fluidMods[fluidType];
    const resolvedIridescence =
      iridescenceStrength !== undefined
        ? iridescenceStrength
        : Math.min(1, base.iridescenceStrength * fluid.iridescenceMultiplier);
    const resolvedTimeScale =
      timeScale !== undefined ? timeScale : base.timeScale * fluid.timeScale;

    this.color = (color ?? base.color).clone();
    this.highlightColor = (highlightColor ?? base.highlightColor).clone();
    this.shininess = explicit.shininess ?? base.shininess;
    this.iridescenceStrength = resolvedIridescence;
    this.highlightPoint = (highlightPoint ?? base.highlightPoint).clone();
    this.highlightRadius = explicit.highlightRadius ?? base.highlightRadius;
    this.highlightIntensity = explicit.highlightIntensity ?? base.highlightIntensity;
    this.splatterBaseRadius = explicit.splatterBaseRadius ?? base.splatterBaseRadius;
    this.splatterNoiseAmp = explicit.splatterNoiseAmp ?? base.splatterNoiseAmp;
    this.outlineWidth = explicit.outlineWidth ?? base.outlineWidth;
    this.outlineAlpha = explicit.outlineAlpha ?? base.outlineAlpha;
    this.meniscusStrength = explicit.meniscusStrength ?? base.meniscusStrength;
    this.rimDarkening = explicit.rimDarkening ?? base.rimDarkening;
    this.floorVisibility = explicit.floorVisibility ?? base.floorVisibility;
    this.envColor = (envColor ?? base.envColor).clone();
    this.envReflectivity = explicit.envReflectivity ?? base.envReflectivity;
    this.timeScale = resolvedTimeScale;
    this.wrinkleStrength = explicit.wrinkleStrength ?? base.wrinkleStrength;
    this.ringEnabled = explicit.ringEnabled ?? base.ringEnabled;
    this.ringCount = explicit.ringCount ?? base.ringCount;
    this.ringReach = explicit.ringReach ?? base.ringReach;
    this.ringSoftness = explicit.ringSoftness ?? base.ringSoftness;

    this.transparent = true;
  }

  /** @inheritdoc */
  public override getRenderManifest(): RenderManifest {
    if (undefined === this._renderManifest) {
      this._renderManifest = this._createBaseManifest();
      // Left undefined so the renderer falls back to its live-captured opaque colour texture
      // (see WebGL2Renderer/WebGL1Renderer's u_opaqueMap sampler-bind fallback and
      // WebGPURenderer's equivalent) -- gives the puddle's thin rim a real view of the actual
      // floor beneath it instead of only a flat procedural edge colour.
      this._renderManifest.textures["u_opaqueMap"] = undefined;
    }
    this._syncBaseManifestState();

    const props = this._renderManifest.properties as Record<string, unknown>;

    props["u_specColor"] = this.highlightColor.toFloat32Array();
    props["u_shininess"] = this.shininess;
    props["u_matParam0"] = [
      this.time,
      this.iridescenceStrength,
      this.timeScale,
      this.ringEnabled ? 1 : 0,
    ];
    props["u_matParam1"] = [
      this.highlightPoint.x,
      this.highlightPoint.y,
      this.highlightRadius,
      this.highlightIntensity,
    ];
    props["u_matParam2"] = [
      this.splatterBaseRadius,
      this.splatterNoiseAmp,
      this.outlineWidth,
      this.outlineAlpha,
    ];
    props["u_matParam3"] = [
      this.meniscusStrength,
      this.rimDarkening,
      this.floorVisibility,
      this.wrinkleStrength,
    ];
    props["u_matParam4"] = [this.ringCount, this.ringReach, this.ringSoftness, 0];
    props["u_matParam5"] = [
      this.envColor.r,
      this.envColor.g,
      this.envColor.b,
      this.envReflectivity,
    ];

    return this._renderManifest;
  }

  /** @inheritdoc */
  public override getShaderDefinition(): ShaderDefinition {
    return {
      id: OilPuddleMaterial.TYPE,
      sources: {
        glsl300: {
          vs: "[BASE_VERTEX_HEADER][BASE_VERTEX_MAIN]",
          fs: fragGLSL.replace("[THIN_FILM_DECL]", THIN_FILM_GLSL_DECL),
        },
        glsl100: {
          vs: "[BASE_VS]",
          fs: fragGLSL100.replace("[THIN_FILM_DECL]", THIN_FILM_GLSL_DECL),
        },
        wgsl: `[WGSL_STRUCTS]\n[WGSL_PBR_MATH]\n[WGSL_VS]\n${fragWGSL.replace(
          "[THIN_FILM_DECL]",
          THIN_FILM_WGSL_DECL,
        )}`,
      },
      layout: {
        ...StandardWebGPULayout,
        textures: {
          ...StandardWebGPULayout.textures,
          u_opaqueMap: { type: ShaderPropertyType.TEXTURE },
        },
      },
    };
  }
}
