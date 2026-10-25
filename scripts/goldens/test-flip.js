// Deterministic fixture harness for the in-repo FLIP-style metric (scripts/goldens/flip.js).
//
// Golden-drift reality: between two identical engine runs the only differences are sub-pixel TAA
// jitter and tiny temporal noise — content a naive per-pixel metric (pixelmatch) flags as drift.
// These fixtures assert that the metric suppresses exactly that class (order-of-magnitude ONLY,
// never exact equality — the port is deterministic but its absolute values are a model, not a
// gold standard) while still flagging real, low-frequency colour/structure changes.
//
//   node scripts/goldens/test-flip.js         → exit 0 (all assertions hold) or 1
//
// All images are generated in-process with a fixed-seed LCG and plain PNG arithmetic; no files.

import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
import { flipScore, DEFAULT_PIXELS_PER_DEGREE as PPD } from "./flip.js";

let failures = 0;
const results = [];

function check(name, condition, detail) {
  results.push({ name, condition: Boolean(condition), detail });
  if (!condition) failures++;
  const mark = condition ? "PASS" : "FAIL";
  console.log(`${mark}  ${name}: ${detail}`);
}

/** Deterministic LCG (Park–Miller); identical across platforms and runs. */
function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 48271) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** Builds an RGBA pngjs image from a per-pixel function of (x, y). */
function makeImage(width, height, pixelFn) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixelFn(x, y);
      const o = (y * width + x) * 4;
      png.data[o] = r;
      png.data[o + 1] = g;
      png.data[o + 2] = b;
      png.data[o + 3] = 255;
    }
  }
  return png;
}

/** Uniform neutral field (also the base for the other fixtures). */
function neutralField(width, height, lum = 128) {
  return makeImage(width, height, () => [lum, lum, lum]);
}

const W = 128;
const H = 128;

// ───────────────────────────────────────────────────────────────────────────────────────────────
// Fixture 1: identical images must score ~0.
// ───────────────────────────────────────────────────────────────────────────────────────────────
{
  const ref = neutralField(W, H);
  const res = flipScore(ref, PNG.sync.read(PNG.sync.write(ref)), { pixelsPerDegree: PPD });
  check("identical -> score ~ 0", res.mean < 1e-9, `mean=${res.mean.toExponential(2)}`);
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// Fixture 2: sub-pixel TAA jitter (1px checkerboard dither along a hard edge) must be suppressed,
// even though the naive per-pixel diff ratio is large.
// ───────────────────────────────────────────────────────────────────────────────────────────────
{
  const ref = makeImage(W, H, (x) => {
    const lum = x < 64 ? 40 : 210;
    return [lum, lum, lum];
  });
  // "Accumulated" test frame: the same edge location, but a sub-pixel sample draws the boundary as
  // a 1px alternating dither band (the classic TAA failure mode for naive metrics).
  const jitter = makeImage(W, H, (x, y) => {
    const inBand = x >= 62 && x <= 65;
    const base = x < 64 ? 40 : 210;
    if (inBand) {
      const alt = (x + y) % 2 === 0 ? 215 : 35;
      return [alt, alt, alt];
    }
    return [base, base, base];
  });
  const res = flipScore(ref, jitter, { pixelsPerDegree: PPD });
  // The same pair through the DEFAULT golden metric (pixelmatch), so the claim is about the real
  // false-positive baseline: pixelmatch sees >0.5% of pixels differ (drift), flip sees none.
  const diff = new PNG({ width: W, height: H });
  const diffCount = pixelmatch(ref.data, jitter.data, diff.data, W, H, { threshold: 0.1 });
  const pixelmatchRatio = diffCount / (W * H);
  check(
    "taa-1px-alternation suppressed by CSF while pixelmatch flags it as drift",
    res.mean < 0.01 && pixelmatchRatio > 0.005,
    `flip.mean=${res.mean.toFixed(5)}  pixelmatchRatio=${pixelmatchRatio.toFixed(5)}`,
  );
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// Fixture 3: low-frequency colour shift of a region must be flagged (real drift).
// ───────────────────────────────────────────────────────────────────────────────────────────────
{
  const ref = neutralField(W, H, 96);
  const shifted = makeImage(W, H, (x, y) => {
    // A large, low-frequency brightened patch (no fine structure) in the centre.
    const inPatch = x >= 48 && x < 80 && y >= 48 && y < 80;
    const lum = inPatch ? 96 + 60 : 96;
    return [lum, lum, lum];
  });
  const res = flipScore(ref, shifted, { pixelsPerDegree: PPD });
  check("colour/illumination shift flagged", res.mean > 0.01, `mean=${res.mean.toFixed(5)}`);
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// Fixture 4: structural change (a new high-contrast object) must be flagged.
// ───────────────────────────────────────────────────────────────────────────────────────────────
{
  const rng = makeRng(0x5eed);
  const ref = makeImage(W, H, () => {
    const n = Math.floor(rng() * 255);
    return [n, n, n];
  });
  const withObject = makeImage(W, H, (x, y) => {
    const inObj = x >= 56 && x < 72 && y >= 56 && y < 72;
    if (inObj) return [255, 255, 255];
    const n = Math.floor(rng() * 255);
    return [n, n, n];
  });
  const res = flipScore(ref, withObject, { pixelsPerDegree: PPD });
  check("structural change flagged", res.mean > 0.01, `mean=${res.mean.toFixed(5)}`);
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// Determinism: identical inputs give identical outputs across two evaluations.
// ───────────────────────────────────────────────────────────────────────────────────────────────
{
  const ref = neutralField(W, H, 80);
  const mod = makeImage(W, H, (x) => (x >= 60 && x < 90 ? [180, 180, 180] : [80, 80, 80]));
  const a = flipScore(ref, mod, { pixelsPerDegree: PPD });
  const b = flipScore(ref, mod, { pixelsPerDegree: PPD });
  check("deterministic", a.mean === b.mean, `mean=${a.mean.toFixed(6)} repeated`);
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
console.log(
  `\nflip fixture harness: ${results.length - failures}/${results.length} assertions hold` +
    ` (ppd=${PPD}, default flip threshold 0.01)`,
);
process.exit(failures === 0 ? 0 : 1);
