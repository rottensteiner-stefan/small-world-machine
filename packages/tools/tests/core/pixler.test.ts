import { describe, it, expect } from "vitest";
import {
  computeTrimBounds,
  floodFill,
  mirrorRgba,
  panRgba,
  trimRgba,
} from "../../src/core/pixler.js";
import { autocropRgba } from "../../src/core/sprite.js";
import type { RgbaImage } from "../../src/core/RasterIO.js";

function fixture(
  width: number,
  height: number,
  fill: [number, number, number, number] = [0, 0, 0, 0],
): RgbaImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = fill[0];
    data[i + 1] = fill[1];
    data[i + 2] = fill[2];
    data[i + 3] = fill[3];
  }
  return { width, height, data };
}

function setRgba(
  img: RgbaImage,
  x: number,
  y: number,
  fill: [number, number, number, number],
): void {
  const i = (y * img.width + x) * 4;
  img.data[i] = fill[0];
  img.data[i + 1] = fill[1];
  img.data[i + 2] = fill[2];
  img.data[i + 3] = fill[3];
}

describe("core/pixler panRgba", () => {
  it("pans with wrap-around and is deterministic", () => {
    // 2x2: unique per-cell colors
    const src = fixture(2, 2);
    setRgba(src, 0, 0, [1, 0, 0, 255]);
    setRgba(src, 1, 0, [2, 0, 0, 255]);
    setRgba(src, 0, 1, [3, 0, 0, 255]);
    setRgba(src, 1, 1, [4, 0, 0, 255]);

    const out = panRgba(src, 1, 0);
    // pan by +1x: each cell moves right, wrapping from the left edge
    const a = panRgba(src, 1, 0);
    expect(Array.from(out.data)).toEqual(Array.from(a.data));
    // (0,0) receives what was at (1,0)
    expect(out.data[0]).toBe(2);
    // (1,0) receives what was at (0,0) wrapped around
    expect(out.data[4]).toBe(1);
  });

  it("handles negative deltas with positive-modulo wrap", () => {
    const src = fixture(3, 1, [7, 7, 7, 255]);
    setRgba(src, 0, 0, [255, 0, 0, 255]);
    // -1 on a 3-wide image behaves like +2
    const out = panRgba(src, -1, 0);
    expect(out.data[(0 * 3 + 2) * 4]).toBe(255);
  });
});

describe("core/pixler trimRgba", () => {
  it("auto-trims transparency like core/sprite autocropRgba", () => {
    const src = fixture(8, 8, [0, 0, 0, 0]);
    for (let y = 2; y <= 4; y++) {
      for (let x = 1; x <= 3; x++) {
        setRgba(src, x, y, [180, 180, 180, 255]);
      }
    }

    const trimmed = trimRgba(src);
    const auto = autocropRgba(src);
    expect(trimmed.width).toBe(auto.width);
    expect(trimmed.height).toBe(auto.height);
    expect(Array.from(trimmed.data)).toEqual(Array.from(auto.data));
  });

  it("trims a configured background color on top of transparency", () => {
    const src = fixture(6, 6, [10, 10, 10, 255]); // background color
    setRgba(src, 2, 2, [250, 0, 0, 255]);
    setRgba(src, 3, 3, [250, 0, 0, 255]);

    const trimmed = trimRgba(src, { backgroundColor: [10, 10, 10, 255] });
    expect(trimmed.width).toBe(2);
    expect(trimmed.height).toBe(2);
    expect(trimmed.data[0]).toBe(250);
  });

  it("returns a 1x1 buffer when everything is background", () => {
    const src = fixture(4, 4, [10, 10, 10, 255]);
    const trimmed = trimRgba(src, { backgroundColor: [10, 10, 10, 255] });
    expect(trimmed.width).toBe(1);
    expect(trimmed.height).toBe(1);
  });
});

describe("core/pixler mirrorRgba + floodFill (re-exported pure ops)", () => {
  it("mirrorRgba flips deterministically", () => {
    const src = fixture(3, 3, [1, 1, 1, 255]);
    setRgba(src, 0, 0, [255, 0, 0, 255]);
    const m = mirrorRgba(src, true, false);
    const m2 = mirrorRgba(src, true, false);
    expect(Array.from(m.data)).toEqual(Array.from(m2.data));
    expect(m.data[(0 * 3 + 2) * 4]).toBe(255);
  });

  it("floodFill replaces a connected region in-place", () => {
    const w = 4;
    const h = 4;
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < data.length; i += 4) {
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 255;
    }
    floodFill(data, w, h, 0, 0, [255, 255, 255, 255]);
    expect(data[0]).toBe(255);
    expect(data[(3 * w + 3) * 4]).toBe(255);
  });

  it("computeTrimBounds stays pure and reusable", () => {
    const bounds = computeTrimBounds(4, 4, (x, y) => !(x === 1 && y === 1));
    expect(bounds).toEqual({ x: 1, y: 1, width: 1, height: 1 });
  });
});
