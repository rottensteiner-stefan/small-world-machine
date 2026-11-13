import { describe, it, expect } from "vitest";
import {
  StylizedWaterMaterial,
  composeStylizedWaterSources,
} from "../../src/core/materials/liquid/StylizedWaterMaterial.js";
import { Texture } from "../../src/core/textures/index.js";

describe("StylizedWaterMaterial Anime Style Ladder & Preset Vectors", () => {
  it("composes shader sources with default empty extension hooks", () => {
    const sources = composeStylizedWaterSources();
    expect(sources.glsl300?.fs).not.toContain("[WATER_EXT_DECL]");
    expect(sources.glsl300?.fs).not.toContain("[WATER_EXT_SURFACE]");
    expect(sources.wgsl).not.toContain("[WGSL_WATER_EXT_DECL]");
    expect(sources.wgsl).not.toContain("[WGSL_WATER_EXT_SURFACE]");
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
