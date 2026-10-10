import { describe, expect, it } from "vitest";
import { resolveClipTimeScale } from "../scenes/flakturm-tunnel/clipTiming.js";

describe("resolveClipTimeScale", () => {
  it("stretches the 0.375s stairs_down clip to a 1s cycle", () => {
    expect(resolveClipTimeScale("stairs_down", 0.375)).toBeCloseTo(0.375, 5);
  });
  it("leaves other clips untouched", () => {
    expect(resolveClipTimeScale("stairs_up", 1.333)).toBe(1);
  });
  it("guards against zero-length clips", () => {
    expect(resolveClipTimeScale("stairs_down", 0)).toBe(1);
  });
});
