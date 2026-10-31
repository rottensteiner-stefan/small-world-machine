import { describe, expect, it } from "vitest";
import { Color } from "@small-world-machine/engine";
import { COLOR_RAMP_MAX_STOPS, ColorRamp } from "../src/math/ColorRamp.js";

function evaluate(r: ColorRamp, t: number, out: Color): void {
  r.evaluateInto(t, out);
}

describe("ColorRamp", () => {
  it("reproduces stop colors exactly at stops (segment exactness)", () => {
    const ramp = new ColorRamp();
    const a = new Color(1, 0, 0, 1);
    const b = new Color(0, 1, 0, 0.5);
    const c = new Color(0, 0, 1, 0);
    ramp.addStop(0, a);
    ramp.addStop(0.5, b);
    ramp.addStop(1, c);
    const out = new Color();
    evaluate(ramp, 0, out);
    expect(out.r).toBe(1);
    expect(out.g).toBe(0);
    evaluate(ramp, 0.5, out);
    expect(out.g).toBe(1);
    expect(out.a).toBe(0.5);
    evaluate(ramp, 1, out);
    expect(out.b).toBe(1);
    expect(out.a).toBe(0);
  });

  it("interpolates linearly between stops", () => {
    const ramp = new ColorRamp();
    ramp.addStop(0, new Color(0, 0, 0, 0));
    ramp.addStop(1, new Color(1, 1, 1, 1));
    const out = new Color();
    evaluate(ramp, 0.5, out);
    expect(out.r).toBeCloseTo(0.5, 6);
    expect(out.a).toBeCloseTo(0.5, 6);
  });

  it("clamps out-of-range t", () => {
    const ramp = new ColorRamp();
    ramp.addStop(0.25, new Color(1, 1, 1, 1));
    ramp.addStop(0.75, new Color(0, 0, 0, 0));
    const out = new Color();
    evaluate(ramp, -2, out);
    expect(out.r).toBe(1);
    evaluate(ramp, 5, out);
    expect(out.r).toBe(0);
  });

  it("clamps inserted t and replaces duplicate t stops", () => {
    const ramp = new ColorRamp();
    ramp.addStop(-1, new Color(1, 0, 0, 1));
    ramp.addStop(0.5, new Color(0, 1, 0, 1));
    ramp.addStop(0.5, new Color(0, 0, 1, 1));
    expect(ramp.stopCount).toBe(2);
    const out = new Color();
    evaluate(ramp, 0.5, out);
    expect(out.b).toBe(1);
    expect(out.g).toBe(0);
    evaluate(ramp, -1, out);
    expect(out.r).toBe(1);
  });

  it("caps stops at COLOR_RAMP_MAX_STOPS", () => {
    const ramp = new ColorRamp();
    for (let i = 0; i < 12; i++) {
      ramp.addStop(i / 12, new Color(i / 12, 1, 0, 1));
    }
    expect(ramp.stopCount).toBe(COLOR_RAMP_MAX_STOPS);
    const out = new Color();
    evaluate(ramp, 1, out);
    expect(out.r).toBeCloseTo((COLOR_RAMP_MAX_STOPS - 1) / 12, 6);
  });

  it("clears all stops", () => {
    const ramp = new ColorRamp();
    ramp.addStop(0, new Color(1, 1, 1, 1));
    ramp.clear();
    expect(ramp.stopCount).toBe(0);
    const out = new Color();
    evaluate(ramp, 0.5, out);
    expect(out.r).toBe(1);
    expect(out.a).toBe(1);
  });

  it("copies stop colors so caller mutation does not leak in", () => {
    const ramp = new ColorRamp();
    const mutable = new Color(1, 0, 0, 1);
    ramp.addStop(0, mutable);
    mutable.r = 0.5;
    const out = new Color();
    evaluate(ramp, 0, out);
    expect(out.r).toBe(1);
  });
});
