import { describe, it, expect } from "vitest";
import { Color } from "../../../src/core/colors/index.js";
import { bakeRamp, RAMP_LUT_SIZE } from "../../../src/core/textures/RampLUT.js";

const RED: Color = new Color(1, 0, 0, 1);
const BLUE: Color = new Color(0, 0, 1, 1);
const GREEN: Color = new Color(0, 1, 0, 1);

function texel(px: Uint8ClampedArray, i: number): number[] {
  return [px[i * 4]!, px[i * 4 + 1]!, px[i * 4 + 2]!, px[i * 4 + 3]!];
}

describe("bakeRamp", () => {
  it("has 256 RGBA texels (length 1024) with alpha 255 everywhere", () => {
    const px = bakeRamp([
      { t: 0, color: RED },
      { t: 1, color: BLUE },
    ]);
    expect(px.length).toBe(1024);
    expect(RAMP_LUT_SIZE).toBe(256);
    for (let i = 0; i < RAMP_LUT_SIZE; i++) {
      expect(px[i * 4 + 3]).toBe(255);
    }
  });

  it("hits both endpoint colours exactly", () => {
    const px = bakeRamp([
      { t: 0, color: RED },
      { t: 1, color: BLUE },
    ]);
    expect(texel(px, 0)).toEqual([255, 0, 0, 255]);
    expect(texel(px, 255)).toEqual([0, 0, 255, 255]);
  });

  it("interpolates linearly at the midpoint (texel 127 / 128 straddle t = 0.5)", () => {
    const px = bakeRamp([
      { t: 0, color: RED },
      { t: 1, color: BLUE },
    ]);
    expect(Math.abs(px[127 * 4]! - 128)).toBeLessThanOrEqual(1);
    expect(Math.abs(px[128 * 4]! - 127)).toBeLessThanOrEqual(1);
    expect(Math.abs(px[127 * 4 + 2]! - 127)).toBeLessThanOrEqual(1);
  });

  it("sorts unsorted stops by t", () => {
    const sorted = bakeRamp([
      { t: 0, color: RED },
      { t: 0.5, color: GREEN },
      { t: 1, color: BLUE },
    ]);
    const shuffled = bakeRamp([
      { t: 1, color: BLUE },
      { t: 0, color: RED },
      { t: 0.5, color: GREEN },
    ]);
    expect(Array.from(shuffled)).toEqual(Array.from(sorted));
  });

  it("fills the whole ramp with a single stop's colour", () => {
    const px = bakeRamp([{ t: 0.5, color: GREEN }]);
    for (let i = 0; i < RAMP_LUT_SIZE; i++) {
      expect(texel(px, i)).toEqual([0, 255, 0, 255]);
    }
  });

  it("holds the first colour before the first stop and the last colour after the last stop", () => {
    const px = bakeRamp([
      { t: 0.25, color: RED },
      { t: 0.75, color: BLUE },
    ]);
    expect(texel(px, 0)).toEqual([255, 0, 0, 255]);
    expect(texel(px, 63)).toEqual([255, 0, 0, 255]); // t = 0.247 < 0.25
    expect(texel(px, 192)).toEqual([0, 0, 255, 255]); // t = 0.753 > 0.75
    expect(texel(px, 255)).toEqual([0, 0, 255, 255]);
  });

  it("produces a hard step for duplicate t values", () => {
    const px = bakeRamp([
      { t: 0, color: RED },
      { t: 0.5, color: RED },
      { t: 0.5, color: BLUE },
      { t: 1, color: BLUE },
    ]);
    expect(texel(px, 127)).toEqual([255, 0, 0, 255]); // t = 0.498
    expect(texel(px, 128)).toEqual([0, 0, 255, 255]); // t = 0.502
  });

  it("clamps t outside 0..1", () => {
    const px = bakeRamp([
      { t: -5, color: RED },
      { t: 9, color: BLUE },
    ]);
    const ref = bakeRamp([
      { t: 0, color: RED },
      { t: 1, color: BLUE },
    ]);
    expect(Array.from(px)).toEqual(Array.from(ref));
  });

  it("throws for an empty stop list", () => {
    expect(() => bakeRamp([])).toThrow();
  });
});
