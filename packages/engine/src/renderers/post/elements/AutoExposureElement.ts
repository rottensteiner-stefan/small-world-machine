import { PostProcessingElement } from "../PostProcessingElement.js";
import { PostProcessingEffectType } from "../../../enums/index.js";

/** @fixed Middle-grey key the average scene luminance is mapped to (photographic 18 %). */
export const AUTO_EXPOSURE_KEY: number = 0.18;
/** @fixed Side length of the log-luminance grid the pass reduces the frame to. */
export const AUTO_EXPOSURE_GRID: number = 16;

/**
 * Eye adaptation (ADR 0061): the average log luminance of the HDR frame (center-weighted) sets a
 * target exposure that the image approaches over time — brightening slowly in the dark, darkening
 * fast in bright light, like the eye. The result multiplies `ToneMappingElement.exposure`, which
 * stays the artistic bias. Measured and adapted entirely on the GPU (no readback).
 *
 * Tiers: WebGPU + WebGL2 (needs float render targets, i.e. `EXT_color_buffer_float`); WebGL1 and
 * WebGL2 without float targets keep the static exposure (their post input is display-referred).
 */
export class AutoExposureElement extends PostProcessingElement {
  public readonly type = PostProcessingEffectType.AUTO_EXPOSURE;
  public override enabled: boolean = false;

  /** @domain Lowest auto exposure in EV stops relative to 1.0 (limits brightening in the dark). */
  public minEv: number = -2;
  /** @domain Highest auto exposure in EV stops relative to 1.0 (limits darkening in bright light). */
  public maxEv: number = 3;
  /** @domain Constant EV offset added to the metered target (+1 = one stop brighter). */
  public compensationEv: number = 0;
  /** @domain Adaptation rate in 1/s when the scene got darker (exposure rises; the eye is slow here). */
  public speedDark: number = 1.2;
  /** @domain Adaptation rate in 1/s when the scene got brighter (exposure falls; fast). */
  public speedBright: number = 3.5;
  /** @domain Center weighting of the metering, 0 = flat average .. 1 = strong center spot. */
  public centerWeight: number = 0.6;
}

/**
 * CPU mirror of the adapt shader (`AutoExposureAdapt.frag.*`): one adaptation step in EV space.
 * @param prevEv exposure of the previous frame in EV stops
 * @param avgLog2Lum center-weighted mean of log2(luminance) of the frame
 * @param deltaTime seconds since the previous step
 * @param snap true on the first frame or after a camera cut: jump straight to the target
 * @returns the new exposure in EV stops (multiplier = 2^ev)
 */
export function autoExposureStep(
  prevEv: number,
  avgLog2Lum: number,
  deltaTime: number,
  element: AutoExposureElement,
  snap: boolean,
): number {
  const target = Math.min(
    Math.max(Math.log2(AUTO_EXPOSURE_KEY) - avgLog2Lum + element.compensationEv, element.minEv),
    element.maxEv,
  );
  if (snap) return target;
  const rate = target > prevEv ? element.speedDark : element.speedBright;
  return prevEv + (target - prevEv) * (1 - Math.exp(-Math.max(deltaTime, 0) * rate));
}
