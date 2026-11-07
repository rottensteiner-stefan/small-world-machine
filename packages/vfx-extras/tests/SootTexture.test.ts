import { describe, expect, it } from "vitest";
import { bakeSootPixels } from "../src/fire/soot.js";

const SIZE = 256;

/** Largest absolute step of channel `ch` between horizontally/vertically adjacent pixels. */
function maxNeighbourStep(px: Uint8ClampedArray, ch: number): number {
  let max = 0;
  for (let y = 0; y < SIZE - 1; y++) {
    for (let x = 0; x < SIZE - 1; x++) {
      const i = (y * SIZE + x) * 4 + ch;
      max = Math.max(max, Math.abs(px[i]! - px[i + 4]!), Math.abs(px[i]! - px[i + SIZE * 4]!));
    }
  }
  return max;
}

describe("bakeSootPixels", () => {
  it("is deterministic: identical bytes on every call", () => {
    expect(bakeSootPixels()).toEqual(bakeSootPixels());
  });

  it("has no block-quantised noise: speckle and rim drift vary smoothly between neighbours", () => {
    const px = bakeSootPixels();
    // Integer-truncated hashing produced flat ~9px (speckle) / ~23px (rim drift) blocks whose borders
    // jump by up to ~12 gray levels / ~23 alpha levels. Smooth value noise steps by only a few levels.
    expect(maxNeighbourStep(px, 1)).toBeLessThanOrEqual(5);
    expect(maxNeighbourStep(px, 3)).toBeLessThanOrEqual(8);
  });
});
