import { PostProcessingElement } from "../PostProcessingElement.js";
import { PostProcessingEffectType } from "../../../enums/index.js";

const MM_TO_M = 0.001;

/**
 * Thin-lens circle-of-confusion scale in pixels: the CoC diameter an object at infinity projects
 * onto the sensor, converted from sensor millimetres to viewport pixels.
 *
 * Derived from c(d) = A·f·|d − d_f| / (d·(d_f − f)) with A = f/N, rewritten as
 * c(d) = S·|1 − d_f/d| where S = A·f / (d_f − f). The shaders only need S and d_f.
 *
 * @param focalLengthMm Lens focal length f in millimetres.
 * @param fStop Aperture f-number N.
 * @param focusDistance Focus distance d_f in metres. Clamped to just beyond f -- a thin lens
 *   cannot focus closer than its focal length.
 * @param sensorHeightMm Sensor height in millimetres (maps sensor space onto the viewport height).
 * @param viewportHeightPx Viewport height in pixels.
 * @returns S in pixels (always >= 0).
 */
export function computeCocScalePx(
  focalLengthMm: number,
  fStop: number,
  focusDistance: number,
  sensorHeightMm: number,
  viewportHeightPx: number,
): number {
  const f = focalLengthMm * MM_TO_M;
  const aperture = f / Math.max(fStop, 1e-3);
  const focusBeyondLens = Math.max(focusDistance - f, 1e-4);
  const cocAtInfinity = (aperture * f) / focusBeyondLens;
  return (cocAtInfinity / Math.max(sensorHeightMm * MM_TO_M, 1e-6)) * viewportHeightPx;
}

/**
 * Signed thin-lens circle of confusion in pixels for a surface at linear view depth `depth`:
 * negative in front of the focus plane (near field), positive behind it (far field).
 * Same formula the shaders evaluate per pixel.
 *
 * @param depth Linear view depth d in metres (> 0).
 * @param focusDistance Focus distance d_f in metres.
 * @param cocScalePx S from {@link computeCocScalePx}.
 */
export function computeSignedCocPx(
  depth: number,
  focusDistance: number,
  cocScalePx: number,
): number {
  return cocScalePx * (1 - focusDistance / Math.max(depth, 1e-6));
}

/**
 * Physically based (thin-lens) depth of field.
 *
 * Per API tier:
 * - WebGPU: half-res CoC prefilter -> 64-tap golden-angle (Vogel) scatter-as-gather bokeh with
 *   sample-CoC weighting (near field bleeds over sharp regions, background never bleeds forward)
 *   -> full-res composite with CoC-aware bilateral upsample.
 * - WebGL2: same algorithm and passes with 32 gather taps.
 * - WebGL1: no opaque-depth capture exists on this tier (see `WebGL1Renderer.copyToOpaqueDepthTexture`),
 *   so the CoC cannot be derived from depth. Falls back to a screen-space tilt-shift: a horizontal
 *   focus band at `focusScreenY`, blurring towards the top/bottom with the lens' far-field CoC
 *   (S, clamped to `maxCocRatio`) -- the same lens parameters still drive the blur strength.
 *
 * Runs on the HDR scene colour after TAA / motion trail and before bloom and the tone-mapping uber pass.
 * Opt-in post-processing effect, off by default.
 */
export class DepthOfFieldElement extends PostProcessingElement {
  public readonly type = PostProcessingEffectType.DEPTH_OF_FIELD;

  /** Off by default -- opt-in post-processing effect. */
  public override enabled: boolean = false;

  /** Distance from the camera to the plane in perfect focus, in metres (default: 2.0). */
  public focusDistance: number = 2.0;

  /** Lens focal length in millimetres (default: 50). Longer lenses produce a shallower depth of field. */
  public focalLength: number = 50;

  /** Aperture f-number N (default: 2.0). Smaller values open the aperture and increase the blur. */
  public fStop: number = 2.0;

  /**
   * Sensor height in millimetres (default: 24, full-frame landscape). Maps the physical CoC on the
   * sensor to viewport pixels; a smaller sensor makes the same CoC cover more pixels.
   */
  public sensorHeight: number = 24;

  /**
   * Upper bound of the CoC diameter as a fraction of the viewport height (default: 0.015, i.e.
   * ~16 px at 1080p). Caps the gather radius and therefore the cost. A fraction rather than pixels
   * so the look does not change with resolution or device pixel ratio (and so between tiers that
   * render at different buffer sizes).
   */
  public maxCocRatio: number = 0.015;

  /**
   * WebGL1 only: vertical screen position of the tilt-shift focus band, 0 = bottom, 1 = top
   * (default: 0.5). Ignored on WebGL2/WebGPU, which focus physically at `focusDistance`.
   */
  public focusScreenY: number = 0.5;

  /**
   * Thin-lens CoC scale S in pixels for the given viewport height (see {@link computeCocScalePx}).
   * @param viewportHeightPx Height of the render target in pixels.
   */
  public cocScalePx(viewportHeightPx: number): number {
    return computeCocScalePx(
      this.focalLength,
      this.fStop,
      this.focusDistance,
      this.sensorHeight,
      viewportHeightPx,
    );
  }

  /**
   * CoC diameter cap in pixels for the given viewport height (see {@link maxCocRatio}).
   * @param viewportHeightPx Height of the render target in pixels.
   */
  public maxCocPx(viewportHeightPx: number): number {
    return this.maxCocRatio * viewportHeightPx;
  }

  public override structuralKey(): string {
    return `${this.enabled ? 1 : 0}`;
  }
}
