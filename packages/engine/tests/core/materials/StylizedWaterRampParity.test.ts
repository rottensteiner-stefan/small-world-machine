import { describe, expect, it } from "vitest";
import { composeStylizedWaterSources } from "../../../src/core/materials/liquid/StylizedWaterMaterial.js";

// Source lint: asserts the three backends spell the ramp LUT identically (substring checks on the
// shader text). It cannot prove the shaders compile or render alike; see LiquidUniformNameParity.test.ts
// for the uniform-name mapping check and the golden captures for the rendered result.
describe("StylizedWater ramp LUT source parity (P2 verification, A4)", () => {
  const sources = composeStylizedWaterSources();
  const glsl300 = sources.glsl300?.fs ?? "";
  const glsl100 = sources.glsl100?.fs ?? "";
  const wgsl = sources.wgsl ?? "";

  it("exposes all three fragment sources for the parity check", () => {
    expect(glsl300.length).toBeGreaterThan(0);
    expect(glsl100.length).toBeGreaterThan(0);
    expect(wgsl.length).toBeGreaterThan(0);
  });

  it("declares the LUT path consistently in all three backends", () => {
    expect(glsl300).toContain("USE_RAMP_LUT");
    expect(glsl300).toContain("u_rampMap");
    expect(glsl100).toContain("USE_RAMP_LUT");
    expect(glsl100).toContain("u_rampMap");
    expect(wgsl).toContain("USE_RAMP_LUT");
    expect(wgsl).toContain("u_rampMap");
  });

  it("uses the identical texel-centre UV expression in all three backends", () => {
    expect(glsl300).toContain("255.0 + 0.5");
    expect(glsl300).toContain("/ 256.0");
    expect(glsl100).toContain("255.0 + 0.5");
    expect(glsl100).toContain("/ 256.0");
    expect(wgsl).toContain("255.0 + 0.5");
    expect(wgsl).toContain("/ 256.0");
  });

  it("keeps the original depth ramp block under the off path", () => {
    expect(glsl300).toContain("smoothstep(0.0, 0.5, rampT)");
    expect(glsl300).toContain("u_styleA.x * 0.6");
    expect(glsl100).toContain("smoothstep(0.0, 0.5, rampT)");
    expect(glsl100).toContain("u_styleA.x * 0.6");
    expect(wgsl).toContain("obj.styleA.x > 0.05");
  });

  it("shares the same RAMP_LUT_WEIGHT constant in all three backends", () => {
    expect(glsl300).toContain("RAMP_LUT_WEIGHT");
    expect(glsl100).toContain("RAMP_LUT_WEIGHT");
    expect(wgsl).toContain("RAMP_LUT_WEIGHT");
    expect(glsl300).toMatch(/RAMP_LUT_WEIGHT\s*=\s*0\.6\s*;/);
    expect(glsl100).toMatch(/RAMP_LUT_WEIGHT\s*=\s*0\.6\s*;/);
    expect(wgsl).toMatch(/RAMP_LUT_WEIGHT:\s*f32\s*=\s*0\.6\s*;/);
  });
});
