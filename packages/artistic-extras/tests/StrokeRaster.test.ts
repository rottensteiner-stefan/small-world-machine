import { describe, it, expect } from "vitest";
import {
  buildStrokeSplats,
  hexWithAlpha,
  interpolateStrokeSteps,
  pressureToBrush,
} from "../src/math/StrokeRaster.js";

describe("StrokeRaster (pure math)", () => {
  it("maps pressure to a brush state non-linearly", () => {
    expect(pressureToBrush(0, 4, 20)).toEqual({ radius: 4, relief: 0, lift: 0 });
    const full = pressureToBrush(1, 4, 20);
    expect(full.radius).toBeCloseTo(20, 5);
    expect(full.relief).toBe(1);
    expect(full.lift).toBe(1);

    const mid = pressureToBrush(0.5, 4, 20);
    expect(mid.radius).toBeGreaterThan(4);
    expect(mid.radius).toBeLessThan(20);
    expect(mid.relief).toBeGreaterThan(0);
    expect(mid.relief).toBeLessThan(0.5); // quadratic ramp stays below linear midpoint

    // Monotonic: more pressure never shrinks the brush or relief.
    let prevR = -1;
    let prevRelief = -1;
    for (let i = 0; i <= 10; i++) {
      const b = pressureToBrush(i / 10, 4, 20);
      expect(b.radius).toBeGreaterThanOrEqual(prevR);
      expect(b.relief).toBeGreaterThanOrEqual(prevRelief);
      prevR = b.radius;
      prevRelief = b.relief;
    }
  });

  it("clamps out-of-range pressure", () => {
    expect(pressureToBrush(-2, 4, 20).radius).toBe(4);
    expect(pressureToBrush(5, 4, 20).radius).toBe(20);
  });

  it("returns only the destination for sub-step segments", () => {
    const steps = interpolateStrokeSteps({ x: 1, y: 1 }, { x: 2, y: 1 }, 32);
    expect(steps).toEqual([{ x: 2, y: 1 }]);
  });

  it("distance-stamps long segments with capped steps ending exactly at the target", () => {
    const steps = interpolateStrokeSteps({ x: 0, y: 0 }, { x: 1000, y: 0 }, 50);
    expect(steps.length).toBeGreaterThan(1);
    expect(steps.length).toBeLessThanOrEqual(256);
    const last = steps[steps.length - 1]!;
    expect(last.x).toBeCloseTo(1000, 5);
    expect(last.y).toBeCloseTo(0, 5);
    // Every splat stays on the segment line and consecutive steps are capped.
    for (const s of steps) {
      expect(Math.abs(s.y)).toBeLessThan(1e-9); // horizontal line
    }
    for (let i = 1; i < steps.length; i++) {
      const d = steps[i]!.x - steps[i - 1]!.x;
      expect(d).toBeGreaterThan(1e-9);
      expect(d).toBeLessThanOrEqual(50 + 1e-6);
    }
  });

  it("encodes stroke direction into plane-UV space", () => {
    // Rightward stroke: u grows (+u), dirU encodes > 0.5.
    const right = buildStrokeSplats({
      from: { x: 10, y: 10 },
      to: { x: 100, y: 10 },
      pressure: 0.8,
      baseRadius: 5,
      maxRadius: 18,
      maxStepPx: 20,
      colorHex: "#ff0000",
      canvasWidth: 200,
      canvasHeight: 100,
    });
    expect(right[0]!.dirU01).toBeGreaterThan(0.5);
    expect(right[0]!.dirV01).toBeCloseTo(0.5, 4);

    // Downward stroke in image space is negative v in plane-UV space.
    const down = buildStrokeSplats({
      from: { x: 10, y: 10 },
      to: { x: 10, y: 100 },
      pressure: 0.8,
      baseRadius: 5,
      maxRadius: 18,
      maxStepPx: 20,
      colorHex: "#ff0000",
      canvasWidth: 200,
      canvasHeight: 100,
    });
    expect(down[0]!.dirV01).toBeLessThan(0.5);
    expect(down[0]!.dirU01).toBeCloseTo(0.5, 4);
  });

  it("caps coverage and keeps encoded channels in range", () => {
    const splats = buildStrokeSplats({
      from: { x: 0, y: 0 },
      to: { x: 40, y: 0 },
      pressure: 0.95,
      baseRadius: 6,
      maxRadius: 20,
      maxStepPx: 15,
      colorHex: "#00ff00",
      canvasWidth: 200,
      canvasHeight: 100,
    });
    for (const s of splats) {
      expect(s.coverage).toBeLessThanOrEqual(0.9);
      expect(s.coverage).toBeGreaterThan(0);
      expect(s.dirU01).toBeGreaterThanOrEqual(0);
      expect(s.dirU01).toBeLessThanOrEqual(1);
      expect(s.dirV01).toBeGreaterThanOrEqual(0);
      expect(s.dirV01).toBeLessThanOrEqual(1);
    }
  });

  it("formats hex colors with alpha", () => {
    expect(hexWithAlpha("#ff0000", 1)).toBe("#ff0000ff");
    expect(hexWithAlpha("#ff0000", 0.5)).toBe("#ff000080");
    expect(hexWithAlpha("112233", 0)).toBe("#11223300");
    expect(hexWithAlpha("garbage", 0.5)).toContain("rgba(255, 255, 255,");
  });
});
