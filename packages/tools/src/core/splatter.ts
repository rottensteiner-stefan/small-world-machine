/**
 * Headless splatter generator (`SplatterCore`): seed -> RGBA decal, no DOM.
 *
 * Port of the three techniques of `public/tools/splatter-gen.html` (noise-warped circle, metaballs,
 * mud splatter). The page draws through Canvas2D; this core keeps its Perlin noise and geometry
 * recipes and replaces Canvas2D with a tiny coverage rasterizer (4 sub-rows with exact horizontal
 * spans per pixel row) plus a Gaussian blur (`ctx.filter = blur(Npx)` is a Gaussian with sigma = N).
 *
 * WHY a different layout stream than the page: the page derives its blob layout from a chaotic
 * `sin(r * 10000)` hash, whose result flips with a single-ulp difference in `Math.sin`. Node 24 and
 * Chrome 156 already disagree from the 8th draw on, so "same seed" never meant the same layout across
 * engines. Here a seeded integer PRNG (mulberry32) drives the layout, which makes a seed reproducible
 * everywhere; satellite and sub-blob layouts therefore differ from the page for the same seed. The
 * Perlin-warped main blob is identical to the page (checked against Canvas2D with the random parts
 * switched off: no satellites, no sub-blobs).
 *
 * The page stays a standalone tool (ADR 0033): it still runs its own inline Canvas2D version.
 */

import type { RgbaImage } from "./RasterIO.js";

export type SplatterAlgorithm = "noise-warp" | "metaballs" | "mud-splatter";

export const SPLATTER_ALGORITHMS: readonly SplatterAlgorithm[] = [
  "noise-warp",
  "metaballs",
  "mud-splatter",
];

interface SplatterBase {
  /** Edge length of the square output in pixels. */
  size: number;
  /** Main blob radius in pixels (slider "Radius"). */
  radius: number;
  /** Fill colour as `#rrggbb`. */
  color: string;
  /** Any finite number; the same seed reproduces the same decal on every engine. */
  seed: number;
}

export interface NoiseWarpOptions extends SplatterBase {
  algorithm: "noise-warp";
  frequency: number;
  amplitude: number;
  satellites: number;
  satelliteRange: number;
}

export interface MetaballOptions extends SplatterBase {
  algorithm: "metaballs";
  blobCount: number;
  /** Gaussian blur sigma in pixels before thresholding. */
  blur: number;
  /** Alpha cut-off (0-255) of the blurred mask. */
  threshold: number;
  satellites: number;
}

export interface MudSplatterOptions extends SplatterBase {
  algorithm: "mud-splatter";
  blobCount: number;
  warpStrength: number;
  blur: number;
  threshold: number;
  satellites: number;
}

export type SplatterOptions = NoiseWarpOptions | MetaballOptions | MudSplatterOptions;

/** Slider defaults of the page, per algorithm. */
export const SPLATTER_DEFAULTS: {
  [A in SplatterAlgorithm]: Omit<Extract<SplatterOptions, { algorithm: A }>, "algorithm">;
} = {
  "noise-warp": {
    size: 512,
    radius: 120,
    color: "#4a3728",
    seed: 1,
    frequency: 2.5,
    amplitude: 40,
    satellites: 15,
    satelliteRange: 1.5,
  },
  metaballs: {
    size: 512,
    radius: 120,
    color: "#4a3728",
    seed: 1,
    blobCount: 10,
    blur: 20,
    threshold: 110,
    satellites: 8,
  },
  "mud-splatter": {
    size: 512,
    radius: 120,
    color: "#4a3728",
    seed: 1,
    blobCount: 12,
    warpStrength: 25,
    blur: 15,
    threshold: 100,
    satellites: 18,
  },
};

const TWO_PI = Math.PI * 2;
/** Width of the anti-aliased band above the threshold (page constant). */
const SMOOTH_RANGE = 6;
const SUB_ROWS = 4;
const MAX_SIZE = 4096;

// ---------------------------------------------------------------------------------------------
// Seeded noise
// ---------------------------------------------------------------------------------------------

/** mulberry32 over a seed folded to 32 bits; `salt` separates the streams of one seed. */
function seededRandom(seed: number, salt: number): () => number {
  let state = (Math.floor(seed * 1024) ^ Math.imul(salt + 1, 0x9e3779b9)) >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Salt of the layout stream (blob and satellite placement) derived from the seed. */
const STREAM_LAYOUT = 1;

const GRAD_X = [1, -1, 0, 0, 1, -1, 1, -1];
const GRAD_Y = [0, 0, 1, -1, 1, 1, -1, -1];

class Perlin {
  private readonly _permutation = new Uint8Array(512);

  constructor(seedValue: number) {
    const p = new Uint8Array(256);
    // Verbatim from the page, so the warped main blob matches it for the same seed. Unlike the layout
    // stream this hash is not chaotic (the seed only counts up), a 1-ulp `Math.sin` difference moves
    // a value by ~1e-12 and practically never crosses a floor() boundary.
    let seed = seedValue;
    const rand = (): number => {
      const x = Math.sin(seed++) * 10000;
      return x - Math.floor(x);
    };
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = p[i]!;
      p[i] = p[j]!;
      p[j] = tmp;
    }
    for (let i = 0; i < 512; i++) this._permutation[i] = p[i & 255]!;
  }

  public noise(xIn: number, yIn: number): number {
    const perm = this._permutation;
    const X = Math.floor(xIn) & 255;
    const Y = Math.floor(yIn) & 255;
    const x = xIn - Math.floor(xIn);
    const y = yIn - Math.floor(yIn);
    const u = fade(x);
    const v = fade(y);
    const A = perm[X]! + Y;
    const B = perm[X + 1]! + Y;
    return lerp(
      v,
      lerp(u, grad(perm[A]!, x, y), grad(perm[B]!, x - 1, y)),
      lerp(u, grad(perm[A + 1]!, x, y - 1), grad(perm[B + 1]!, x - 1, y - 1)),
    );
  }
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(t: number, a: number, b: number): number {
  return a + t * (b - a);
}

function grad(hash: number, x: number, y: number): number {
  const h = hash & 7;
  return x * GRAD_X[h]! + y * GRAD_Y[h]!;
}

// ---------------------------------------------------------------------------------------------
// Coverage rasterizer
// ---------------------------------------------------------------------------------------------

type Point = readonly [number, number];

class CoverageMask {
  public readonly values: Float32Array;
  private readonly _scratch: Float32Array;
  private readonly _crossings: number[] = [];

  constructor(public readonly size: number) {
    this.values = new Float32Array(size * size);
    this._scratch = new Float32Array(size * size);
  }

  /** Source-over composite of one filled polygon (non-zero winding) into the mask. */
  public fillPolygon(points: readonly Point[]): void {
    const size = this.size;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [, y] of points) {
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const rowStart = Math.max(0, Math.floor(minY));
    const rowEnd = Math.min(size - 1, Math.floor(maxY));
    if (points.length < 3 || rowStart > rowEnd) return;

    const cov = this._scratch;
    cov.fill(0, rowStart * size, (rowEnd + 1) * size);
    const weight = 1 / SUB_ROWS;
    for (let row = rowStart; row <= rowEnd; row++) {
      for (let s = 0; s < SUB_ROWS; s++) {
        this._accumulateSpans(points, row + (s + 0.5) / SUB_ROWS, row * size, weight);
      }
    }
    const values = this.values;
    for (let i = rowStart * size; i < (rowEnd + 1) * size; i++) {
      const c = Math.min(1, cov[i]!);
      values[i] = values[i]! + c - values[i]! * c;
    }
  }

  public fillEllipse(cx: number, cy: number, rx: number, ry: number, rotation: number): void {
    const count = Math.min(256, Math.max(24, Math.ceil(TWO_PI * Math.max(rx, ry))));
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const points: Point[] = [];
    for (let i = 0; i < count; i++) {
      const t = (i / count) * TWO_PI;
      const ex = Math.cos(t) * rx;
      const ey = Math.sin(t) * ry;
      points.push([cx + ex * cos - ey * sin, cy + ex * sin + ey * cos]);
    }
    this.fillPolygon(points);
  }

  private _accumulateSpans(
    points: readonly Point[],
    sampleY: number,
    rowOffset: number,
    weight: number,
  ): void {
    const crossings = this._crossings;
    crossings.length = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i]!;
      const b = points[(i + 1) % points.length]!;
      if (a[1] <= sampleY === b[1] <= sampleY) continue;
      const x = a[0] + ((sampleY - a[1]) / (b[1] - a[1])) * (b[0] - a[0]);
      crossings.push(x, b[1] > a[1] ? 1 : -1);
    }
    // Insertion sort by x (pairs of [x, direction]); crossing lists are short.
    for (let i = 2; i < crossings.length; i += 2) {
      const x = crossings[i]!;
      const dir = crossings[i + 1]!;
      let j = i - 2;
      while (j >= 0 && crossings[j]! > x) {
        crossings[j + 2] = crossings[j]!;
        crossings[j + 3] = crossings[j + 1]!;
        j -= 2;
      }
      crossings[j + 2] = x;
      crossings[j + 3] = dir;
    }
    let winding = 0;
    let spanStart = 0;
    for (let i = 0; i < crossings.length; i += 2) {
      if (winding === 0) spanStart = crossings[i]!;
      winding += crossings[i + 1]!;
      if (winding === 0) this._addSpan(rowOffset, spanStart, crossings[i]!, weight);
    }
  }

  private _addSpan(rowOffset: number, x0In: number, x1In: number, weight: number): void {
    const size = this.size;
    const x0 = Math.max(0, x0In);
    const x1 = Math.min(size, x1In);
    if (x1 <= x0) return;
    const cov = this._scratch;
    const i0 = Math.floor(x0);
    const i1 = Math.min(size - 1, Math.floor(x1));
    if (i0 === i1) {
      cov[rowOffset + i0] = cov[rowOffset + i0]! + (x1 - x0) * weight;
      return;
    }
    cov[rowOffset + i0] = cov[rowOffset + i0]! + (i0 + 1 - x0) * weight;
    for (let i = i0 + 1; i < i1; i++) cov[rowOffset + i] = cov[rowOffset + i]! + weight;
    cov[rowOffset + i1] = cov[rowOffset + i1]! + (x1 - i1) * weight;
  }
}

/** Separable Gaussian blur with transparent edges (matches `ctx.filter = blur(sigma px)`). */
function gaussianBlur(values: Float32Array, size: number, sigma: number): Float32Array {
  if (sigma <= 0) return values;
  const radius = Math.ceil(sigma * 3);
  const kernel = new Float32Array(radius * 2 + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma));
    kernel[i + radius] = w;
    sum += w;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] = kernel[i]! / sum;

  const horizontal = new Float32Array(values.length);
  const result = new Float32Array(values.length);
  for (let y = 0; y < size; y++) {
    const row = y * size;
    for (let x = 0; x < size; x++) {
      let acc = 0;
      const from = Math.max(0, x - radius);
      const to = Math.min(size - 1, x + radius);
      for (let k = from; k <= to; k++) acc += values[row + k]! * kernel[k - x + radius]!;
      horizontal[row + x] = acc;
    }
  }
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) {
      let acc = 0;
      const from = Math.max(0, y - radius);
      const to = Math.min(size - 1, y + radius);
      for (let k = from; k <= to; k++) acc += horizontal[k * size + x]! * kernel[k - y + radius]!;
      result[y * size + x] = acc;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// Techniques
// ---------------------------------------------------------------------------------------------

type Rgb = readonly [number, number, number];

function warpedBlob(
  cx: number,
  cy: number,
  baseRadius: number,
  points: number,
  noiseAt: (nx: number, ny: number) => number,
  amplitude: number,
): Point[] {
  const outline: Point[] = [];
  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * TWO_PI;
    const r = baseRadius + noiseAt(Math.cos(angle), Math.sin(angle)) * amplitude;
    outline.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
  }
  return outline;
}

function drawNoiseWarp(mask: CoverageMask, o: NoiseWarpOptions, perlin: Perlin): void {
  const c = o.size / 2;
  mask.fillPolygon(
    warpedBlob(
      c,
      c,
      o.radius,
      200,
      (nx, ny) => perlin.noise(nx * o.frequency + 1.2, ny * o.frequency + 3.7),
      o.amplitude,
    ),
  );

  const rand = seededRandom(o.seed, STREAM_LAYOUT);
  for (let i = 0; i < o.satellites; i++) {
    const angle = rand() * TWO_PI;
    const distance = o.radius * (1.1 + rand() * (o.satelliteRange - 1.0));
    const satRadius = (3 + rand() * 6) * (o.radius / 120);
    // Stretched radially (scale 1.4 x 0.7) to read as fly-off momentum.
    mask.fillEllipse(
      c + Math.cos(angle) * distance,
      c + Math.sin(angle) * distance,
      satRadius * 1.4,
      satRadius * 0.7,
      angle,
    );
  }
}

function drawMetaballMask(mask: CoverageMask, o: MetaballOptions): void {
  const c = o.size / 2;
  const rand = seededRandom(o.seed, STREAM_LAYOUT);
  mask.fillEllipse(c, c, o.radius * 0.85, o.radius * 0.85, 0);
  for (let i = 0; i < o.blobCount; i++) {
    const angle = rand() * TWO_PI;
    const dist = o.radius * (0.2 + rand() * 0.65);
    const blobRadius = o.radius * (0.2 + rand() * 0.3);
    mask.fillEllipse(
      c + Math.cos(angle) * dist,
      c + Math.sin(angle) * dist,
      blobRadius,
      blobRadius,
      0,
    );
  }
  for (let i = 0; i < o.satellites; i++) {
    const angle = rand() * TWO_PI;
    const dist = o.radius * (1.1 + rand() * 0.5);
    const satRadius = o.radius * (0.05 + rand() * 0.1);
    mask.fillEllipse(
      c + Math.cos(angle) * dist,
      c + Math.sin(angle) * dist,
      satRadius,
      satRadius,
      0,
    );
  }
}

function drawMudMask(mask: CoverageMask, o: MudSplatterOptions, perlin: Perlin): void {
  const c = o.size / 2;
  const rand = seededRandom(o.seed, STREAM_LAYOUT);
  const arc = (x: number, y: number, baseRadius: number, freq: number, offset: number): void => {
    mask.fillPolygon(
      warpedBlob(
        x,
        y,
        baseRadius,
        80,
        (nx, ny) => perlin.noise(nx * freq + offset, ny * freq - offset),
        o.warpStrength,
      ),
    );
  };

  arc(c, c, o.radius * 0.8, 2.0, 1.25);
  for (let i = 0; i < o.blobCount; i++) {
    const angle = rand() * TWO_PI;
    const dist = o.radius * (0.2 + rand() * 0.65);
    const subRadius = o.radius * (0.15 + rand() * 0.25);
    arc(c + Math.cos(angle) * dist, c + Math.sin(angle) * dist, subRadius, 2.5, 12.5 + i * 4.3);
  }
  for (let i = 0; i < o.satellites; i++) {
    const angle = rand() * TWO_PI;
    const dist = o.radius * (1.1 + rand() * 0.7);
    const satRadius = o.radius * (0.04 + rand() * 0.08);
    // Teardrop / flying shape: scale 1.4 x 0.75 along the flight direction.
    mask.fillEllipse(
      c + Math.cos(angle) * dist,
      c + Math.sin(angle) * dist,
      satRadius * 1.4,
      satRadius * 0.75,
      angle,
    );
  }
}

// ---------------------------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------------------------

/** Parses `#rrggbb`; `null` for anything else. */
export function parseSplatterColor(hex: string): Rgb | null {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (m === null) return null;
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}

function toImage(alpha: (i: number) => number, size: number, rgb: Rgb): RgbaImage {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = rgb[0];
    data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2];
    data[i * 4 + 3] = alpha(i);
  }
  return { width: size, height: size, data };
}

/** The page's threshold pass: hard cut at `threshold`, a `SMOOTH_RANGE`-wide soft ramp above it. */
function thresholdedAlpha(blurred: Float32Array, threshold: number): (i: number) => number {
  return (i: number): number => {
    const a = Math.round(blurred[i]! * 255);
    if (a <= threshold) return 0;
    if (a < threshold + SMOOTH_RANGE) return Math.floor(((a - threshold) / SMOOTH_RANGE) * 255);
    return 255;
  };
}

function assertOptions(o: SplatterOptions): Rgb {
  if (!Number.isInteger(o.size) || o.size < 1 || o.size > MAX_SIZE) {
    throw new Error(`splatter: size must be an integer between 1 and ${MAX_SIZE}`);
  }
  if (!Number.isFinite(o.seed)) throw new Error("splatter: seed must be a finite number");
  const rgb = parseSplatterColor(o.color);
  if (rgb === null) throw new Error(`splatter: color must be #rrggbb, got "${o.color}"`);
  return rgb;
}

/**
 * Generates one splatter decal as an RGBA image (transparent background, `color` blob).
 * Pixels outside the blob keep the blob colour at alpha 0, so bilinear filtering does not fringe dark.
 */
export function generateSplatter(options: SplatterOptions): RgbaImage {
  const rgb = assertOptions(options);
  const size = options.size;
  const mask = new CoverageMask(size);

  switch (options.algorithm) {
    case "noise-warp":
      drawNoiseWarp(mask, options, new Perlin(options.seed));
      return toImage((i) => Math.round(Math.min(1, mask.values[i]!) * 255), size, rgb);
    case "metaballs":
      drawMetaballMask(mask, options);
      return toImage(
        thresholdedAlpha(gaussianBlur(mask.values, size, options.blur), options.threshold),
        size,
        rgb,
      );
    case "mud-splatter":
      drawMudMask(mask, options, new Perlin(options.seed));
      return toImage(
        thresholdedAlpha(gaussianBlur(mask.values, size, options.blur), options.threshold),
        size,
        rgb,
      );
  }
}
