import { TextureFilter, TextureWrap } from "../../enums/index.js";
import { Color } from "../colors/index.js";
import { Texture } from "./Texture.js";

/** Number of texels in a ramp LUT (256x1). */
export const RAMP_LUT_SIZE: number = 256;

/**
 * One colour stop of a ramp LUT.
 */
export interface RampStop {
  /** Position along the ramp, clamped to 0..1. */
  t: number;
  /** Stop colour as sRGB (0..1 per channel); alpha is ignored. */
  color: Color;
}

/**
 * Bakes colour stops into 256 RGBA8 sRGB texels (alpha is always 255). Stops are sorted by `t`,
 * `t` is clamped to 0..1, texels before the first / after the last stop take that stop's colour,
 * and equal `t` values produce a hard step. Pure function so it is testable without a canvas.
 * @param stops At least one colour stop.
 * @returns A new `Uint8ClampedArray` of length `RAMP_LUT_SIZE * 4`.
 */
export function bakeRamp(stops: readonly RampStop[]): Uint8ClampedArray {
  if (0 === stops.length) {
    throw new Error("[bakeRamp] At least one colour stop is required.");
  }

  const sorted = stops
    .map((s: RampStop) => ({ t: Math.min(1, Math.max(0, s.t)), color: s.color }))
    .sort((a, b) => a.t - b.t);

  const out = new Uint8ClampedArray(RAMP_LUT_SIZE * 4);
  let segment = 0;
  for (let i = 0; i < RAMP_LUT_SIZE; i++) {
    const t = i / (RAMP_LUT_SIZE - 1);
    while (segment < sorted.length - 1 && t >= sorted[segment + 1]!.t) {
      segment++;
    }
    const a = sorted[segment]!;
    const b = sorted[Math.min(segment + 1, sorted.length - 1)]!;
    // Before the first stop: segment 0 with t < a.t -> hold a.color. Past the last: a === b.
    const span = b.t - a.t;
    const k = 0 < span ? Math.min(1, Math.max(0, (t - a.t) / span)) : 0;
    const o = i * 4;
    out[o] = Math.round((a.color.r + (b.color.r - a.color.r) * k) * 255);
    out[o + 1] = Math.round((a.color.g + (b.color.g - a.color.g) * k) * 255);
    out[o + 2] = Math.round((a.color.b + (b.color.b - a.color.b) * k) * 255);
    out[o + 3] = 255;
  }
  return out;
}

/**
 * A 256x1 colour-ramp lookup texture (ADR 0026 route (a)): artist-authored gradient stops baked on the CPU
 * and sampled by the shader instead of hard-coded colour mixes. Assign `texture` to e.g.
 * `StylizedWaterMaterial.rampMap`. Stored as sRGB bytes; the shader linearises after sampling.
 * Filtering is always linear, wrapping always clamp (WebGPU shares one sampler per material anyway).
 */
export class RampLUT {
  public readonly texture: Texture;
  private readonly _canvas: HTMLCanvasElement;

  constructor(stops: readonly RampStop[]) {
    this._canvas = document.createElement("canvas");
    this._canvas.width = RAMP_LUT_SIZE;
    this._canvas.height = 1;
    this.texture = Texture.fromCanvas(this._canvas, {
      generateMipmaps: false,
      magFilter: TextureFilter.LINEAR,
      minFilter: TextureFilter.LINEAR,
      addressModeU: TextureWrap.CLAMP_TO_EDGE,
      addressModeV: TextureWrap.CLAMP_TO_EDGE,
    });
    this.setStops(stops);
  }

  /**
   * Re-bakes the ramp and flags the texture for GPU re-upload.
   * @param stops At least one colour stop.
   */
  public setStops(stops: readonly RampStop[]): void {
    const ctx = this._canvas.getContext("2d");
    if (null === ctx) {
      throw new Error("[RampLUT] 2D canvas context unavailable.");
    }
    const pixels = bakeRamp(stops);
    const image = ctx.createImageData(RAMP_LUT_SIZE, 1);
    image.data.set(pixels);
    ctx.putImageData(image, 0, 0);
    this.texture.needsUpdate = true;
  }

  /**
   * Direct factory helpers delegating to presets.
   */
  public static volcanic(): RampLUT {
    return RampLUT.presets.volcanic();
  }

  public static infernal(): RampLUT {
    return RampLUT.presets.infernal();
  }

  public static plasmaCyan(): RampLUT {
    return RampLUT.presets.plasmaCyan();
  }

  public static toxicSlime(): RampLUT {
    return RampLUT.presets.toxicSlime();
  }

  /**
   * Pre-configured colour ramp presets for stylized liquids, lava, and plasma shaders.
   */
  public static readonly presets = {
    /** Classic volcanic molten rock: deep basalt, cooling embers, vivid orange magma, incandescent white fissures. */
    volcanic(): RampLUT {
      return new RampLUT([
        { t: 0.0, color: new Color(0.08, 0.04, 0.04) }, // Obsidian / Basalt
        { t: 0.25, color: new Color(0.28, 0.07, 0.02) }, // Dark cooling embers
        { t: 0.55, color: new Color(0.78, 0.18, 0.02) }, // Flowing fiery magma
        { t: 0.78, color: new Color(1.0, 0.45, 0.0) }, // Radiant orange currents
        { t: 0.92, color: new Color(1.0, 0.85, 0.1) }, // Intense yellow fissures
        { t: 1.0, color: new Color(1.0, 1.0, 0.9) }, // Superheated white-hot vents
      ]);
    },

    /** Blazing infernal firestorm: pitch black crust, violent crimson to scorching cadmium yellow. */
    infernal(): RampLUT {
      return new RampLUT([
        { t: 0.0, color: new Color(0.04, 0.02, 0.02) },
        { t: 0.35, color: new Color(0.55, 0.02, 0.02) },
        { t: 0.7, color: new Color(0.95, 0.25, 0.01) },
        { t: 0.9, color: new Color(1.0, 0.75, 0.05) },
        { t: 1.0, color: new Color(1.0, 1.0, 0.8) },
      ]);
    },

    /** Sci-Fi / Fantasy phlogiston: deep dark navy crust with radiant electric cyan and magenta-blue plasma. */
    plasmaCyan(): RampLUT {
      return new RampLUT([
        { t: 0.0, color: new Color(0.02, 0.03, 0.08) },
        { t: 0.3, color: new Color(0.05, 0.15, 0.45) },
        { t: 0.65, color: new Color(0.0, 0.65, 0.95) },
        { t: 0.88, color: new Color(0.2, 0.95, 1.0) },
        { t: 1.0, color: new Color(0.9, 1.0, 1.0) },
      ]);
    },

    /** Toxic cauldron / radioactive slime: murky olive crust with blazing neon acid green and radioactive lemon. */
    toxicSlime(): RampLUT {
      return new RampLUT([
        { t: 0.0, color: new Color(0.03, 0.06, 0.02) },
        { t: 0.3, color: new Color(0.12, 0.28, 0.05) },
        { t: 0.65, color: new Color(0.35, 0.85, 0.08) },
        { t: 0.88, color: new Color(0.75, 1.0, 0.15) },
        { t: 1.0, color: new Color(1.0, 1.0, 0.75) },
      ]);
    },
  };
}
