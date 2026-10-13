import { describe, it, expect } from "vitest";
import { mapToString, quantizeImageToGrid, stringToMap } from "../../src/core/map.js";
import type { RgbaImage } from "../../src/core/RasterIO.js";

function fixture(
  width: number,
  height: number,
  data: Array<[number, number, number, number]>,
): RgbaImage {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i++) {
    const px = data[i]!;
    out[i * 4] = px[0];
    out[i * 4 + 1] = px[1];
    out[i * 4 + 2] = px[2];
    out[i * 4 + 3] = px[3];
  }
  return { width, height, data: out };
}

const TOOL_PALETTE = {
  W: { color: "#555555", label: "Wall" },
  G: { color: "#444444", label: "Wall 2" },
  P: { color: "#0000ff", label: "Player" },
  ".": { color: "#1a1a1a", label: "Empty" },
};

describe("core/map ASCII<->grid conversions", () => {
  it("round-trips a map string through stringToMap/mapToString", () => {
    const map = "WWWW\nW..W\nWWWW";
    const grid = stringToMap(map);
    expect(mapToString(grid)).toBe(map);
  });

  it("pads short rows to the width of the first line", () => {
    const grid = stringToMap("WW\nW");
    expect(mapToString(grid)).toBe("WW\nW.");
  });

  it("normalizes escaped newlines and trims lines", () => {
    const grid = stringToMap("WW\\nW");
    // "WW" is the first line, so "W" is padded to its width (matches the tool)
    expect(mapToString(grid)).toBe("WW\nW.");
  });

  it("returns an empty grid for empty or whitespace input", () => {
    expect(stringToMap("")).toEqual([]);
    expect(stringToMap("   \n  ")).toEqual([]);
  });
});

describe("core/map quantizeImageToGrid (MapGenerator.loadFromImage purge guard)", () => {
  it("is deterministic: same RGBA fixture yields the same grid", () => {
    const img = fixture(2, 2, [
      [85, 85, 85, 255], // row 0, col 0
      [0, 0, 0, 0], // row 0, col 1 (transparent)
      [68, 68, 68, 255], // row 1, col 0
      [0, 0, 255, 255], // row 1, col 1 (blue)
    ]);
    const a = quantizeImageToGrid(img, TOOL_PALETTE);
    const b = quantizeImageToGrid(img, TOOL_PALETTE);
    expect(a).toEqual(b);
  });

  it("reproduces the exact legacy algorithm on a known fixture (byte-parity guard)", () => {
    const img = fixture(2, 2, [
      [85, 85, 85, 255], // dark wall color -> W
      [0, 0, 0, 0], // transparent -> empty
      [68, 68, 68, 255], // Wall 2 color -> G
      [0, 0, 255, 255], // player blue -> P
    ]);
    const grid = quantizeImageToGrid(img, TOOL_PALETTE);
    expect(mapToString(grid)).toBe("W.\nGP");
  });

  it("maps bright pixels with no close palette entry to the empty char", () => {
    // Pure white has lum > 200 and no close legend entry -> empty char
    const img = fixture(1, 1, [[255, 255, 255, 255]]);
    const grid = quantizeImageToGrid(img, TOOL_PALETTE);
    expect(mapToString(grid)).toBe(".");
  });

  it("returns the grid at the input image dimensions", () => {
    const img = fixture(4, 3, [
      [64, 64, 64, 128],
      [64, 64, 64, 128],
      [64, 64, 64, 128],
      [64, 64, 64, 128],
      [64, 64, 64, 128],
      [64, 64, 64, 128],
      [64, 64, 64, 128],
      [64, 64, 64, 128],
      [64, 64, 64, 128],
      [64, 64, 64, 128],
      [64, 64, 64, 128],
      [64, 64, 64, 128],
    ]);
    const grid = quantizeImageToGrid(img, TOOL_PALETTE);
    expect(grid.length).toBe(3);
    expect(grid[0]!.length).toBe(4);
  });
});
