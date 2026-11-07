import { describe, expect, it } from "vitest";
import { analyseRgb } from "../../.agents/scripts/lib/normal-map-stats.js";

describe(".agents/scripts/lib/normal-map-stats analyseRgb()", () => {
  it("returns null for a 1xN texture instead of NaN stats that pass every threshold", () => {
    const rgb = new Uint8Array(1 * 4 * 3).fill(128);
    expect(analyseRgb(rgb, 1, 4)).toBeNull();
  });

  it("returns null for an empty image", () => {
    expect(analyseRgb(new Uint8Array(0), 0, 0)).toBeNull();
  });

  it("flags a flat (128,128,255) normal map as clean-ish with finite stats", () => {
    const rgb = new Uint8Array(4 * 4 * 3);
    for (let i = 0; i < 16; i++) rgb.set([128, 128, 255], i * 3);
    const v = analyseRgb(rgb, 4, 4)!;
    expect(v.greyscale).toBe(0);
    expect(v.meanBlue).toBeCloseTo(1);
    expect(v.neighbourDeg).toBeCloseTo(0, 3);
  });

  it("detects a greyscale image", () => {
    const rgb = new Uint8Array(4 * 4 * 3).fill(100);
    expect(analyseRgb(rgb, 4, 4)!.greyscale).toBe(1);
  });
});
