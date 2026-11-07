import { describe, it, expect } from "vitest";
import { Color } from "../../../src/core/colors/Color.js";
import { COLOR_NAMES } from "../../../src/core/colors/ColorNames.js";

describe("Color", () => {
  it("creates a color with default or specified components", () => {
    const defaultColor = new Color();
    expect(defaultColor.r).toBe(0);
    expect(defaultColor.g).toBe(0);
    expect(defaultColor.b).toBe(0);
    expect(defaultColor.a).toBe(1.0);

    const customColor = new Color(0.2, 0.4, 0.6, 0.8);
    expect(customColor.r).toBe(0.2);
    expect(customColor.g).toBe(0.4);
    expect(customColor.b).toBe(0.6);
    expect(customColor.a).toBe(0.8);
  });

  it("updates components via set() and clone()", () => {
    const color = new Color();
    color.set(0.1, 0.2, 0.3, 0.4);
    expect(color.r).toBe(0.1);
    expect(color.g).toBe(0.2);
    expect(color.b).toBe(0.3);
    expect(color.a).toBe(0.4);

    const cloned = color.clone();
    expect(cloned).not.toBe(color);
    expect(cloned.r).toBe(0.1);
    expect(cloned.g).toBe(0.2);
    expect(cloned.b).toBe(0.3);
    expect(cloned.a).toBe(0.4);

    cloned.r = 0.9;
    expect(color.r).toBe(0.1);
    expect(cloned.r).toBe(0.9);
  });

  it("copies from another Color or Readonly<Color>", () => {
    const color = new Color();
    color.copyFrom(Color.RED);
    expect(color.r).toBe(1);
    expect(color.g).toBe(0);
    expect(color.b).toBe(0);
    expect(color.a).toBe(1);
  });

  it("interpolates colors with lerp()", () => {
    const a = new Color(0, 0, 0, 0);
    a.lerp(Color.WHITE, 0.5);
    expect(a.r).toBeCloseTo(0.5);
    expect(a.g).toBeCloseTo(0.5);
    expect(a.b).toBeCloseTo(0.5);
    expect(a.a).toBeCloseTo(0.5);
  });

  it("provides frozen immutable base constants", () => {
    expect(Object.isFrozen(Color.WHITE)).toBe(true);
    expect(Object.isFrozen(Color.BLACK)).toBe(true);
    expect(Object.isFrozen(Color.RED)).toBe(true);
    expect(Object.isFrozen(Color.GREEN)).toBe(true);
    expect(Object.isFrozen(Color.BLUE)).toBe(true);
    expect(Object.isFrozen(Color.TRANSPARENT)).toBe(true);

    expect(Color.WHITE.r).toBe(1);
    expect(Color.WHITE.g).toBe(1);
    expect(Color.WHITE.b).toBe(1);

    expect(() => {
      (Color.WHITE as unknown as { r: number }).r = 0.5;
    }).toThrow();
  });

  it("parses colors from hex strings", () => {
    const red3 = Color.fromHex("#F00");
    expect(red3.r).toBe(1);
    expect(red3.g).toBe(0);
    expect(red3.b).toBe(0);

    const rgba4 = Color.fromHex("0F08");
    expect(rgba4.g).toBe(1);
    expect(rgba4.a).toBeCloseTo(0.533, 2);

    const blue6 = Color.fromHex("#0000FF");
    expect(blue6.b).toBe(1);

    const hex8 = Color.fromHex("#0000FF80");
    expect(hex8.b).toBe(1);
    expect(hex8.a).toBeCloseTo(0.502, 2);
  });

  it("parses named colors from ColorNames", () => {
    const papaya = Color.fromName("papayawhip");
    expect(papaya).toBeDefined();
    expect(papaya?.r).toBe(1);
    expect(papaya?.g).toBe(0.937);
    expect(papaya?.b).toBe(0.835);

    const royal = Color.fromName("ROYALBLUE");
    expect(royal).toBeDefined();
    expect(royal?.r).toBe(0.255);

    expect(Color.fromName("nonexistent_color")).toBeUndefined();
    expect(Object.keys(COLOR_NAMES).length).toBeGreaterThan(130);
  });

  it("converts to HSL and HSV and back", () => {
    const c = Color.RED.clone();
    const hsl = c.toHSL();
    expect(hsl.h).toBe(0);
    expect(hsl.s).toBe(1);
    expect(hsl.l).toBe(0.5);

    const fromHsl = Color.fromHSL(hsl.h, hsl.s, hsl.l);
    expect(fromHsl.r).toBeCloseTo(1);
    expect(fromHsl.g).toBeCloseTo(0);
    expect(fromHsl.b).toBeCloseTo(0);

    const hsv = c.toHSV();
    expect(hsv.h).toBe(0);
    expect(hsv.s).toBe(1);
    expect(hsv.v).toBe(1);

    const fromHsv = Color.fromHSV(hsv.h, hsv.s, hsv.v);
    expect(fromHsv.r).toBeCloseTo(1);
    expect(fromHsv.g).toBeCloseTo(0);
    expect(fromHsv.b).toBeCloseTo(0);
  });

  it("converts to hex, array, Float32Array and Vector3D", () => {
    const c = new Color(1, 0.5, 0, 1);
    expect(c.toHex()).toBe("#FF8000");
    expect(c.toHex(true)).toBe("#FF8000FF");

    expect(c.toArray()).toEqual([1, 0.5, 0, 1]);

    const f32 = c.toFloat32Array();
    expect(f32[0]).toBe(1);
    expect(f32[1]).toBe(0.5);
    expect(f32[2]).toBe(0);
    expect(f32[3]).toBe(1);

    const vec = c.toVector3();
    expect(vec.x).toBe(1);
    expect(vec.y).toBe(0.5);
    expect(vec.z).toBe(0);
  });

  it("calculates blackbody radiation color ramp", () => {
    // Cold (0.0): Deep Dark Red
    const cold = Color.blackbody(0.0);
    expect(cold.r).toBeCloseTo(0.6);
    expect(cold.g).toBe(0);
    expect(cold.b).toBe(0);

    // Warm (0.5): Hot Fiery Orange
    const warm = Color.blackbody(0.5);
    expect(warm.r).toBeCloseTo(0.8);
    expect(warm.g).toBeCloseTo(0.375);
    expect(warm.b).toBe(0);

    // Blinding white (1.0)
    const white = Color.blackbody(1.0);
    expect(white.r).toBeCloseTo(1.0);
    expect(white.g).toBeCloseTo(1.0);
    expect(white.b).toBeCloseTo(1.0);

    // Target mutation (zero allocation)
    const target = new Color();
    const result = Color.blackbody(0.2, target);
    expect(result).toBe(target);
    expect(target.r).toBeCloseTo(0.68);
  });

  it("converts Kelvin temperature to RGB using Planckian fit", () => {
    // Candlelight (1900K) -> warm reddish/orange
    const candle = Color.fromTemperature(1900);
    expect(candle.r).toBe(1.0);
    expect(candle.g).toBeLessThan(0.7);
    expect(candle.b).toBeLessThan(0.3);

    // Daylight / Sun (6500K) -> near pure white / neutral
    const sun = Color.fromTemperature(6500);
    expect(sun.r).toBeCloseTo(1.0, 1);
    expect(sun.g).toBeCloseTo(1.0, 1);
    expect(sun.b).toBeCloseTo(1.0, 1);

    // Deep blue sky (12000K) -> bluish tint
    const sky = Color.fromTemperature(12000);
    expect(sky.b).toBe(1.0);
    expect(sky.r).toBeLessThan(1.0);
  });

  it("toTarget fails fast on gamma <= 0 or non-finite instead of producing Infinity/NaN", () => {
    const c = new Color(0.5, 0.5, 0.5);
    const out = new Color();
    for (const g of [0, -1, NaN, Infinity]) {
      expect(() => c.toTarget(g, out)).toThrow(/gamma must be a finite number > 0/);
    }
    expect(c.toTarget(2.2, out).r).toBeCloseTo(0.5, 6);
    expect(c.toTarget(1.0, out).r).toBeCloseTo(Math.pow(0.5, 2.2), 6);
  });
});
