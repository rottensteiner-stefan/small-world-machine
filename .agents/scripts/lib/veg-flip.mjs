// FLIP-style perceptual image difference (package-internal ESM, zero runtime deps besides pngjs).
//
// Source: Andersson, P., Nilsson, J., Åkesson, T., Akenine-Möller, T. (2020). "FLIP: A Difference
// Evaluator for Alternating Images". Reconstructed 1:1 in structure and constants from the public
// reference implementation `nvidia-flip-cpp` (NVIDIA licence, see below): sRGB -> linear ->
// XYZ(D65) -> opponent-lightness YCxCz; the color pipeline (spatial CSF pre-filter with the
// published per-channel Gaussian kernels, inverse transform with clamping, CIELab, Hunt
// adjustment, HyAB difference, published piecewise error remapping with the max-color-distance
// normalization) and the feature pipeline (achromatic extraction, edge + point detection filters
// with the published kernels, `pow(cdiff, 1-fdiff)` combination).
//
// Deviation from the reference (documented, tested): the reference's spatial/binomial pooling over
// a FOV-derived degradation is replaced by a document-frequency-weighted mean plus plain
// percentiles of the error map. Numerical lock-step validation against the NVIDIA reference binary
// is an open follow-up (see docs/research/vegetation-flip-<date>.md).
//
// API: `computeFlip(pngRef, pngTest, opts) -> { mean, p50, p95, min, max, meanPixelsAffected }`.
// Error values are in [0,1]: 0 = indistinguishable, 1 = maximally different.

import { PNG } from "pngjs";

// FLIP parameters (reference constants; gqc/gpc/gpt/gw/gqf in nvidia-flip-cpp).
const GQC = 0.7; // exponent applied to the color distance before referencing
const GPC = 0.4; // fraction of the max color distance used as the remap knee
const GPT = 0.95; // remap knee plateau value
const GW = 0.082; // feature-detector bandwidth (beta, degrees of visual angle)
const GQF = 0.5; // feature-difference exponent
const FLIP_SQRT2_INV = 1 / Math.SQRT2;

// D65 reference illuminant (reference constant).
const REF_ILLUM = [0.950428545377181, 1.0, 1.088900370798128];

/** Linear-RGB (D65) -> XYZ matrix (reference constants). */
const RGB_TO_XYZ = [
  10135552 / 24577794, 8788810 / 24577794, 4435075 / 24577794,
  2613072 / 12288897, 8788810 / 12288897, 887015 / 12288897,
  1425312 / 73733382, 8788810 / 73733382, 70074185 / 73733382,
];

/** XYZ -> linear-RGB (D65) matrix (reference constants). */
const XYZ_TO_RGB = [
  3.241003232976358, -1.537398969488785, -0.498615881996363,
  -0.969224252202516, 1.875929983695176, 0.041554226340085,
  0.055639419851975, -0.20401120612391, 1.057148977187533,
];

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Default pixels-per-degree (reference monitor: 0.7 m viewing distance, 0.7 m wide, 3840 px). */
export function defaultPpd() {
  return ((0.7 * 3840) / 0.7) * (Math.PI / 180);
}

function decodePng(buffer) {
  const png = PNG.sync.read(Buffer.from(buffer));
  const { data, width, height } = png;
  const count = width * height;
  const rgb = new Float32Array(count * 3);
  for (let i = 0, o = 0; i < data.length; i += 4, o += 3) {
    rgb[o] = data[i] / 255;
    rgb[o + 1] = data[i + 1] / 255;
    rgb[o + 2] = data[i + 2] / 255;
  }
  return { rgb, width, height };
}

/** sRGB -> linear -> XYZ -> YCxCz (opponent-lightness space); writes into `dst`. */
function toOpponent(dst, src) {
  for (let i = 0; i < src.length; i += 3) {
    const r = srgbToLinear(src[i]);
    const g = srgbToLinear(src[i + 1]);
    const b = srgbToLinear(src[i + 2]);
    const x = RGB_TO_XYZ[0] * r + RGB_TO_XYZ[1] * g + RGB_TO_XYZ[2] * b;
    const y = RGB_TO_XYZ[3] * r + RGB_TO_XYZ[4] * g + RGB_TO_XYZ[5] * b;
    const z = RGB_TO_XYZ[6] * r + RGB_TO_XYZ[7] * g + RGB_TO_XYZ[8] * b;
    const xn = x / REF_ILLUM[0];
    const yn = y / REF_ILLUM[1];
    const zn = z / REF_ILLUM[2];
    dst[i] = 116 * yn - 16;
    dst[i + 1] = 500 * (xn - yn);
    dst[i + 2] = 200 * (yn - zn);
  }
  return dst;
}

/** YCxCz -> XYZ -> linear-RGB (clamped 0..1) -> XYZ -> CIELab + Hunt adjustment, in place. */
function opponentToLab(src) {
  for (let i = 0; i < src.length; i += 3) {
    const l = src[i];
    const cx = src[i + 1];
    const cz = src[i + 2];
    const yy = (l + 16) / 116;
    let x = yy + cx / 500;
    let z = yy - cz / 200;
    const yv = yy * REF_ILLUM[1];
    x *= REF_ILLUM[0];
    z *= REF_ILLUM[2];
    let r = XYZ_TO_RGB[0] * x + XYZ_TO_RGB[1] * yv + XYZ_TO_RGB[2] * z;
    let g = XYZ_TO_RGB[3] * x + XYZ_TO_RGB[4] * yv + XYZ_TO_RGB[5] * z;
    let b = XYZ_TO_RGB[6] * x + XYZ_TO_RGB[7] * yv + XYZ_TO_RGB[8] * z;
    if (r < 0) r = 0;
    else if (r > 1) r = 1;
    if (g < 0) g = 0;
    else if (g > 1) g = 1;
    if (b < 0) b = 0;
    else if (b > 1) b = 1;
    const X = RGB_TO_XYZ[0] * r + RGB_TO_XYZ[1] * g + RGB_TO_XYZ[2] * b;
    const Y = RGB_TO_XYZ[3] * r + RGB_TO_XYZ[4] * g + RGB_TO_XYZ[5] * b;
    const Z = RGB_TO_XYZ[6] * r + RGB_TO_XYZ[7] * g + RGB_TO_XYZ[8] * b;
    const Xn = Math.abs(X / REF_ILLUM[0]);
    const Yn = Math.abs(Y / REF_ILLUM[1]);
    const Zn = Math.abs(Z / REF_ILLUM[2]);
    const fx = Xn > 0.008856 ? Math.cbrt(Xn) : 7.787 * Xn + 16 / 116;
    const fy = Yn > 0.008856 ? Math.cbrt(Yn) : 7.787 * Yn + 16 / 116;
    const fz = Zn > 0.008856 ? Math.cbrt(Zn) : 7.787 * Zn + 16 / 116;
    const labL = 116 * fy - 16;
    const labA = 500 * (fx - fy);
    const labB = 200 * (fy - fz);
    // Hunt adjustment: chroma scaled by 1% of the adapted luminance.
    src[i] = labL;
    src[i + 1] = 0.01 * labL * labA;
    src[i + 2] = 0.01 * labL * labB;
  }
  return src;
}

function gaussSum(x2, a1, b1, a2, b2, piSq) {
  return a1 * Math.sqrt(Math.PI / b1) * Math.exp((-piSq * x2) / b1) + a2 * Math.sqrt(Math.PI / b2) * Math.exp((-piSq * x2) / b2);
}

/** Spatial CSF pre-filter kernel of the color pipeline (published per-channel Gaussians). */
function buildSpatialFilter(ppd) {
  const a1 = [1.0, 1.0, 34.1];
  const b1 = [0.0047, 0.0053, 0.04];
  const a2 = [0.0, 0.0, 13.5];
  const b2 = [1.0e-5, 1.0e-5, 0.025];
  const piSq = Math.PI * Math.PI;
  const deltaX = 1 / ppd;
  const maxScale = Math.max(b1[0], b1[1], b1[2], b2[0], b2[1], b2[2]);
  const radius = Math.ceil((3 * Math.sqrt(maxScale / (2 * piSq))) * ppd);
  const width = 2 * radius + 1;
  const kernels = [
    new Float32Array(width * width),
    new Float32Array(width * width),
    new Float32Array(width * width),
  ];
  const sums = [0, 0, 0];
  for (let y = 0; y < width; y++) {
    const iy = (y - radius) * deltaX;
    for (let x = 0; x < width; x++) {
      const ix = (x - radius) * deltaX;
      const d2 = ix * ix + iy * iy;
      const idx = y * width + x;
      for (let ch = 0; ch < 3; ch++) {
        const v = gaussSum(d2, a1[ch], b1[ch], a2[ch], b2[ch], piSq);
        kernels[ch][idx] = v;
        sums[ch] += v;
      }
    }
  }
  for (let ch = 0; ch < 3; ch++) {
    const k = kernels[ch];
    const s = sums[ch];
    for (let i = 0; i < k.length; i++) k[i] /= s;
  }
  return { kernels, radius, width };
}

/** Single-channel 2D convolution with replicate borders. */
function convolve1(src, out, kernel, radius, width, height) {
  const fsize = 2 * radius + 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = y * width + x;
      let acc = 0;
      for (let ky = -radius; ky <= radius; ky++) {
        let yy = y + ky;
        if (yy < 0) yy = 0;
        else if (yy >= height) yy = height - 1;
        const row = yy * width;
        for (let kx = -radius; kx <= radius; kx++) {
          let xx = x + kx;
          if (xx < 0) xx = 0;
          else if (xx >= width) xx = width - 1;
          acc += kernel[(ky + radius) * fsize + (kx + radius)] * src[row + xx];
        }
      }
      out[o] = acc;
    }
  }
}

/** Convolves all three channels of a flat 3-channel image with the per-channel spatial kernels. */
function convolveChannels(src, out, filter, width, height) {
  const pxs = width * height;
  const chan = new Float32Array(pxs);
  const dst = new Float32Array(pxs);
  for (let ch = 0; ch < 3; ch++) {
    for (let i = 0; i < pxs; i++) chan[i] = src[i * 3 + ch];
    convolve1(chan, dst, filter.kernels[ch], filter.radius, width, height);
    for (let i = 0; i < pxs; i++) out[i * 3 + ch] = dst[i];
  }
}

/** HyAB color difference in CIELab (City-block L + Euclidean chroma). */
function hyAbDistance(l1, a1, b1, l2, a2, b2) {
  return Math.abs(l1 - l2) + Math.hypot(a1 - a2, b1 - b2);
}

function labHuntOfLinearRgb(r, g, b) {
  const x = RGB_TO_XYZ[0] * r + RGB_TO_XYZ[1] * g + RGB_TO_XYZ[2] * b;
  const y = RGB_TO_XYZ[3] * r + RGB_TO_XYZ[4] * g + RGB_TO_XYZ[5] * b;
  const z = RGB_TO_XYZ[6] * r + RGB_TO_XYZ[7] * g + RGB_TO_XYZ[8] * b;
  const Xc = Math.cbrt(Math.abs(x / REF_ILLUM[0]));
  const Yc = Math.cbrt(Math.abs(y / REF_ILLUM[1]));
  const Zc = Math.cbrt(Math.abs(z / REF_ILLUM[2]));
  const L = 116 * Yc - 16;
  const A = 500 * (Xc - Yc);
  const B = 200 * (Yc - Zc);
  return [L, 0.01 * L * A, 0.01 * L * B];
}

/** Max possible Hunt-adjusted Lab distance (normalization of the color error remapping). */
function maxColorDistance() {
  const green = labHuntOfLinearRgb(0, 1, 0);
  const blue = labHuntOfLinearRgb(0, 0, 1);
  return Math.pow(hyAbDistance(green[0], green[1], green[2], blue[0], blue[1], blue[2]), GQC);
}

/** Color error map with the published piecewise remapping into [0,1]. */
function computeColorDifference(preRef, preTest, pxs, cmax) {
  const out = new Float32Array(pxs);
  const pccmax = GPC * cmax;
  for (let i = 0, o = 0; i < pxs; i++, o += 3) {
    let error = hyAbDistance(preRef[o], preRef[o + 1], preRef[o + 2], preTest[o], preTest[o + 1], preTest[o + 2]);
    error = Math.pow(error, GQC);
    if (error < pccmax) {
      error *= GPT / pccmax;
    } else {
      error = GPT + ((error - pccmax) / (cmax - pccmax)) * (1 - GPT);
    }
    out[i] = error;
  }
  return out;
}

/** Edge (`pointDetector=false`) or point (`pointDetector=true`) detection filter, normalized. */
function buildDetectionFilter(ppd, pointDetector) {
  const sigma = 0.5 * GW * ppd;
  const radius = Math.ceil(3 * sigma);
  const width = 2 * radius + 1;
  const xw = new Float32Array(width * width);
  const yw = new Float32Array(width * width);
  let posSumX = 0;
  let negSumX = 0;
  let posSumY = 0;
  let negSumY = 0;
  for (let y = 0; y < width; y++) {
    const yy = y - radius;
    for (let x = 0; x < width; x++) {
      const xx = x - radius;
      const g = Math.exp(-(xx * xx + yy * yy) / (2 * sigma * sigma));
      let wx;
      let wy;
      if (pointDetector) {
        wx = (xx * xx / (sigma * sigma) - 1) * g;
        wy = (yy * yy / (sigma * sigma) - 1) * g;
      } else {
        wx = -xx * g;
        wy = -yy * g;
      }
      const idx = y * width + x;
      xw[idx] = wx;
      yw[idx] = wy;
      if (wx > 0) posSumX += wx;
      else negSumX += -wx;
      if (wy > 0) posSumY += wy;
      else negSumY += -wy;
    }
  }
  for (let i = 0; i < xw.length; i++) {
    xw[i] /= xw[i] > 0 ? posSumX : negSumX;
    yw[i] /= yw[i] > 0 ? posSumY : negSumY;
  }
  return { xw, yw, radius, width };
}

/** Grayscale convolution into a 2-channel buffer (channel 0 = X filter, channel 1 = Y filter). */
function convolveGray(srcGray, dst2ch, fX, fY, radius, fsize, width, height) {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = y * width + x;
      let sx = 0;
      let sy = 0;
      for (let ky = -radius; ky <= radius; ky++) {
        let yy = y + ky;
        if (yy < 0) yy = 0;
        else if (yy >= height) yy = height - 1;
        const row = yy * width;
        for (let kx = -radius; kx <= radius; kx++) {
          let xx = x + kx;
          if (xx < 0) xx = 0;
          else if (xx >= width) xx = width - 1;
          const tap = (ky + radius) * fsize + (kx + radius);
          const pixel = srcGray[row + xx];
          sx += fX[tap] * pixel;
          sy += fY[tap] * pixel;
        }
      }
      dst2ch[o] = sx;
      dst2ch[o + width * height] = sy;
    }
  }
}

/** Feature error map from the achromatic channel of both opponent-lightness images. */
function computeFeatureDifference(ref, test, width, height, ppd) {
  const pxs = width * height;
  const refGray = new Float32Array(pxs);
  const testGray = new Float32Array(pxs);
  for (let i = 0; i < pxs; i++) {
    // Achromatic component of YCxCz, normalized to [0,1]; stored in both filter channels.
    refGray[i] = (ref[i * 3] + 16) / 116;
    testGray[i] = (test[i * 3] + 16) / 116;
  }
  const edges = buildDetectionFilter(ppd, false);
  const points = buildDetectionFilter(ppd, true);
  const refEdges = new Float32Array(pxs * 2);
  const refPoints = new Float32Array(pxs * 2);
  const testEdges = new Float32Array(pxs * 2);
  const testPoints = new Float32Array(pxs * 2);
  convolveGray(refGray, refEdges, edges.xw, edges.yw, edges.radius, edges.width, width, height);
  convolveGray(testGray, testEdges, edges.xw, edges.yw, edges.radius, edges.width, width, height);
  convolveGray(refGray, refPoints, points.xw, points.yw, points.radius, points.width, width, height);
  convolveGray(testGray, testPoints, points.xw, points.yw, points.radius, points.width, width, height);

  const out = new Float32Array(pxs);
  for (let i = 0; i < pxs; i++) {
    const refEdge = Math.hypot(refEdges[i], refEdges[i + pxs]);
    const testEdge = Math.hypot(testEdges[i], testEdges[i + pxs]);
    const refPoint = Math.hypot(refPoints[i], refPoints[i + pxs]);
    const testPoint = Math.hypot(testPoints[i], testPoints[i + pxs]);
    const featureDifference = FLIP_SQRT2_INV * Math.max(Math.abs(refEdge - testEdge), Math.abs(refPoint - testPoint));
    out[i] = Math.pow(featureDifference, GQF);
  }
  return out;
}

function percentileSorted(sorted, q) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * q));
  return sorted[idx];
}

/** Confined to [0,1] and pooled into the summary statistics. */
function pooledStats(errorMap) {
  const n = errorMap.length;
  const sorted = new Float64Array(n);
  for (let i = 0; i < n; i++) sorted[i] = errorMap[i];
  sorted.sort();
  // Document-frequency weighting: rare high-error regions dominate (approximation of the
  // reference's spatial pooling; exact NVIDIA pooling is the documented follow-up).
  const HIST_BUCKETS = 1000;
  const bucketCount = new Uint32Array(HIST_BUCKETS);
  for (let i = 0; i < n; i++) {
    bucketCount[Math.min(HIST_BUCKETS - 1, Math.floor(errorMap[i] * HIST_BUCKETS))]++;
  }
  let wsum = 0;
  let mean = 0;
  let plainSum = 0;
  for (let i = 0; i < n; i++) {
    plainSum += errorMap[i];
    const bucket = Math.min(HIST_BUCKETS - 1, Math.floor(errorMap[i] * HIST_BUCKETS));
    const w = Math.log(1 + n / Math.max(1, bucketCount[bucket]));
    mean += w * errorMap[i];
    wsum += w;
  }
  return {
    mean: mean / wsum,
    p50: percentileSorted(sorted, 0.5),
    p95: percentileSorted(sorted, 0.95),
    min: sorted[0] ?? 0,
    max: sorted[n - 1] ?? 0,
    meanPixelsAffected: plainSum / n,
  };
}

/** Full pipeline; returns summary + error map + geometry. */
function runPipeline(ref, test, ppd) {
  const refOpp = toOpponent(new Float32Array(ref.rgb.length), ref.rgb);
  const testOpp = toOpponent(new Float32Array(test.rgb.length), test.rgb);

  // Color pipeline.
  const filter = buildSpatialFilter(ppd);
  const preRef = new Float32Array(refOpp.length);
  const preTest = new Float32Array(testOpp.length);
  convolveChannels(refOpp, preRef, filter, ref.width, ref.height);
  convolveChannels(testOpp, preTest, filter, ref.width, ref.height);
  opponentToLab(preRef);
  opponentToLab(preTest);
  const cmax = maxColorDistance();
  const colorError = computeColorDifference(preRef, preTest, ref.width * ref.height, cmax);

  // Feature pipeline.
  const featureError = computeFeatureDifference(refOpp, testOpp, ref.width, ref.height, ppd);

  // Combined FLIP error.
  const pxs = ref.width * ref.height;
  const map = new Float32Array(pxs);
  for (let i = 0; i < pxs; i++) {
    map[i] = Math.pow(colorError[i], 1 - featureError[i]);
  }
  return { map, width: ref.width, height: ref.height };
}

/**
 * Computes the FLIP error map between two PNG buffers and its pooled summary.
 *
 * @param {Buffer} pngRef Reference PNG (ground truth: LOD0, no culling, supersampled).
 * @param {Buffer} pngTest Measurement PNG (same pixel size as the reference; no auto-resize).
 * @param {{ ppd?: number }} [opts] Pixels per degree; default from the reference monitor setup
 *   (0.7 m viewing distance, 0.7 m wide, 3840 px). Pass the actual viewing PPD for apples-to-
 *   apples comparisons.
 * @returns {FlipResult} 0 = indistinguishable, 1 = maximally different.
 */
export function computeFlip(pngRef, pngTest, opts = {}) {
  const ref = decodePng(pngRef);
  const test = decodePng(pngTest);
  if (ref.width !== test.width || ref.height !== test.height) {
    throw new Error(`FLIP: size mismatch (ref ${ref.width}x${ref.height} vs test ${test.width}x${test.height})`);
  }
  const ppd = Number.isFinite(opts.ppd) && opts.ppd > 0 ? opts.ppd : defaultPpd();
  const { map } = runPipeline(ref, test, ppd);
  return pooledStats(map);
}

/**
 * Like {@link computeFlip} but also returns the raw error map (for heatmap export and custom
 * pooling).
 * @returns {FlipResult & { map: Float32Array, width: number, height: number }}
 */
export function computeFlipWithMap(pngRef, pngTest, opts = {}) {
  const ref = decodePng(pngRef);
  const test = decodePng(pngTest);
  if (ref.width !== test.width || ref.height !== test.height) {
    throw new Error(`FLIP: size mismatch (ref ${ref.width}x${ref.height} vs test ${test.width}x${test.height})`);
  }
  const ppd = Number.isFinite(opts.ppd) && opts.ppd > 0 ? opts.ppd : defaultPpd();
  const result = runPipeline(ref, test, ppd);
  return { ...pooledStats(result.map), map: result.map, width: result.width, height: result.height };
}

/** Encodes a FLIP error map as a PNG (magma-styled for inspection). */
export function encodeFlipHeatmap(map, width) {
  const height = map.length / width;
  const data = Buffer.alloc(map.length * 4);
  for (let i = 0; i < map.length; i++) {
    const v = Math.min(1, Math.max(0, map[i]));
    const o = i * 4;
    data[o] = Math.round(v * 235);
    data[o + 1] = Math.round(v * 150);
    data[o + 2] = Math.round(v * 70);
    data[o + 3] = 255;
  }
  return PNG.sync.write({ width, height, data }, { colorType: 6 });
}
