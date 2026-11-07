import { describe, it, expect } from "vitest";
import { DROP_PRESETS, DropPreset, terminalVelocity } from "../src/drops/DropProperties.js";
import {
  capillaryLength,
  deriveLayerParams,
  deriveSurfaceParams,
  minimumCapillaryWavelength,
  ohnesorgeNumber,
  reynoldsNumber,
  rippleLifetime,
  weberNumber,
} from "../src/drops/DropRegime.js";
import { FLUID_PRESETS, FluidPreset } from "../src/drops/FluidProperties.js";

const WATER = FLUID_PRESETS[FluidPreset.WATER];
const BLOOD = FLUID_PRESETS[FluidPreset.BLOOD];
const OLIVE_OIL = FLUID_PRESETS[FluidPreset.OLIVE_OIL];
const RAIN = DROP_PRESETS[DropPreset.RAIN];

describe("dimensionless numbers", () => {
  // Water, D = 2 mm, v = 6.5 m/s, worked by hand.
  it("matches hand-computed water values", () => {
    expect(weberNumber(998, 6.5, 0.002, 0.072)).toBeCloseTo(1171, 0);
    expect(ohnesorgeNumber(1.0e-3, 998, 0.072, 0.002)).toBeCloseTo(0.00264, 5);
    expect(reynoldsNumber(998, 6.5, 0.002, 1.0e-3)).toBeCloseTo(12974, 0);
  });

  it("gives the classic capillary scales and ripple lifetime", () => {
    expect(capillaryLength(0.072, 998)).toBeCloseTo(0.00271, 5);
    expect(minimumCapillaryWavelength(0.072, 998)).toBeCloseTo(0.01704, 4);
    const k = (2 * Math.PI) / 0.017;
    expect(rippleLifetime(k, 1.0e-6)).toBeCloseTo(3.66, 1);
  });

  it("follows the Atlas 1973 terminal velocity fit", () => {
    expect(terminalVelocity(0.002)).toBeCloseTo(9.65 - 10.3 * Math.exp(-1.2), 6);
    expect(terminalVelocity(0.00001)).toBe(0);
  });
});

describe("regime mapping", () => {
  it("derives water's capillary and damping constants", () => {
    const p = deriveSurfaceParams(WATER, RAIN);
    // sigma/rho of water is ~7.2-7.3e-5 m^3/s^2 depending on the source.
    expect(p.sigmaOverRho).toBeGreaterThan(7.1e-5);
    expect(p.sigmaOverRho).toBeLessThan(7.4e-5);
    expect(p.kinematicViscosity).toBeCloseTo(1.0e-6, 8);
    expect(p.ior).toBe(1.333);
  });

  it("gives water rain daughter drops and big water drips a crown", () => {
    const p = deriveSurfaceParams(WATER, RAIN);
    expect(p.rain.daughterProbability).toBeGreaterThan(0.4);
    expect(p.drips.crownStrength).toBeGreaterThan(0);
    expect(p.drips.diameterMax).toBe(RAIN.drips.diameterMax);
  });

  it("keeps olive oil viscous: no daughters, no crown, no bubbles", () => {
    const p = deriveSurfaceParams(OLIVE_OIL, RAIN);
    for (const layer of [p.rain, p.drips]) {
      expect(layer.daughterProbability).toBeCloseTo(0, 6);
      expect(layer.crownStrength).toBe(0);
      expect(layer.bubbleProbability).toBe(0);
    }
  });

  it("places blood between water and oil", () => {
    const water = deriveLayerParams(WATER, RAIN.rain);
    const blood = deriveLayerParams(BLOOD, RAIN.rain);
    const oil = deriveLayerParams(OLIVE_OIL, RAIN.rain);
    expect(blood.daughterProbability).toBeLessThan(water.daughterProbability);
    expect(blood.daughterProbability).toBeGreaterThan(oil.daughterProbability);
    expect(blood.slopeScale).toBeLessThan(water.slopeScale);
    expect(blood.slopeScale).toBeGreaterThan(oil.slopeScale);
  });

  it("makes heavy rain entrain more bubbles than drizzle", () => {
    const heavy = deriveLayerParams(WATER, DROP_PRESETS[DropPreset.HEAVY_RAIN].rain);
    const drizzle = deriveLayerParams(WATER, DROP_PRESETS[DropPreset.DRIZZLE].rain);
    expect(heavy.bubbleProbability).toBeGreaterThan(drizzle.bubbleProbability);
  });

  it("writes into a caller-owned object", () => {
    const out = deriveSurfaceParams(WATER, RAIN);
    expect(deriveSurfaceParams(BLOOD, RAIN, out)).toBe(out);
    expect(out.absorptionPerMm).toEqual([...BLOOD.absorptionPerMm]);
  });
});
