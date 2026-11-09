import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AUTO_EXPOSURE_GRID,
  AUTO_EXPOSURE_KEY,
  AutoExposureElement,
  autoExposureStep,
} from "../../src/renderers/post/elements/AutoExposureElement.js";
import { PostProcessingGroup } from "../../src/renderers/post/PostProcessingGroup.js";
import { PostProcessingEffectType } from "../../src/enums/index.js";

const SHADERS = join(__dirname, "../../src/renderers/post/shaders");
const read = (name: string): string => readFileSync(join(SHADERS, name), "utf8");

describe("AutoExposureElement (ADR 0061)", () => {
  it("is registered in every group and off by default (existing scenes unchanged)", () => {
    const element = new PostProcessingGroup().get<AutoExposureElement>(
      PostProcessingEffectType.AUTO_EXPOSURE,
    );
    expect(element).toBeInstanceOf(AutoExposureElement);
    expect(element!.enabled).toBe(false);
  });
});

describe("autoExposureStep (CPU mirror of the adapt shader)", () => {
  const el = new AutoExposureElement();

  it("maps a middle-grey frame to EV 0 (multiplier 1)", () => {
    expect(autoExposureStep(0, Math.log2(AUTO_EXPOSURE_KEY), 1, el, true)).toBeCloseTo(0, 10);
  });

  it("brightens dark frames and darkens bright ones, clamped to [minEv, maxEv]", () => {
    expect(autoExposureStep(0, Math.log2(AUTO_EXPOSURE_KEY / 4), 0, el, true)).toBeCloseTo(2, 10);
    expect(autoExposureStep(0, -20, 0, el, true)).toBe(el.maxEv);
    expect(autoExposureStep(0, 20, 0, el, true)).toBe(el.minEv);
  });

  it("applies the compensation as a plain EV offset", () => {
    const comp = new AutoExposureElement();
    comp.compensationEv = 0.5;
    expect(autoExposureStep(0, Math.log2(AUTO_EXPOSURE_KEY), 0, comp, true)).toBeCloseTo(0.5, 10);
  });

  it("adapts slower into the dark than into the light (asymmetric rates)", () => {
    const toDark = autoExposureStep(0, Math.log2(AUTO_EXPOSURE_KEY / 4), 0.1, el, false);
    const toBright = autoExposureStep(0, Math.log2(AUTO_EXPOSURE_KEY * 4), 0.1, el, false);
    expect(toDark).toBeGreaterThan(0);
    expect(toBright).toBeLessThan(0);
    expect(toDark).toBeLessThan(-toBright);
  });

  it("converges monotonically and is frame-rate independent", () => {
    const target = Math.log2(AUTO_EXPOSURE_KEY / 4);
    let ev60 = 0;
    for (let i = 0; i < 60; i++) ev60 = autoExposureStep(ev60, target, 1 / 60, el, false);
    let ev30 = 0;
    for (let i = 0; i < 30; i++) ev30 = autoExposureStep(ev30, target, 1 / 30, el, false);
    expect(ev60).toBeGreaterThan(0);
    expect(ev60).toBeLessThan(2);
    expect(ev60).toBeCloseTo(ev30, 10);
  });
});

describe("auto exposure shaders: two-dialect parity", () => {
  const adapt = {
    wgsl: read("AutoExposureAdapt.frag.wgsl"),
    glsl: read("AutoExposureAdapt.frag.glsl"),
  };
  const lum = {
    wgsl: read("AutoExposureLuminance.frag.wgsl"),
    glsl: read("AutoExposureLuminance.frag.glsl"),
  };

  for (const [dialect, source] of Object.entries(adapt)) {
    it(`${dialect}: key and grid match the CPU constants`, () => {
      const key = Number(/LOG2_KEY[^=]*=\s*(-?[0-9.]+)/.exec(source)![1]);
      expect(key).toBeCloseTo(Math.log2(AUTO_EXPOSURE_KEY), 10);
      expect(source).toMatch(new RegExp(`GRID[^=]*=\\s*${AUTO_EXPOSURE_GRID}\\b`));
      expect(source).toMatch(/exp2\(ev\), ev/);
    });
  }

  for (const [dialect, source] of Object.entries(lum)) {
    it(`${dialect}: Rec.709 luminance, 4x4 taps over a 1/64 spacing, center weighting`, () => {
      expect(source).toContain("0.2126, 0.7152, 0.0722");
      expect(source).toMatch(/TAPS_PER_AXIS[^=]*=\s*4\b/);
      expect(source).toMatch(/TAP_SPACING[^=]*=\s*1\.0 \/ 64\.0/);
      expect(source).toMatch(/max\(1\.0 - radius, MIN_WEIGHT\)/);
    });
  }

  it("both uber shaders scale the radiance by the 1x1 exposure texture before the tone curve", () => {
    expect(read("PostProcess.frag.wgsl")).toMatch(
      /hdr \*= textureLoad\(autoExposureTexture, vec2i\(0, 0\), 0\)\.r;\s*\n\s*let tonemapped/,
    );
    expect(read("PostProcess.frag.glsl")).toMatch(
      /hdr \*= texelFetch\(u_autoExposureTexture, ivec2\(0\), 0\)\.r;\s*\n\s*vec3 tonemapped/,
    );
    expect(read("PostProcess100.frag.glsl")).not.toContain("autoExposure");
  });
});
