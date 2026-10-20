/**
 * StrokeRaster — pure, DOM-free stroke mathematics for the ImpastoStrokeMaterial studio.
 *
 * The drawing model separates the deterministic math (pressure → brush state, segment
 * interpolation, per-splat payload) from the canvas rasterization. Everything with an
 * `// pure` marker is unit-testable in Node without a browser.
 */

export interface StrokePoint {
  x: number;
  y: number;
}

export interface BrushState {
  /** Brush radius in canvas pixels. */
  radius: number;
  /** Impasto relief power in 0..1 (drives normal perturbation). */
  relief: number;
  /** Edge-lift emphasis in 0..1 (drives the raised rim along a stroke). */
  lift: number;
}

export interface BrushSplat {
  /** Position in the paint canvas (image space, y grows downward). */
  x: number;
  y: number;
  radius: number;
  relief: number;
  lift: number;
  /** 0..1 encoded stroke direction in plane-UV space (u, v). See buildStrokeSplats. */
  dirU01: number;
  dirV01: number;
  /** Coverage contribution, 0..1. */
  coverage: number;
}

export interface StrokeSegmentInput {
  from: StrokePoint;
  to: StrokePoint;
  pressure: number;
  baseRadius: number;
  maxRadius: number;
  /** Max allowed step between interpolated splats, in canvas pixels. */
  maxStepPx: number;
  /** Paint color as a `#rrggbb` hex string (used by the rasterizer, not the math). */
  colorHex: string;
  /** Paint canvas dimensions in pixels; needed to normalize the direction vector. */
  canvasWidth: number;
  canvasHeight: number;
}

const RELIEF_EXPONENT = 2.0;
const RADIUS_EXPONENT = 1.4;
const COVERAGE_CEILING = 0.9;

/**
 * Maps stylus/mouse pressure (0..1) to a brush state. Non-linear on purpose: light touches stay
 * fine and low, hard presses grow the stroke AND raise its relief.
 * // pure
 */
export function pressureToBrush(
  pressure: number,
  baseRadius: number,
  maxRadius: number,
): BrushState {
  const p = Math.min(1, Math.max(0, pressure));
  const radius = baseRadius + (maxRadius - baseRadius) * Math.pow(p, RADIUS_EXPONENT);
  const relief = Math.pow(p, RELIEF_EXPONENT);
  const lift = p;
  return { radius, relief, lift };
}

/**
 * Distance-stamped interpolation between two stroke endpoints. Each returned point is a center
 * for one brush splat; the first splat covers `from`, the last covers `to`. Returns at least one
 * splat (the destination). // pure
 */
export function interpolateStrokeSteps(
  from: StrokePoint,
  to: StrokePoint,
  maxStepPx: number,
): StrokePoint[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (!Number.isFinite(dist) || dist <= maxStepPx) {
    return [{ x: to.x, y: to.y }];
  }
  const count = Math.min(256, Math.ceil(dist / maxStepPx));
  const out: StrokePoint[] = new Array(count);
  for (let i = 1; i <= count; i++) {
    const t = i / count;
    out[i - 1] = { x: from.x + dx * t, y: from.y + dy * t };
  }
  return out;
}

/**
 * Builds the full per-splat payload for a stroke segment, one splat per interpolated step.
 *
 * The direction is normalized into plane-UV space: a positive canvas-x delta grows `u`, a
 * positive canvas-y delta (pointing down in image space) shrinks `v` (the engine Plane maps
 * v = 1 to the top of the geometry). Encoding happens here so the shaders stay branch-free and
 * orientation-consistent on every tier.
 * // pure (colorHex/canvasWidth/canvasHeight only feed the rasterizer payload)
 */
export function buildStrokeSplats(input: StrokeSegmentInput): BrushSplat[] {
  const brush = pressureToBrush(input.pressure, input.baseRadius, input.maxRadius);
  const steps = interpolateStrokeSteps(input.from, input.to, input.maxStepPx);

  const dx = input.to.x - input.from.x;
  const dy = input.to.y - input.from.y;
  const len = Math.hypot(dx, dy);
  let dirU01 = 0.5;
  let dirV01 = 0.5;
  if (len > 1e-4) {
    // Plane-UV direction: u grows with canvas x, v shrinks with canvas y.
    const u = dx / input.canvasWidth;
    const v = -dy / input.canvasHeight;
    const inv = 1 / Math.hypot(u, v);
    dirU01 = u * inv * 0.5 + 0.5;
    dirV01 = v * inv * 0.5 + 0.5;
  }

  const coverage = Math.max(0, Math.min(COVERAGE_CEILING, brush.lift));
  return steps.map((p) => ({
    x: p.x,
    y: p.y,
    radius: brush.radius,
    relief: brush.relief,
    lift: brush.lift,
    dirU01,
    dirV01,
    coverage,
  }));
}

// ---------------------------------------------------------------------------
// Canvas rasterizers (browser-only; exercised end-to-end by the live gate).
// ---------------------------------------------------------------------------

export interface SplatColorFill {
  colorHex: string;
}

/**
 * Paints one impasto splat into the color/coverage canvas. Painted with `source-over` in the
 * engine upload orientation, so overlapping strokes accumulate coverage up to the ceiling.
 */
export function rasterizeSplatColor(
  ctx: CanvasRenderingContext2D,
  splat: BrushSplat,
  colorHex: string,
): void {
  const r = Math.max(0.5, splat.radius);
  const grad = ctx.createRadialGradient(splat.x, splat.y, 0, splat.x, splat.y, r);
  const alpha = Math.max(0.05, Math.min(1, splat.coverage));
  grad.addColorStop(0, hexWithAlpha(colorHex, alpha));
  grad.addColorStop(0.65, hexWithAlpha(colorHex, alpha * 0.75));
  grad.addColorStop(1, hexWithAlpha(colorHex, 0));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(splat.x, splat.y, r, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Writes one impasto splat's direction/pressure into the direction canvas. Alpha carries the
 * pressure so overlapping strokes keep the most recent one (source-over). B carries the lift.
 */
export function rasterizeSplatDirection(ctx: CanvasRenderingContext2D, splat: BrushSplat): void {
  const r = Math.max(0.5, splat.radius);
  const rByte = Math.round(Math.min(255, Math.max(0, splat.dirU01 * 255)));
  const gByte = Math.round(Math.min(255, Math.max(0, splat.dirV01 * 255)));
  const bByte = Math.round(Math.min(255, Math.max(0, splat.lift * 255)));
  const aByte = Math.round(Math.min(255, Math.max(0, splat.coverage * 255)));
  ctx.fillStyle = `rgba(${rByte}, ${gByte}, ${bByte}, ${aByte / 255})`;
  ctx.beginPath();
  ctx.arc(splat.x, splat.y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** Helper to expand `#rrggbb` into an 8-digit rgba color string. */
export function hexWithAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return `rgba(255, 255, 255, ${Math.min(1, Math.max(0, alpha))})`;
  const a = Math.min(1, Math.max(0, alpha));
  return `#${m[1]}${Math.round(a * 255)
    .toString(16)
    .padStart(2, "0")}`;
}
