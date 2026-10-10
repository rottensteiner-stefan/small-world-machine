import { describe, it, expect } from "vitest";
import {
  StylizedWaterMaterial,
  composeStylizedWaterSources,
} from "../../src/core/materials/liquid/StylizedWaterMaterial.js";
import { Color } from "../../src/core/colors/Color.js";
import { Texture } from "../../src/core/textures/index.js";

describe("StylizedWaterMaterial Anime Style Ladder & Preset Vectors", () => {
  it("defaults to toon preset with backward-compatible styleId 0", () => {
    const mat = new StylizedWaterMaterial();
    expect(mat.styleId).toBe(0);
    expect(mat.causticStrength).toBe(0.6);
    expect(mat.specularStrength).toBe(0.4);
    expect(mat.foamSoftness).toBe(0.06);
    expect(mat.skyTint).toBe(0.45);

    const manifest = mat.getRenderManifest();
    const styleB = manifest.properties["u_styleB"] as number[];
    expect(styleB[3]).toBe(0); // styleId == 0 (legacy toon path)
  });

  it("configures soft (Ghibli) preset correctly", () => {
    const mat = new StylizedWaterMaterial({ style: "soft" });
    expect(mat.styleId).toBe(1.0);
    expect(mat.rampSoftness).toBe(0.9);
    expect(mat.washAmount).toBe(0.5);
    expect(mat.foamSoftness).toBe(0.16);
    expect(mat.skyTint).toBe(0.55);
    expect(mat.glitterStrength).toBe(0);

    const manifest = mat.getRenderManifest();
    const styleA = manifest.properties["u_styleA"] as number[];
    const styleB = manifest.properties["u_styleB"] as number[];
    expect(styleA[0]).toBeCloseTo(0.9);
    expect(styleB[3]).toBe(1.0);
  });

  it("configures sparkle (painterly-sparkle) preset correctly", () => {
    const mat = new StylizedWaterMaterial({ style: "sparkle" });
    expect(mat.styleId).toBe(2.0);
    expect(mat.glitterStrength).toBe(1.0);
    expect(mat.lineDensity).toBe(0.7);

    const manifest = mat.getRenderManifest();
    const styleB = manifest.properties["u_styleB"] as number[];
    expect(styleB[2]).toBe(1.0); // glitterStrength
    expect(styleB[3]).toBe(2.0); // styleId
  });

  it("allows overriding specific style vector parameters", () => {
    const mat = new StylizedWaterMaterial({
      style: "soft",
      glitterStrength: 0.8,
      rampSoftness: 0.95,
      shallowWaterColor: new Color(0.2, 0.7, 0.8),
    });
    expect(mat.styleId).toBe(1.0);
    expect(mat.glitterStrength).toBe(0.8);
    expect(mat.rampSoftness).toBe(0.95);
    expect(mat.color.r).toBeCloseTo(0.2);
  });

  it("composes shader sources with default empty extension hooks", () => {
    const sources = composeStylizedWaterSources();
    expect(sources.glsl300?.fs).not.toContain("[WATER_EXT_DECL]");
    expect(sources.glsl300?.fs).not.toContain("[WATER_EXT_SURFACE]");
    expect(sources.wgsl).not.toContain("[WGSL_WATER_EXT_DECL]");
    expect(sources.wgsl).not.toContain("[WGSL_WATER_EXT_SURFACE]");
  });

  it("maps the presets to explicit integer style ids", () => {
    const ids: Record<string, number> = { toon: 0, soft: 1, sparkle: 2, dredge: 4, bold: 5 };
    for (const [style, id] of Object.entries(ids)) {
      const mat = new StylizedWaterMaterial({ style: style as "toon" });
      expect(mat.styleId).toBe(id);
    }
  });
});

describe("StylizedWaterMaterial rampMap (P2 verification, A2)", () => {
  it("does not set the flag or bind the texture while rampMap is unset", () => {
    const manifest = new StylizedWaterMaterial().getRenderManifest();
    expect(manifest.flags).toEqual([]);
    expect(manifest.textures["u_rampMap"]).toBeUndefined();
  });

  it("sets USE_RAMP_LUT and binds the texture while rampMap is present", () => {
    const mat = new StylizedWaterMaterial();
    mat.rampMap = Texture.empty();
    const manifest = mat.getRenderManifest();
    expect(manifest.flags).toEqual(["USE_RAMP_LUT"]);
    expect(manifest.textures["u_rampMap"]).toBe(mat.rampMap);
  });

  it("clears the flag and the texture when rampMap is unset again on the same instance", () => {
    const mat = new StylizedWaterMaterial();
    mat.rampMap = Texture.empty();
    expect(mat.getRenderManifest().flags).toEqual(["USE_RAMP_LUT"]);

    mat.rampMap = undefined;
    const manifest = mat.getRenderManifest();
    expect(manifest.flags).toEqual([]);
    expect(manifest.textures["u_rampMap"]).toBeUndefined();
  });

  it("emits no per-style flags and keeps the flags reference stable across calls and styles", () => {
    const mat = new StylizedWaterMaterial();
    const first = mat.getRenderManifest().flags;
    mat.styleId = 5;
    expect(mat.getRenderManifest().flags).toBe(first);
    mat.rampMap = Texture.empty();
    const withRamp = mat.getRenderManifest().flags;
    expect(withRamp).not.toBe(first);
    expect(mat.getRenderManifest().flags).toBe(withRamp);
  });
});
