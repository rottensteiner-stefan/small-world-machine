import { describe, it, expect } from "vitest";
import { Color } from "../../../src/core/colors/Color.js";

describe("Color Blackbody & Planckian Temperature Physics", () => {
  describe("Color.blackbody(t, target?)", () => {
    it("interpolates continuous spectrum across normalized temperature [0, 1]", () => {
      const cold = Color.blackbody(0.0);
      expect(cold.r).toBeCloseTo(0.6);
      expect(cold.g).toBeCloseTo(0.0);
      expect(cold.b).toBeCloseTo(0.0);
      expect(cold.a).toBeCloseTo(1.0);

      const midLow = Color.blackbody(0.25);
      expect(midLow.r).toBeCloseTo(0.7);
      expect(midLow.g).toBeCloseTo(0.0625);
      expect(midLow.b).toBeCloseTo(0.0);

      const warm = Color.blackbody(0.5);
      expect(warm.r).toBeCloseTo(0.8);
      expect(warm.g).toBeCloseTo(0.375);
      expect(warm.b).toBeCloseTo(0.0);

      const hot = Color.blackbody(0.75);
      expect(hot.r).toBeCloseTo(0.9);
      expect(hot.g).toBeCloseTo(0.6875);
      expect(hot.b).toBeCloseTo(0.1666, 2);

      const peak = Color.blackbody(1.0);
      expect(peak.r).toBeCloseTo(1.0);
      expect(peak.g).toBeCloseTo(1.0);
      expect(peak.b).toBeCloseTo(1.0);
    });

    it("clamps out-of-range inputs safely", () => {
      const negative = Color.blackbody(-5.0);
      expect(negative.r).toBeCloseTo(0.6);
      expect(negative.g).toBeCloseTo(0.0);
      expect(negative.b).toBeCloseTo(0.0);

      const overflow = Color.blackbody(99.0);
      expect(overflow.r).toBeCloseTo(1.0);
      expect(overflow.g).toBeCloseTo(1.0);
      expect(overflow.b).toBeCloseTo(1.0);

      const nanVal = Color.blackbody(NaN);
      expect(nanVal.r).toBeCloseTo(0.6); // clamped to 0.0
      expect(nanVal.g).toBeCloseTo(0.0);
      expect(nanVal.b).toBeCloseTo(0.0);
    });

    it("mutates target in place to prevent memory allocations in render loops", () => {
      const target = new Color(0, 0, 0, 0.5);
      const returned = Color.blackbody(0.6, target);

      expect(returned).toBe(target);
      expect(target.r).toBeCloseTo(0.84);
      expect(target.a).toBeCloseTo(0.5); // Preserves existing alpha
    });
  });

  describe("Color.fromTemperature(kelvin, target?)", () => {
    it("accurately models Kelvin thermal radiation across standard astrophysical ranges", () => {
      // 1000K (Deep reddish glow / ember)
      const k1000 = Color.fromTemperature(1000);
      expect(k1000.r).toBeCloseTo(1.0);
      expect(k1000.g).toBeLessThan(0.3);
      expect(k1000.b).toBeCloseTo(0.0);

      // 2700K (Soft incandescent warm light)
      const k2700 = Color.fromTemperature(2700);
      expect(k2700.r).toBeCloseTo(1.0);
      expect(k2700.g).toBeGreaterThan(0.6);
      expect(k2700.b).toBeLessThan(0.5);

      // 6500K (Standard D65 Daylight / Solar photosphere)
      const k6500 = Color.fromTemperature(6500);
      expect(k6500.r).toBeCloseTo(1.0, 1);
      expect(k6500.g).toBeCloseTo(1.0, 1);
      expect(k6500.b).toBeCloseTo(1.0, 1);

      // 10000K (Hot B-type star / intense blue-white)
      const k10000 = Color.fromTemperature(10000);
      expect(k10000.r).toBeLessThan(0.9);
      expect(k10000.g).toBeLessThanOrEqual(1.0);
      expect(k10000.b).toBeCloseTo(1.0);

      // 40000K (O-type hypergiant / accretion disk inner edge)
      const k40000 = Color.fromTemperature(40000);
      expect(k40000.r).toBeLessThan(0.7);
      expect(k40000.b).toBeCloseTo(1.0);
    });

    it("ensures all channels remain bounded in [0, 1] with extreme temperatures", () => {
      const subZero = Color.fromTemperature(-100);
      expect(subZero.r).toBeGreaterThanOrEqual(0.0);
      expect(subZero.r).toBeLessThanOrEqual(1.0);
      expect(subZero.g).toBeGreaterThanOrEqual(0.0);
      expect(subZero.g).toBeLessThanOrEqual(1.0);
      expect(subZero.b).toBeGreaterThanOrEqual(0.0);
      expect(subZero.b).toBeLessThanOrEqual(1.0);

      const extremeHot = Color.fromTemperature(1_000_000);
      expect(extremeHot.r).toBeGreaterThanOrEqual(0.0);
      expect(extremeHot.r).toBeLessThanOrEqual(1.0);
      expect(extremeHot.b).toBeCloseTo(1.0);
    });

    it("reuses target Color instance with zero garbage generation", () => {
      const target = new Color(0, 0, 0, 0.75);
      const res = Color.fromTemperature(5500, target);
      expect(res).toBe(target);
      expect(target.a).toBeCloseTo(0.75);
    });
  });
});
