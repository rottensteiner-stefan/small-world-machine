import { describe, expect, it } from "vitest";
import { Scene } from "../../src/core/Scene.js";
import { GridLevelBuilder } from "../../src/geometry/procgen/GridLevelBuilder.js";
import type { GridLevelConfig } from "../../src/geometry/procgen/GridLevelBuilder.js";

const config: GridLevelConfig = {
  gridSize: 2,
  legend: {
    P: { type: "floor", isSpawn: true },
    Q: { type: "floor", isSpawn: true },
    ".": { type: "floor" },
  },
};

describe("GridLevelBuilder.build spawn", () => {
  it("returns the world position of the first spawn tile", async () => {
    // 3x3 map, gridSize 2: tile (x=2, y=0) -> world (2*2 - 3 + 1, 0*2 - 3 + 1) = (2, -2)
    const start = await new GridLevelBuilder().build(new Scene(), "..P\n...\n..Q", config);
    expect(start.x).toBe(2);
    expect(start.y).toBe(0);
    expect(start.z).toBe(-2);
  });

  it("falls back to the map center (origin) without a spawn tile", async () => {
    const start = await new GridLevelBuilder().build(new Scene(), "...\n...", config);
    expect(start.x).toBe(0);
    expect(start.z).toBe(0);
  });
});
