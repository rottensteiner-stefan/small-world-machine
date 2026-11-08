import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import {
  computeFlip,
  computeFlipWithMap,
  encodeFlipHeatmap,
  defaultPpd,
} from "../../.agents/scripts/lib/veg-flip.mjs";

const W = 64;
const H = 64;

/** Builds a flat RGBA PNG buffer of solid `rgb`. */
function solidPng(rgb: [number, number, number]): Buffer {
  const png = new PNG({ width: W, height: H });
  for (let i = 0; i < W * H; i++) {
    png.data[i * 4] = rgb[0];
    png.data[i * 4 + 1] = rgb[1];
    png.data[i * 4 + 2] = rgb[2];
    png.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(png);
}

/** Builds a horizontal gradient PNG (red channel inclines, green/blue constant) shifted by `delta`. */
function gradientPng(delta = 0): Buffer {
  const png = new PNG({ width: W, height: H });
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      png.data[i * 4] = Math.min(255, Math.max(0, x * 2 + delta));
      png.data[i * 4 + 1] = 90;
      png.data[i * 4 + 2] = 40;
      png.data[i * 4 + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

describe("veg-flip", () => {
  it("returns 0 (indistinguishable) for identical images", () => {
    const ref = solidPng([128, 128, 128]);
    const result = computeFlip(ref, ref);
    expect(result.mean).toBe(0);
    expect(result.p50).toBe(0);
    expect(result.p95).toBe(0);
    expect(result.max).toBe(0);
    expect(result.min).toBe(0);
    expect(result.meanPixelsAffected).toBe(0);
  });

  it("reports a larger error for a larger perturbation (monotonic direction)", () => {
    const ref = solidPng([120, 120, 120]);
    const small = computeFlip(ref, solidPng([125, 125, 125]));
    const large = computeFlip(ref, solidPng([200, 120, 120]));
    expect(small.mean).toBeGreaterThan(0);
    expect(large.mean).toBeGreaterThan(small.mean);
    expect(large.p95).toBeGreaterThan(small.p95);
  });

  it("is symmetric in its pooled headline value", () => {
    const a = gradientPng(0);
    const b = gradientPng(10);
    const ab = computeFlip(a, b);
    const ba = computeFlip(b, a);
    expect(ab.mean).toBeCloseTo(ba.mean, 6);
    expect(ab.p50).toBeCloseTo(ba.p50, 6);
  });

  it("throws on size mismatch", () => {
    const small = solidPng([128, 128, 128]);
    const big = PNG.sync.write(new PNG({ width: W + 1, height: H }));
    expect(() => computeFlip(small, big)).toThrow(/size mismatch/);
  });

  it("detects changed detail (feature pipeline engages on edges, not only flat color)", () => {
    const ref = gradientPng(0);
    // An edge inserted in the middle of an otherwise identical gradient must be caught.
    const editedPng = PNG.sync.read(ref);
    for (let y = 0; y < H; y++) {
      const i = y * W + 30;
      editedPng.data[i * 4] = 240;
      editedPng.data[i * 4 + 1] = 240;
      editedPng.data[i * 4 + 2] = 240;
    }
    const edited = PNG.sync.write(editedPng);
    const result = computeFlip(ref, edited);
    expect(result.mean).toBeGreaterThan(0);
  });

  it("exposes p50 <= p95 <= max on a polluted image", () => {
    const ref = gradientPng(0);
    const test = gradientPng(12);
    const result = computeFlip(ref, test);
    expect(result.p50).toBeLessThanOrEqual(result.p95);
    expect(result.p95).toBeLessThanOrEqual(result.max);
    expect(result.min).toBeGreaterThanOrEqual(0);
  });

  it("emits a heatmap PNG of the right size", () => {
    const ref = gradientPng(0);
    const test = gradientPng(8);
    const { map } = computeFlipWithMap(ref, test);
    expect(map.length).toBe(W * H);
    const png = encodeFlipHeatmap(map, W);
    const decoded = PNG.sync.read(png);
    expect(decoded.width).toBe(W);
    expect(decoded.height).toBe(H);
  });

  it("default PPD is stable and sanely positive", () => {
    const ppd = defaultPpd();
    expect(Number.isFinite(ppd)).toBe(true);
    expect(ppd).toBeGreaterThan(20);
  });
});
