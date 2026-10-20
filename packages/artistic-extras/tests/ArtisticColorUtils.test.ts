import { describe, it, expect } from "vitest";
import { ArtisticColorUtils } from "../src/math/ArtisticColorUtils.js";
import { Color } from "@small-world-machine/engine";

describe("ArtisticColorUtils", () => {
  it("converts RGB to HSV and back accurately", () => {
    // Pure Red
    const hsvRed = ArtisticColorUtils.rgbToHsv(1, 0, 0);
    expect(hsvRed.h).toBeCloseTo(0.0, 3);
    expect(hsvRed.s).toBeCloseTo(1.0, 3);
    expect(hsvRed.v).toBeCloseTo(1.0, 3);

    const rgbRed = ArtisticColorUtils.hsvToRgb(hsvRed.h, hsvRed.s, hsvRed.v);
    expect(rgbRed[0]).toBeCloseTo(1.0, 3);
    expect(rgbRed[1]).toBeCloseTo(0.0, 3);
    expect(rgbRed[2]).toBeCloseTo(0.0, 3);

    // Green
    const hsvGreen = ArtisticColorUtils.rgbToHsv(0, 1, 0);
    expect(hsvGreen.h).toBeCloseTo(1 / 3, 3);

    // Blue
    const hsvBlue = ArtisticColorUtils.rgbToHsv(0, 0, 1);
    expect(hsvBlue.h).toBeCloseTo(2 / 3, 3);
  });

  it("calculates cyclic hue distances correctly across the 0/1 seam", () => {
    expect(ArtisticColorUtils.hueDistance(0.02, 0.04)).toBeCloseTo(0.02, 4);
    expect(ArtisticColorUtils.hueDistance(0.98, 0.02)).toBeCloseTo(0.04, 4);
    expect(ArtisticColorUtils.hueDistance(0.0, 0.5)).toBeCloseTo(0.5, 4);
  });

  it("evaluates selective color pop mask factor for red vs non-red hues", () => {
    const pureRed = new Color(1, 0, 0);
    const crimson = new Color(0.85, 0.1, 0.2);
    const steelBlue = new Color(0.4, 0.5, 0.6);
    const asphaltGray = new Color(0.3, 0.3, 0.3);

    // Red and crimson should yield high mask values
    const maskRed = ArtisticColorUtils.computeColorPopMask(pureRed, 0.0, 0.1, 0.2);
    expect(maskRed).toBeGreaterThan(0.9);

    const maskCrimson = ArtisticColorUtils.computeColorPopMask(crimson, 0.0, 0.12, 0.2);
    expect(maskCrimson).toBeGreaterThan(0.7);

    // Steel blue and neutral gray should yield 0
    const maskSteel = ArtisticColorUtils.computeColorPopMask(steelBlue, 0.0, 0.1, 0.2);
    expect(maskSteel).toBe(0.0);

    const maskGray = ArtisticColorUtils.computeColorPopMask(asphaltGray, 0.0, 0.1, 0.2);
    expect(maskGray).toBe(0.0);
  });

  it("grades achromatic luma into warm rust in shadows and cool zinc in highlights", () => {
    const shadowRamped = ArtisticColorUtils.gradeIndustrialMetal(0.1, 0.8);
    // In deep shadow with high rust strength, red should dominate green and blue (warm rust)
    expect(shadowRamped[0]).toBeGreaterThan(shadowRamped[1]);
    expect(shadowRamped[1]).toBeGreaterThan(shadowRamped[2]);

    const highlightRamped = ArtisticColorUtils.gradeIndustrialMetal(0.9, 0.8);
    // In highlights, values are bright and close to neutral/cool zinc
    expect(highlightRamped[0]).toBeGreaterThan(0.7);
    expect(highlightRamped[1]).toBeGreaterThan(0.7);
    expect(highlightRamped[2]).toBeGreaterThan(0.7);
  });
});
