import { describe, it, expect } from "vitest";
import {
  isZeroDelta,
  nudgeRotationDelta,
  nudgeScaleDelta,
  nudgeTranslateDelta,
} from "../../src/maker/MakerNudge.js";

describe("MakerNudge", () => {
  it("translate follows the camera cardinal heading", () => {
    // camera looks along -Z: Up = -Z, Right = +X
    expect(nudgeTranslateDelta("ArrowUp", 1, 0, -1)).toEqual({ x: 0, y: 0, z: -1 });
    expect(nudgeTranslateDelta("ArrowRight", 1, 0, -1)).toEqual({ x: 1, y: 0, z: 0 });
    // camera looks along +X: Up = +X, Right = +Z
    expect(nudgeTranslateDelta("ArrowUp", 2, 1, 0)).toEqual({ x: 2, y: 0, z: 0 });
    expect(nudgeTranslateDelta("ArrowRight", 2, 1, 0)).toEqual({ x: 0, y: 0, z: 2 });
    // camera looks along +Z: Up = +Z, Right = -X
    expect(nudgeTranslateDelta("ArrowRight", 1, 0, 1)).toEqual({ x: -1, y: 0, z: 0 });
  });

  it("opposite keys cancel out; PageUp/Down move along Y", () => {
    const l = nudgeTranslateDelta("ArrowLeft", 0.5, 0.3, -0.9);
    const r = nudgeTranslateDelta("ArrowRight", 0.5, 0.3, -0.9);
    expect(l.x + r.x).toBe(0);
    expect(l.z + r.z).toBe(0);
    expect(nudgeTranslateDelta("PageUp", 0.5, 0, -1)).toEqual({ x: 0, y: 0.5, z: 0 });
  });

  it("a degenerate (straight-down) camera falls back to -Z forward", () => {
    expect(nudgeTranslateDelta("ArrowUp", 1, 0, 0)).toEqual({ x: 0, y: 0, z: -1 });
  });

  it("rotate and scale map keys to axes; unknown keys are zero", () => {
    expect(nudgeRotationDelta("ArrowLeft", 0.2)).toEqual({ x: 0, y: 0.2, z: 0 });
    expect(nudgeRotationDelta("PageDown", 0.2)).toEqual({ x: 0, y: 0, z: -0.2 });
    expect(nudgeScaleDelta("ArrowDown", 0.25)).toEqual({ x: 0, y: 0, z: 0.25 });
    expect(nudgeScaleDelta("PageUp", 0.25)).toEqual({ x: 0, y: 0.25, z: 0 });
    expect(isZeroDelta(nudgeScaleDelta("a", 1))).toBe(true);
    expect(isZeroDelta(nudgeRotationDelta("Home", 1))).toBe(true);
  });
});
