import { describe, it, expect } from "vitest";
import {
  generateSplatter,
  parseSplatterColor,
  SPLATTER_ALGORITHMS,
  SPLATTER_DEFAULTS,
  type SplatterAlgorithm,
  type SplatterOptions,
} from "../../src/core/splatter.js";

// Small canvases keep the suite fast; radius scales so the blob still fills about half of it.
function options(
  algorithm: SplatterAlgorithm,
  extra: Record<string, number | string> = {},
): SplatterOptions {
  return {
    algorithm,
    ...SPLATTER_DEFAULTS[algorithm],
    size: 128,
    radius: 30,
    ...extra,
  } as SplatterOptions;
}

function alphaAt(image: { width: number; data: Uint8ClampedArray }, x: number, y: number): number {
  return image.data[(y * image.width + x) * 4 + 3]!;
}

function alphaSum(data: Uint8ClampedArray): number {
  let sum = 0;
  for (let i = 3; i < data.length; i += 4) sum += data[i]!;
  return sum / 255;
}

describe.each(SPLATTER_ALGORITHMS)("core/splatter %s", (algorithm) => {
  it("is byte-deterministic for a seed and differs between seeds", () => {
    const a = generateSplatter(options(algorithm, { seed: 7 }));
    const b = generateSplatter(options(algorithm, { seed: 7 }));
    const c = generateSplatter(options(algorithm, { seed: 8 }));
    expect(Array.from(a.data)).toEqual(Array.from(b.data));
    expect(Array.from(a.data)).not.toEqual(Array.from(c.data));
  });

  it("returns a size x size RGBA image in the requested colour", () => {
    const image = generateSplatter(options(algorithm, { color: "#102030" }));
    expect(image.width).toBe(128);
    expect(image.height).toBe(128);
    expect(image.data.length).toBe(128 * 128 * 4);
    for (let i = 0; i < image.data.length; i += 4) {
      expect([image.data[i], image.data[i + 1], image.data[i + 2]]).toEqual([0x10, 0x20, 0x30]);
    }
  });

  it("is opaque in the middle and transparent in the corners", () => {
    const image = generateSplatter(options(algorithm));
    expect(alphaAt(image, 64, 64)).toBe(255);
    for (const [x, y] of [
      [0, 0],
      [127, 0],
      [0, 127],
      [127, 127],
    ] as const) {
      expect(alphaAt(image, x, y)).toBe(0);
    }
  });
});

describe("core/splatter rasterizer", () => {
  it("fills a plain disc to within half a percent of pi r^2", () => {
    const image = generateSplatter(
      options("noise-warp", { radius: 50, amplitude: 0, satellites: 0 }),
    );
    const expected = Math.PI * 50 * 50;
    expect(Math.abs(alphaSum(image.data) - expected) / expected).toBeLessThan(0.005);
  });

  it("covers fewer pixels as the metaball threshold rises", () => {
    const loose = generateSplatter(options("metaballs", { threshold: 60 }));
    const tight = generateSplatter(options("metaballs", { threshold: 200 }));
    expect(alphaSum(tight.data)).toBeLessThan(alphaSum(loose.data));
  });

  it("adds satellites outside the main blob", () => {
    const none = generateSplatter(options("noise-warp", { satellites: 0 }));
    const many = generateSplatter(options("noise-warp", { satellites: 25 }));
    expect(alphaSum(many.data)).toBeGreaterThan(alphaSum(none.data));
  });
});

describe("core/splatter validation", () => {
  it("rejects a bad colour, size and seed", () => {
    expect(() => generateSplatter(options("metaballs", { color: "red" }))).toThrow(/#rrggbb/);
    expect(() => generateSplatter(options("metaballs", { size: 0 }))).toThrow(/size/);
    expect(() => generateSplatter(options("metaballs", { size: 8192 }))).toThrow(/size/);
    expect(() => generateSplatter(options("metaballs", { seed: Number.NaN }))).toThrow(/seed/);
  });

  it("parses #rrggbb with or without the hash", () => {
    expect(parseSplatterColor("#4a3728")).toEqual([0x4a, 0x37, 0x28]);
    expect(parseSplatterColor("4A3728")).toEqual([0x4a, 0x37, 0x28]);
    expect(parseSplatterColor("#fff")).toBeNull();
  });
});
