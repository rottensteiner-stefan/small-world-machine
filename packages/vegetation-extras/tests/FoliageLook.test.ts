import { describe, expect, it } from "vitest";
import {
  PostProcessingEffectType,
  PostProcessingGroup,
  ToneMappingMode,
} from "@small-world-machine/engine";
import type { ColorGradingElement, ToneMappingElement } from "@small-world-machine/engine";
import { applyFoliageLook, FOLIAGE_LOOKS } from "../src/look/FoliageLook.js";

describe("applyFoliageLook", () => {
  it("writes curve, exposure and grade and enables both elements", () => {
    const group = new PostProcessingGroup();
    applyFoliageLook(group, FOLIAGE_LOOKS.FOREST_SHADE);
    const tone = group.get<ToneMappingElement>(PostProcessingEffectType.TONE_MAPPING)!;
    const grade = group.get<ColorGradingElement>(PostProcessingEffectType.COLOR_GRADING)!;
    expect(tone.enabled).toBe(true);
    expect(tone.mode).toBe(ToneMappingMode.AGX);
    expect(tone.exposure).toBe(FOLIAGE_LOOKS.FOREST_SHADE.exposure);
    expect(grade.enabled).toBe(true);
    expect(grade.saturation).toBe(FOLIAGE_LOOKS.FOREST_SHADE.saturation);
    expect([grade.lift.r, grade.lift.g, grade.lift.b]).toEqual([
      ...FOLIAGE_LOOKS.FOREST_SHADE.lift,
    ]);
  });

  it("restores the identity grade with NEUTRAL", () => {
    const group = new PostProcessingGroup();
    applyFoliageLook(group, FOLIAGE_LOOKS.SUNNY_MEADOW);
    applyFoliageLook(group, FOLIAGE_LOOKS.NEUTRAL);
    const grade = group.get<ColorGradingElement>(PostProcessingEffectType.COLOR_GRADING)!;
    expect(grade.contrast).toBe(1);
    expect(grade.saturation).toBe(1);
    expect(grade.temperature).toBe(0);
    expect([grade.gain.r, grade.gain.g, grade.gain.b]).toEqual([1, 1, 1]);
  });

  it("keeps every preset grade subtle (no stylised looks)", () => {
    for (const look of Object.values(FOLIAGE_LOOKS)) {
      expect(look.exposure).toBeGreaterThan(0.8);
      expect(look.exposure).toBeLessThan(1.6);
      expect(Math.abs(look.saturation - 1)).toBeLessThanOrEqual(0.2);
      expect(Math.abs(look.temperature)).toBeLessThanOrEqual(0.1);
    }
  });
});
