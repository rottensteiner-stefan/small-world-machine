import { describe, expect, it } from "vitest";
import { POOL_CELLS } from "../PoolLayout.js";
import { POOL_PRESETS } from "../PoolPresets.js";

describe("Showcase 10 pool presets", () => {
  it("define exactly one preset per grid cell", () => {
    const keys = POOL_PRESETS.map((preset) => preset.key).sort();
    expect(keys).toEqual(Object.keys(POOL_CELLS).sort());
  });

  it("use unique pool names", () => {
    const names = new Set(POOL_PRESETS.map((preset) => preset.name));
    expect(names.size).toBe(POOL_PRESETS.length);
  });
});
