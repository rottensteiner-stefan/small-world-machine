import { describe, it, expect } from "vitest";
import { MathUtils } from "../../src/index.js";

describe("MathUtils", () => {
  it("should convert deg to rad correctly", () => {
    expect(MathUtils.degToRad(180)).toBeCloseTo(Math.PI);
    expect(MathUtils.degToRad(90)).toBeCloseTo(Math.PI / 2);
  });

  it("should convert rad to deg correctly", () => {
    expect(MathUtils.radToDeg(Math.PI)).toBe(180);
    expect(MathUtils.radToDeg(Math.PI / 2)).toBe(90);
  });

  it("should clamp values correctly", () => {
    expect(MathUtils.clamp(5, 0, 10)).toBe(5);
    expect(MathUtils.clamp(-5, 0, 10)).toBe(0);
    expect(MathUtils.clamp(15, 0, 10)).toBe(10);
  });

  it("should generate a valid UUID format", () => {
    const uuid = MathUtils.generateUUID();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it("fastSin approximates Math.sin over the whole domain within a bounded error", () => {
    // The only thing that gives this approximation meaning is how close it stays to the reference
    // across the domain -- three endpoint pins say nothing about the lookup band in between. The
    // current implementation is exact; the 1e-3 bound is what a future legitimate LUT must hold to.
    const STEPS = 20000;
    for (let i = 0; i <= STEPS; i++) {
      const x = (i / STEPS) * Math.PI * 8 - Math.PI * 4;
      const err = Math.abs(MathUtils.fastSin(x) - Math.sin(x));
      expect(err, `fastSin diverges at x=${x}`).toBeLessThan(1e-3);
    }
  });

  it("fastCos approximates Math.cos over the whole domain within a bounded error", () => {
    const STEPS = 20000;
    for (let i = 0; i <= STEPS; i++) {
      const x = (i / STEPS) * Math.PI * 8 - Math.PI * 4;
      const err = Math.abs(MathUtils.fastCos(x) - Math.cos(x));
      expect(err, `fastCos diverges at x=${x}`).toBeLessThan(1e-3);
    }
  });

  it("should lerp between two numbers correctly", () => {
    expect(MathUtils.lerp(0, 10, 0.5)).toBe(5);
    expect(MathUtils.lerp(0, 10, 0)).toBe(0);
    expect(MathUtils.lerp(0, 10, 1)).toBe(10);
    expect(MathUtils.lerp(5, 15, 0.25)).toBe(7.5);
  });

  it("should calculate smoothstep correctly", () => {
    expect(MathUtils.smoothstep(0, 10, -5)).toBe(0);
    expect(MathUtils.smoothstep(0, 10, 15)).toBe(1);
    expect(MathUtils.smoothstep(0, 10, 0)).toBe(0);
    expect(MathUtils.smoothstep(0, 10, 10)).toBe(1);
    expect(MathUtils.smoothstep(0, 10, 5)).toBeCloseTo(0.5);
    expect(MathUtils.smoothstep(0, 1, 0.25)).toBeCloseTo(0.25 * 0.25 * (3 - 2 * 0.25));
  });

  it("should calculate smootherstep correctly", () => {
    expect(MathUtils.smootherstep(0, 10, -5)).toBe(0);
    expect(MathUtils.smootherstep(0, 10, 15)).toBe(1);
    expect(MathUtils.smootherstep(0, 10, 0)).toBe(0);
    expect(MathUtils.smootherstep(0, 10, 10)).toBe(1);
    expect(MathUtils.smootherstep(0, 10, 5)).toBeCloseTo(0.5);
    const t = 0.3;
    const expected = t * t * t * (t * (t * 6 - 15) + 10);
    expect(MathUtils.smootherstep(0, 1, t)).toBeCloseTo(expected);
  });

  it("should calculate inverseLerp correctly", () => {
    expect(MathUtils.inverseLerp(0, 10, 5)).toBe(0.5);
    expect(MathUtils.inverseLerp(10, 20, 15)).toBe(0.5);
    expect(MathUtils.inverseLerp(0, 100, 25)).toBe(0.25);
    expect(MathUtils.inverseLerp(5, 5, 5)).toBe(0);
  });

  it("should calculate damp correctly (frame-rate-independent approach toward target)", () => {
    const start = 0;
    const target = 10;
    const lambda = 5;
    const dt = 0.1;

    // dt=0 leaves the value untouched.
    expect(MathUtils.damp(start, target, lambda, 0)).toBe(start);
    // lambda=0 never moves.
    expect(MathUtils.damp(start, target, 0, dt)).toBe(start);
    // A single step moves strictly toward the target without overshooting.
    const one = MathUtils.damp(start, target, lambda, dt);
    expect(one).toBeGreaterThan(start);
    expect(one).toBeLessThan(target);
    // Repeating the step converges monotonically toward the target without overshooting. Once the
    // increment underflows to 0 in floating point, further steps make no progress -- so the loop
    // must tolerate saturation instead of asserting strict progress forever.
    let value = start;
    let iterations = 0;
    while (target - value > 1e-6 && iterations < 100000) {
      const next = MathUtils.damp(value, target, lambda, dt);
      expect(next).toBeGreaterThanOrEqual(value - 1e-9);
      expect(next).toBeLessThan(target);
      value = next;
      iterations++;
    }
    expect(target - value).toBeLessThan(1e-6);
    // Downward case mirrors the upward one (target below start).
    const down = MathUtils.damp(target, start, lambda, dt);
    expect(down).toBeLessThan(target);
    expect(down).toBeGreaterThan(start);
  });

  it("should check isPowerOfTwo correctly", () => {
    expect(MathUtils.isPowerOfTwo(1)).toBe(true);
    expect(MathUtils.isPowerOfTwo(2)).toBe(true);
    expect(MathUtils.isPowerOfTwo(4)).toBe(true);
    expect(MathUtils.isPowerOfTwo(16)).toBe(true);
    expect(MathUtils.isPowerOfTwo(1024)).toBe(true);
    expect(MathUtils.isPowerOfTwo(0)).toBe(false);
    expect(MathUtils.isPowerOfTwo(-4)).toBe(false);
    expect(MathUtils.isPowerOfTwo(3)).toBe(false);
    expect(MathUtils.isPowerOfTwo(15)).toBe(false);
  });

  it("should calculate nextPowerOfTwo correctly", () => {
    expect(MathUtils.nextPowerOfTwo(1)).toBe(1);
    expect(MathUtils.nextPowerOfTwo(2)).toBe(2);
    expect(MathUtils.nextPowerOfTwo(3)).toBe(4);
    expect(MathUtils.nextPowerOfTwo(4)).toBe(4);
    expect(MathUtils.nextPowerOfTwo(5)).toBe(8);
    expect(MathUtils.nextPowerOfTwo(1000)).toBe(1024);
  });
});
