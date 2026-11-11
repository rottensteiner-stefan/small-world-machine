/**
 * Canopy-driven look blend (ADR 0059 step 6a): eases between an open-sky foliage look and an
 * under-canopy look by the canopy coverage above the camera.
 *
 * Industry model: UE post-process volumes with blend weights / Unity volume blending — here the
 * weight comes from the canopy map instead of authored volumes. The tone curve stays the `open`
 * look's (switching curves jumps; AgX greys an open sky); exposure, contrast, saturation,
 * temperature, tint and lift/gamma/gain blend. Zero allocation per update.
 */
import type { PostProcessingGroup } from "@small-world-machine/engine";
import { applyFoliageLook, type FoliageLook } from "./FoliageLook.js";

export class ForestLookBlender {
  /** Current eased weight (0 = open look, 1 = under-canopy look). */
  public weight = 0;
  private _applied = -1;
  private readonly _mix: {
    name: string;
    toneMapping: FoliageLook["toneMapping"];
    exposure: number;
    contrast: number;
    saturation: number;
    temperature: number;
    tint: number;
    lift: [number, number, number];
    gamma: [number, number, number];
    gain: [number, number, number];
  };

  /**
   * @param open Look under open sky (its tone curve is kept).
   * @param under Look under full canopy.
   * @param rate @domain Easing rate toward the target weight (1/s). Default 1.5.
   */
  constructor(
    private readonly open: FoliageLook,
    private readonly under: FoliageLook,
    private readonly rate = 1.5,
  ) {
    this._mix = {
      name: `${open.name} -> ${under.name}`,
      toneMapping: open.toneMapping,
      exposure: open.exposure,
      contrast: open.contrast,
      saturation: open.saturation,
      temperature: open.temperature,
      tint: open.tint,
      lift: [open.lift[0], open.lift[1], open.lift[2]],
      gamma: [open.gamma[0], open.gamma[1], open.gamma[2]],
      gain: [open.gain[0], open.gain[1], open.gain[2]],
    };
  }

  /**
   * Eases toward `target` (canopy coverage x height fade at the camera, [0, 1]) and re-applies the
   * blended look when the weight moved by >= 0.01. `deltaTime` <= 0 snaps. Returns true on apply.
   */
  public update(postProcessing: PostProcessingGroup, target: number, deltaTime: number): boolean {
    const k = deltaTime > 0 ? Math.min(1, deltaTime * this.rate) : 1;
    this.weight += (Math.min(1, Math.max(0, target)) - this.weight) * k;
    if (Math.abs(this.weight - this._applied) < 0.01) return false;
    this._applied = this.weight;
    const a = this.open;
    const b = this.under;
    const w = this.weight;
    const m = this._mix;
    const mix = (p: number, q: number): number => p + (q - p) * w;
    m.exposure = mix(a.exposure, b.exposure);
    m.contrast = mix(a.contrast, b.contrast);
    m.saturation = mix(a.saturation, b.saturation);
    m.temperature = mix(a.temperature, b.temperature);
    m.tint = mix(a.tint, b.tint);
    for (let i = 0; i < 3; i++) {
      m.lift[i] = mix(a.lift[i]!, b.lift[i]!);
      m.gamma[i] = mix(a.gamma[i]!, b.gamma[i]!);
      m.gain[i] = mix(a.gain[i]!, b.gain[i]!);
    }
    applyFoliageLook(postProcessing, m);
    return true;
  }
}
