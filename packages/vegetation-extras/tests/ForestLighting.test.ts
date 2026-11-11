import { describe, expect, it } from "vitest";
import {
  PostProcessingEffectType,
  ToneMappingMode,
  type PostProcessingGroup,
} from "@small-world-machine/engine";
import {
  buildCanopyGroundAo,
  canopyCoverageAt,
  canopyHeightFade,
  type CanopyCoverageMap,
} from "../src/canopy/CanopyCoverage.js";
import { FOLIAGE_LOOKS } from "../src/look/FoliageLook.js";
import { ForestLookBlender } from "../src/look/ForestLookBlender.js";

const MAP: CanopyCoverageMap = {
  data: new Uint8Array([0, 255, 128, 64]),
  width: 2,
  height: 2,
  originX: -2,
  originZ: -2,
  cellSize: 2,
};

describe("canopy helpers", () => {
  it("samples the nearest cell and returns 0 outside the map", () => {
    expect(canopyCoverageAt(MAP, -1, -1)).toBe(0);
    expect(canopyCoverageAt(MAP, 1, -1)).toBe(1);
    expect(canopyCoverageAt(MAP, 5, 0)).toBe(0);
  });

  it("fades the below-canopy weight from 35 % of the crown height to 0 at the top", () => {
    expect(canopyHeightFade(1, 10)).toBe(1);
    expect(canopyHeightFade(10, 10)).toBe(0);
    const mid = canopyHeightFade(6.75, 10);
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.7);
  });

  it("bakes ground AO = 1 - (1 - floor) * coverage with row 0 at +Z", () => {
    const ao = buildCanopyGroundAo(MAP, 0.2, 4, 2);
    expect(ao.size).toBe(2);
    // Row 0 = +Z half (z = +1), column 1 = +X: map cell (1,1) = 64/255 coverage.
    expect(ao.data[(0 * 2 + 1) * 4]!).toBe(Math.round((1 - 0.8 * (64 / 255)) * 255));
    // Row 1 = -Z half, column 1: map cell (1,0) = full cover -> floor.
    expect(ao.data[(1 * 2 + 1) * 4]!).toBe(Math.round(0.2 * 255));
  });
});

function fakePost(): {
  group: PostProcessingGroup;
  tone: Record<string, unknown>;
  grade: Record<string, unknown>;
} {
  const color = (): { r: number; g: number; b: number } => ({ r: 0, g: 0, b: 0 });
  const tone: Record<string, unknown> = { enabled: false };
  const grade: Record<string, unknown> = {
    enabled: false,
    lift: color(),
    gamma: color(),
    gain: color(),
  };
  const group = {
    get: (type: PostProcessingEffectType) =>
      type === PostProcessingEffectType.TONE_MAPPING
        ? tone
        : type === PostProcessingEffectType.COLOR_GRADING
          ? grade
          : undefined,
  } as unknown as PostProcessingGroup;
  return { group, tone, grade };
}

describe("ForestLookBlender", () => {
  it("snaps on deltaTime 0, keeps the open tone curve and blends exposure", () => {
    const { group, tone } = fakePost();
    const b = new ForestLookBlender(FOLIAGE_LOOKS.SUNNY_MEADOW, FOLIAGE_LOOKS.FOREST_SHADE);
    expect(b.update(group, 1, 0)).toBe(true);
    expect(tone["mode"]).toBe(FOLIAGE_LOOKS.SUNNY_MEADOW.toneMapping);
    expect(tone["mode"]).not.toBe(ToneMappingMode.AGX);
    expect(tone["exposure"]).toBeCloseTo(FOLIAGE_LOOKS.FOREST_SHADE.exposure, 5);
  });

  it("eases toward the target and skips re-applying below 0.01 change", () => {
    const { group } = fakePost();
    const b = new ForestLookBlender(FOLIAGE_LOOKS.SUNNY_MEADOW, FOLIAGE_LOOKS.FOREST_SHADE, 1);
    b.update(group, 0, 0);
    b.update(group, 1, 0.1);
    expect(b.weight).toBeCloseTo(0.1, 5);
    expect(b.update(group, 0.1, 0.0001)).toBe(false);
  });
});
