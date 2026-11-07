import { describe, it, expect } from "vitest";
import {
  DepthOfFieldElement,
  computeCocScalePx,
  computeSignedCocPx,
} from "../../../../src/renderers/post/elements/DepthOfFieldElement.js";
import { PostProcessingGroup } from "../../../../src/renderers/post/PostProcessingGroup.js";
import { PostProcessingEffectType } from "../../../../src/enums/index.js";

describe("DepthOfFieldElement", () => {
  it("initializes with a 50 mm f/2 full-frame lens focused at 2 m", () => {
    const elem = new DepthOfFieldElement();

    expect(elem.type).toBe(PostProcessingEffectType.DEPTH_OF_FIELD);
    expect(elem.enabled).toBe(false);
    expect(elem.focusDistance).toBeCloseTo(2.0);
    expect(elem.focalLength).toBeCloseTo(50);
    expect(elem.fStop).toBeCloseTo(2.0);
    expect(elem.sensorHeight).toBeCloseTo(24);
    expect(elem.maxCocRatio).toBeCloseTo(0.015);
    expect(elem.focusScreenY).toBeCloseTo(0.5);
    expect(elem.structuralKey()).toBe("0");
  });

  it("is registered within PostProcessingGroup and requests the opaque depth capture when enabled", () => {
    const group = new PostProcessingGroup();
    const elem = group.get<DepthOfFieldElement>(PostProcessingEffectType.DEPTH_OF_FIELD);

    expect(elem).toBeInstanceOf(DepthOfFieldElement);
    expect(group.requiresOpaqueDepth).toBe(false);
    elem!.enabled = true;
    expect(group.requiresOpaqueDepth).toBe(true);
  });

  it("loads its lens settings from the post-processing config", () => {
    const group = new PostProcessingGroup();
    group.loadConfig({
      effects: {
        depthOfField: {
          enabled: true,
          focusDistance: 0.6,
          focalLength: 85,
          fStop: 1.4,
          maxCocRatio: 0.02,
        },
      },
    });
    const elem = group.get<DepthOfFieldElement>(PostProcessingEffectType.DEPTH_OF_FIELD)!;

    expect(elem.enabled).toBe(true);
    expect(elem.focusDistance).toBeCloseTo(0.6);
    expect(elem.focalLength).toBeCloseTo(85);
    expect(elem.fStop).toBeCloseTo(1.4);
    expect(elem.maxCocRatio).toBeCloseTo(0.02);
    expect(elem.sensorHeight).toBeCloseTo(24);
  });

  it("scales the CoC cap with the render height, so 1x and 2x DPR buffers look the same", () => {
    const elem = new DepthOfFieldElement();
    elem.maxCocRatio = 0.02;

    expect(elem.maxCocPx(1080)).toBeCloseTo(21.6);
    expect(elem.maxCocPx(2160) / 2160).toBeCloseTo(elem.maxCocPx(1080) / 1080);
  });
});

describe("thin-lens circle of confusion", () => {
  it("matches c(d) = A·f·|d − d_f| / (d·(d_f − f)) converted to pixels", () => {
    const f = 0.05;
    const n = 2;
    const df = 2;
    const d = 5;
    const sensor = 0.024;
    const heightPx = 1080;
    const expectedMeters = ((f / n) * f * Math.abs(d - df)) / (d * (df - f));

    const scale = computeCocScalePx(50, n, df, 24, heightPx);
    expect(Math.abs(computeSignedCocPx(d, df, scale))).toBeCloseTo(
      (expectedMeters / sensor) * heightPx,
      6,
    );
  });

  it("is zero at the focus plane, negative in front and positive behind it", () => {
    const scale = computeCocScalePx(50, 2, 2, 24, 1080);
    expect(computeSignedCocPx(2, 2, scale)).toBeCloseTo(0);
    expect(computeSignedCocPx(1, 2, scale)).toBeLessThan(0);
    expect(computeSignedCocPx(10, 2, scale)).toBeGreaterThan(0);
    // Far-field asymptote is S itself.
    expect(computeSignedCocPx(1e9, 2, scale)).toBeCloseTo(scale, 4);
  });

  it("grows with a wider aperture and a longer lens", () => {
    const base = computeCocScalePx(50, 2, 2, 24, 1080);
    expect(computeCocScalePx(50, 1.4, 2, 24, 1080)).toBeGreaterThan(base);
    expect(computeCocScalePx(85, 2, 2, 24, 1080)).toBeGreaterThan(base);
    expect(computeCocScalePx(50, 8, 2, 24, 1080)).toBeLessThan(base);
  });

  it("stays finite when focused at or inside the focal length", () => {
    expect(Number.isFinite(computeCocScalePx(50, 2, 0.05, 24, 1080))).toBe(true);
    expect(Number.isFinite(computeCocScalePx(50, 2, 0.01, 24, 1080))).toBe(true);
  });

  it("element.cocScalePx delegates to the thin-lens scale", () => {
    const elem = new DepthOfFieldElement();
    expect(elem.cocScalePx(1080)).toBeCloseTo(computeCocScalePx(50, 2, 2, 24, 1080));
  });
});
