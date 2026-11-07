import { describe, expect, it } from "vitest";
import { Curve1D } from "../src/math/Curve1D.js";

describe("Curve1D", () => {
  it("evaluates exact values at every key (segment exactness)", () => {
    const c = new Curve1D();
    c.setPoints([
      { t: 0, value: 1 },
      { t: 0.5, value: 3 },
      { t: 1, value: 10 },
    ]);
    expect(c.evaluate(0)).toBe(1);
    expect(c.evaluate(0.5)).toBe(3);
    expect(c.evaluate(1)).toBe(10);
  });

  it("interpolates linearly between keys", () => {
    const c = new Curve1D();
    c.setPoints([
      { t: 0.25, value: 0 },
      { t: 0.75, value: 8 },
    ]);
    expect(c.evaluate(0.5)).toBeCloseTo(4, 6);
  });

  it("clamps out-of-range inputs instead of extrapolating", () => {
    const c = new Curve1D();
    c.setPoints([
      { t: 0.2, value: 2 },
      { t: 0.8, value: 6 },
    ]);
    expect(c.evaluate(-1)).toBe(2);
    expect(c.evaluate(2)).toBe(6);
  });

  it("clamps inserted t into [0, 1]", () => {
    const c = new Curve1D();
    c.setPoints([
      { t: -5, value: 1 },
      { t: 9, value: 2 },
    ]);
    expect(c.evaluate(-1)).toBe(1);
    expect(c.evaluate(2)).toBe(2);
  });

  it("sorts unsorted points and collapses duplicate t to the last value", () => {
    const c = new Curve1D();
    c.setPoints([
      { t: 1, value: 10 },
      { t: 0, value: 1 },
      { t: 0.5, value: 3 },
      { t: 0.5, value: 4 },
    ]);
    expect(c.pointCount).toBe(3);
    expect(c.evaluate(0.5)).toBe(4);
  });

  it("is inert when empty", () => {
    const c = new Curve1D();
    expect(c.evaluate(0.5)).toBe(0);
    expect(c.pointCount).toBe(0);
  });

  it("respects capacity and drops non-finite points", () => {
    const c = new Curve1D(2);
    c.setPoints([
      { t: 0, value: 1 },
      { t: 1, value: 2 },
      { t: 0.5, value: 3 },
      { t: Number.NaN, value: 4 },
      { t: 0.25, value: Number.NaN },
    ]);
    expect(c.pointCount).toBe(2);
    expect(c.evaluate(0.25)).toBeCloseTo(1.25, 6); // {t:0,v:1}..{t:1,v:2}; 0.5er/NaN-Punkte verworfen
  });

  it("reports derived min/max values", () => {
    const c = new Curve1D();
    c.setPoints([
      { t: 0.5, value: 5 },
      { t: 1, value: -2 },
    ]);
    expect(c.minValue).toBe(-2);
    expect(c.maxValue).toBe(5);
  });

  it("clones independently of the source", () => {
    const c = new Curve1D();
    c.setPoints([
      { t: 0, value: 1 },
      { t: 1, value: 2 },
    ]);
    const d = c.clone();
    d.setPoints([{ t: 0, value: 99 }]);
    expect(c.evaluate(1)).toBe(2);
    expect(d.evaluate(1)).toBe(99);
  });
});

describe("Curve1D duplicate key time (float32 rounding)", () => {
  it("two keys at t=0.3 collapse to the last value (keys are compared after float32 storage)", () => {
    const c = new Curve1D();
    c.setPoints([
      { t: 0, value: 0 },
      { t: 0.3, value: 1 },
      { t: 0.3, value: 2 },
      { t: 1, value: 0 },
    ]);
    expect(c.evaluate(Math.fround(0.3))).toBe(2);
  });
});

describe("Curve1D float32 evaluation", () => {
  const f = Math.fround;
  const c = new Curve1D();
  c.setPoints([
    { t: 0, value: 0.1 },
    { t: 0.37, value: 0.93 },
    { t: 1, value: 0.21 },
  ]);

  it("every interpolated sample is exactly representable as float32", () => {
    for (let i = 1; i < 200; i++) {
      const v = c.evaluate(i / 200);
      expect(v).toBe(f(v));
    }
  });

  it("matches an independent float32 evaluation of the segment bit-exactly", () => {
    const t0 = f(0.37);
    const t1 = f(1);
    const v0 = f(0.93);
    const v1 = f(0.21);
    for (const t of [0.4, 0.55, 0.7123, 0.99]) {
      const expected = f(v0 + f(f(v1 - v0) * f(f(f(t) - t0) / f(t1 - t0))));
      expect(c.evaluate(t)).toBe(expected);
    }
  });

  it("a double query that rounds to a key returns the key value bit-exact", () => {
    expect(c.evaluate(0.37)).toBe(f(0.93));
  });

  it("NaN clamps to the first value instead of returning NaN", () => {
    expect(c.evaluate(Number.NaN)).toBe(f(0.1));
  });
});
