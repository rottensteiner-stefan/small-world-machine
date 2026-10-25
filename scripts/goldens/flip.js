// Deterministic in-repo LDR reference metric for the golden drifter, following the FLIP core
// (Andersson et al., "FLIP: A Difference Evaluator for Alternating Images" 2020). This file is a
// pure-PNG-arithmetic CPU port of the four stages FLIP needs to reject sub-pixel/TAA jitter that a
// naive per-pixel metric (pixelmatch) flags as drift:
//
//   1. opponent color space transform (sRGB -> linear -> XYZ -> YCxCz, exact FLIP constants),
//   2. CSF filtering (pixels-per-degree dependent: the filter nulls the spatial frequencies above
//      the CSF cutoff, so a 1px alternating TAA pattern averages to ~0 while multi-pixel structure
//      is preserved),
//   3. feature/edge analysis on the *filtered* images (Sobel structure maps),
//   4. power combination  dE = (dEc)^(1 - dEf)  per pixel, aggregated to a mean score in [0, 1].
//
// It is NOT a bit-exact port of the reference implementation (that is a GPU filter-pool); it is a
// documented, deterministic approximation grounded on the same stages and constants, used ONLY
// behind `compare.js --metric flip` (default remains pixelmatch). All arithmetic is Float64 and
// platform-deterministic; the fixture harness in test-flip.js asserts order-of-magnitude behavior
// (jitter suppressed, structural/colour drift flagged), never exact equality.
//
//   node scripts/goldens/flip.js <reference.png> <test.png> [--ppd <n>]
//   → prints mean / max / p95 score, writes a flip map PNG to --map-out if given.

import fs from "fs";
import { PNG } from "pngjs";

// FLIP color constants (src/cpp/FLIP.h, D65). The linear->XYZ matrix and the per-channel D65
// illumination normalizers are imported verbatim so the opponent transform matches FLIP's.
const INV_ILLUMINANT = [1.052156925, 1.0, 0.91835767];

const M_LIN2XYZ = [
  [10135552.0 / 24577794.0, 8788810.0 / 24577794.0, 4435075.0 / 24577794.0],
  [2613072.0 / 12288897.0, 8788810.0 / 12288897.0, 887015.0 / 12288897.0],
  [1425312.0 / 73733382.0, 8788810.0 / 73733382.0, 70074185.0 / 73733382.0],
];

// CSF null anchor (cycles per degree): above this the human visual system cannot resolve periodic
// structure, so sub-pixel/1px TAA alternation (which maps to ~the image Nyquist, i.e. >= this for
// the assumed viewing conditions) must be invisible to the metric.
const CSF_NULL_CPD = 60;
// Scales the null into a Gaussian low-pass sigma in pixels: at the default ppd (67) this yields
// sigma ~= 1.34 px, i.e. a filter whose passband ends well below 1px structure.
const SIGMA_NORM = 1.5;
const MAX_SIGMA_PX = 2.0;
const MIN_SIGMA_PX = 0.75;
// Chromatic channels have lower visual acuity; model this by filtering them more aggressively.
const CHROMA_SIGMA_FACTOR = 2.0;
const MAX_CHROMA_SIGMA_PX = 3.0;

/** Default pixels-per-degree assumption (typical ~1080p monitor at viewing distance). */
export const DEFAULT_PIXELS_PER_DEGREE = 67;

/** Standard sRGB EOTF (the exact inverse FLIP applies before the linear RGB -> XYZ step). */
export function sRGBToLinear(c) {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** FLIP's linear RGB -> XYZ (D65) matrix applied to normalized linear RGB channels. */
export function linearRGBToXYZ(r, g, b) {
  const x = M_LIN2XYZ[0][0] * r + M_LIN2XYZ[0][1] * g + M_LIN2XYZ[0][2] * b;
  const y = M_LIN2XYZ[1][0] * r + M_LIN2XYZ[1][1] * g + M_LIN2XYZ[1][2] * b;
  const z = M_LIN2XYZ[2][0] * r + M_LIN2XYZ[2][1] * g + M_LIN2XYZ[2][2] * b;
  return [x, y, z];
}

/** FLIP's XYZ -> YCxCz opponent transform (D65-illuminant normalized, exact constants). */
export function xyzToYCxCz(x, y, z) {
  const Y = 116.0 * y * INV_ILLUMINANT[1] - 16.0;
  const Cx = 500.0 * (x * INV_ILLUMINANT[0] - y * INV_ILLUMINANT[1]);
  const Cz = 200.0 * (y * INV_ILLUMINANT[1] - z * INV_ILLUMINANT[2]);
  return [Y, Cx, Cz];
}

/**
 * Converts RGBA pixel data (pngjs `data` buffer, byte per channel) into a Float64Array of
 * width*height*3 YCxCz opponent values. Ignores alpha (golden frames are opaque).
 * @returns {Float64Array}
 */
function opponentBuffer(width, height, data) {
  const out = new Float64Array(width * height * 3);
  const n = width * height;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const [x, y, z] = linearRGBToXYZ(sRGBToLinear(data[o]), sRGBToLinear(data[o + 1]), sRGBToLinear(data[o + 2]));
    const [Y, Cx, Cz] = xyzToYCxCz(x, y, z);
    const d = i * 3;
    out[d] = Y;
    out[d + 1] = Cx;
    out[d + 2] = Cz;
  }
  return out;
}

/**
 * CSF nulling sigma in pixels for the assumed pixels-per-degree. Higher PPD (finer displayed
 * pixels) lets the eye resolve finer structure, so the null moves to a smaller pixel radius.
 * @param {number} pixelsPerDegree
 * @returns {number}
 */
export function csfSigmaPx(pixelsPerDegree) {
  const sigma = (CSF_NULL_CPD / pixelsPerDegree) * SIGMA_NORM;
  return Math.min(MAX_SIGMA_PX, Math.max(MIN_SIGMA_PX, sigma));
}

/**
 * Symmetric 1D Gaussian kernel of radius `r` as Float64 weights (deterministic; no RNG).
 */
function gaussianKernel(radius) {
  const sigma = (radius * 2 + 1) / 6;
  const w = new Float64Array(radius * 2 + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    w[i + radius] = v;
    sum += v;
  }
  for (let i = 0; i < w.length; i++) w[i] /= sum;
  return w;
}

/**
 * Separable Gaussian low-pass on the channel plane `src` (stride `stride`, `channelsPerPixel`==3.
 * Layout of `src` is [p0c0,p0c1,p0c2, p1c0,...]; `slot` selects the channel index (0..2). Replicate
 * edges (documented, deterministic). Returns a new Float64Array of the same layout.
 */
function blurChannel(src, width, height, planeStride, slot, sigma) {
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = gaussianKernel(radius);
  const padded = new Float64Array(planeStride);
  const tmp = new Float64Array(planeStride);
  const kR = kernel.length;
  const half = radius;

  // Horizontal pass.
  for (let y = 0; y < height; y++) {
    const rowBase = y * width;
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = 0; k < kR; k++) {
        const dx = k - half;
        const sx = Math.min(width - 1, Math.max(0, x + dx));
        acc += src[(rowBase + sx) * 3 + slot] * kernel[k];
      }
      padded[(rowBase + x) * 3 + slot] = acc;
    }
  }
  // Vertical pass.
  for (let y = 0; y < height; y++) {
    const rowBase = y * width;
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = 0; k < kR; k++) {
        const dy = k - half;
        const sy = Math.min(height - 1, Math.max(0, y + dy));
        acc += padded[(sy * width + x) * 3 + slot] * kernel[k];
      }
      tmp[(rowBase + x) * 3 + slot] = acc;
    }
  }
  return tmp;
}

/**
 * Sobel structure (edge) magnitude for one channel plane of an YCxCz buffer.
 * @returns {Float64Array} per-pixel gradient magnitude.
 */
function sobelGradient(src, width, height, slot) {
  const out = new Float64Array(width * height);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const r = y * width + x;
      const p = (i) => src[i * 3 + slot];
      const gx =
        p(r - width - 1) - p(r - width + 1) +
        2 * (p(r - 1) - p(r + 1)) +
        p(r + width - 1) - p(r + width + 1);
      const gy =
        p(r - width - 1) + 2 * (p(r - width)) + p(r - width + 1) -
        (p(r + width - 1) + 2 * (p(r + width)) + p(r + width + 1));
      out[r] = 0.125 * Math.sqrt(gx * gx + gy * gy);
    }
  }
  return out;
}

/** Reference scaling so a full L* delta maps to ~1.0 (CIE JND-scaled color distance proxy). */
const COL_NORM = 100.0;
/** Feature exponent weight (FLIP uses the feature difference to gate the colour difference). */
const FEATURE_ALPHA = 1.0;

/**
 * Computes the LDR reference score between two same-size RGBA images.
 *
 * @param {object} refPng pngjs-parsed reference PNG (fields .width/.height/.data).
 * @param {object} testPng pngjs-parsed test PNG.
 * @param {{ pixelsPerDegree?: number }} [opts]
 * @returns {{ score: number, mean: number, max: number, p95: number, map: Float32Array|null }}
 *   `score` is the mean per-pixel perceptual error in [0, 1]. `map` is the per-pixel error map
 *   (Float32, width*height) or null when not requested.
 */
export function flipScore(refPng, testPng, opts = {}) {
  const { width, height } = refPng;
  if (testPng.width !== width || testPng.height !== height) {
    throw new Error(`flipScore: size mismatch (${width}x${height} vs ${testPng.width}x${testPng.height})`);
  }
  const ppd = Number.isFinite(opts.pixelsPerDegree) ? opts.pixelsPerDegree : DEFAULT_PIXELS_PER_DEGREE;
  const sigma = csfSigmaPx(ppd);
  const cSigma = Math.min(MAX_CHROMA_SIGMA_PX, sigma * CHROMA_SIGMA_FACTOR);

  // Stage 1: opponent color transform.
  const refBuf = opponentBuffer(width, height, refPng.data);
  const testBuf = opponentBuffer(width, height, testPng.data);

  // Stage 2: CSF filtering (per channel). Only the scrambled/structurally-meaningful frequencies
  // survive; a 1px TAA alternation is nulled.
  const planeStride = width * height * 3;
  const refF = new Float64Array(planeStride);
  const testF = new Float64Array(planeStride);
  // Luminance lane and the two chromatic lanes with their own (lower-acuity) sigma.
  const lum = blurChannel(refBuf, width, height, planeStride, 0, sigma);
  const c1 = blurChannel(refBuf, width, height, planeStride, 1, cSigma);
  const c2 = blurChannel(refBuf, width, height, planeStride, 2, cSigma);
  refF.set(lum);
  for (let i = 0; i < width * height; i++) {
    refF[i * 3 + 1] = c1[i * 3 + 1];
    refF[i * 3 + 2] = c2[i * 3 + 2];
  }
  const lumT = blurChannel(testBuf, width, height, planeStride, 0, sigma);
  const c1T = blurChannel(testBuf, width, height, planeStride, 1, cSigma);
  const c2T = blurChannel(testBuf, width, height, planeStride, 2, cSigma);
  testF.set(lumT);
  for (let i = 0; i < width * height; i++) {
    testF[i * 3 + 1] = c1T[i * 3 + 1];
    testF[i * 3 + 2] = c2T[i * 3 + 2];
  }

  // Stage 3: feature/edge analysis on the filtered images (luminance + chroma saliency).
  const gRef = sobelGradient(refF, width, height, 0);
  const gTest = sobelGradient(testF, width, height, 0);
  const gcRef = sobelGradient(refF, width, height, 1);
  const gcTest = sobelGradient(testF, width, height, 1);
  const gc2Ref = sobelGradient(refF, width, height, 2);
  const gc2Test = sobelGradient(testF, width, height, 2);

  const n = width * height;
  const map = new Float32Array(n);
  // Saturating structure normalization (gradient magnitudes beyond this count as "edges present").
  const FEAT_NORM = 200.0;
  let sum = 0;
  let max = 0;
  for (let i = 0; i < n; i++) {
    const fRef = (gRef[i] + 0.5 * (gcRef[i] + gc2Ref[i])) / FEAT_NORM;
    const fTest = (gTest[i] + 0.5 * (gcTest[i] + gc2Test[i])) / FEAT_NORM;
    const dEf = 1.0 - Math.exp(-Math.abs(fTest - fRef));

    const dY = testF[i * 3] - refF[i * 3];
    const dCx = testF[i * 3 + 1] - refF[i * 3 + 1];
    const dCz = testF[i * 3 + 2] - refF[i * 3 + 2];
    const dEc = Math.min(1.0, Math.sqrt(dY * dY + dCx * dCx + dCz * dCz) / COL_NORM);

    // Stage 4: power combination dE = (dEc)^(1 - FEATURE_ALPHA*dEf): a structural difference (dEf
    // large) forces the error high; a pure, low-frequency colour difference passes at dEc.
    let dE = 0;
    if (dEc > 0) {
      dE = Math.pow(dEc, 1.0 - FEATURE_ALPHA * dEf);
    }
    map[i] = dE;
    sum += dE;
    if (dE > max) max = dE;
  }

  const mean = sum / n;
  const sorted = Float32Array.from(map);
  sorted.sort();
  const p95 = sorted[Math.floor(0.95 * (n - 1))];

  return { score: mean, mean, max, p95, map };
}

function parseArgs(argv) {
  const args = { ref: null, test: null, ppd: DEFAULT_PIXELS_PER_DEGREE, out: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--ppd") args.ppd = Number(argv[++i]);
    else if (argv[i] === "--map-out") args.out = argv[++i];
    else if (!args.ref) args.ref = argv[i];
    else if (!args.test) args.test = argv[i];
    else throw new Error(`Unexpected argument: ${argv[i]}`);
  }
  if (!args.ref || !args.test) throw new Error("usage: flip.js <reference.png> <test.png> [--ppd <n>] [--map-out <png>]");
  return args;
}

// CLI entry (also used manually for quick numeric checks; fixtures live in test-flip.js).
// Compare against the exact basename so importing this module from test-flip.js never triggers it.
const IS_CLI = process.argv[1] && process.argv[1].split(/[\\/]/).pop() === "flip.js";
if (IS_CLI) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const refPng = PNG.sync.read(fs.readFileSync(args.ref));
    const testPng = PNG.sync.read(fs.readFileSync(args.test));
    const result = flipScore(refPng, testPng, { pixelsPerDegree: args.ppd });
    console.log(
      `flip: mean ${result.mean.toFixed(6)}  max ${result.max.toFixed(6)}  p95 ${result.p95.toFixed(6)}` +
        `  (ppd ${args.ppd})`,
    );
    if (args.out) {
      const w = refPng.width;
      const h = refPng.height;
      const map = new PNG({ width: w, height: h });
      for (let i = 0; i < w * h; i++) {
        const v = Math.round(255 * result.map[i]);
        map.data[i * 4] = v;
        map.data[i * 4 + 1] = v;
        map.data[i * 4 + 2] = v;
        map.data[i * 4 + 3] = 255;
      }
      fs.writeFileSync(args.out, PNG.sync.write(map));
    }
    process.exit(0);
  } catch (err) {
    console.error(`flip.js: ${err.message}`);
    process.exit(1);
  }
}
