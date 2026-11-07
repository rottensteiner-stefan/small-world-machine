import { describe, it, expect } from "vitest";
import { Easing } from "../../src/index.js";

describe("Easing", () => {
  const curves: [string, (t: number) => number][] = [
    ["linear", Easing.linear],
    ["smoothstep", Easing.smoothstep],
    ["easeInQuad", Easing.easeInQuad],
    ["easeOutQuad", Easing.easeOutQuad],
    ["easeInOutQuad", Easing.easeInOutQuad],
    ["easeInCubic", Easing.easeInCubic],
    ["easeOutCubic", Easing.easeOutCubic],
    ["easeInOutCubic", Easing.easeInOutCubic],
    ["easeInSine", Easing.easeInSine],
    ["easeOutSine", Easing.easeOutSine],
    ["easeInOutSine", Easing.easeInOutSine],
  ];

  it.each(curves)("%s should map 0 to 0 and 1 to 1", (_name, fn) => {
    expect(fn(0)).toBeCloseTo(0);
    expect(fn(1)).toBeCloseTo(1);
  });

  it("linear should be the identity function", () => {
    expect(Easing.linear(0.3)).toBe(0.3);
    expect(Easing.linear(0.7)).toBe(0.7);
  });

  it("smoothstep should be symmetric around 0.5", () => {
    expect(Easing.smoothstep(0.5)).toBeCloseTo(0.5);
    expect(Easing.smoothstep(0.25)).toBeCloseTo(1 - Easing.smoothstep(0.75));
  });

  it("easeInQuad should start slower than linear", () => {
    expect(Easing.easeInQuad(0.5)).toBeLessThan(0.5);
  });

  it("easeOutQuad should start faster than linear", () => {
    expect(Easing.easeOutQuad(0.5)).toBeGreaterThan(0.5);
  });
});
