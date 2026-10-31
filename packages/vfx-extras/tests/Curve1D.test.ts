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
