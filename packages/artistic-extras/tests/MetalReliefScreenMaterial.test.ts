import { describe, it, expect } from "vitest";
import { MetalReliefScreenMaterial } from "../src/materials/MetalReliefScreenMaterial.js";

describe("MetalReliefScreenMaterial", () => {
  it("initializes with intended default parameters", () => {
    const mat = new MetalReliefScreenMaterial();

    expect(mat.type).toBe("MetalReliefScreenMaterial");
    expect(mat.reliefStrength).toBe(1.5);
    expect(mat.paletteKnifeStrength).toBe(0.5);
    expect(mat.paletteKnifeScale).toBe(24.0);
    expect(mat.scratchIntensity).toBe(0.35);
    expect(mat.scratchScale).toBe(120.0);
    expect(mat.edgeGlintStrength).toBe(1.2);
    expect(mat.wetRainStreaks).toBe(0.5);
    expect(mat.wireMeshStrength).toBe(0.0);
    expect(mat.targetHue).toBe(0.0);
    expect(mat.hueTolerance).toBe(0.09);
    expect(mat.desaturation).toBe(0.95);
    expect(mat.rustStrength).toBe(0.8);
    expect(mat.splitPosition).toBe(-1.0);
  });

  it("packs continuous parameters into render manifest lanes", () => {
    const mat = new MetalReliefScreenMaterial({
      reliefStrength: 2.2,
      paletteKnifeStrength: 0.9,
      paletteKnifeScale: 30.0,
      scratchIntensity: 0.7,
      scratchScale: 150.0,
      edgeGlintStrength: 1.8,
      wetRainStreaks: 0.85,
      wireMeshStrength: 0.4,
      targetHue: 0.1,
      hueTolerance: 0.15,
      desaturation: 0.85,
      rustStrength: 0.9,
      splitPosition: 0.45,
    });
    mat.time = 5.5;

    const manifest = mat.getRenderManifest();
    expect(manifest.shaderId).toBe("MetalReliefScreenMaterial");

    // The engine owns u_extraParams (ao / alpha-test cutoff / normal scale): the material must
    // leave it at its defaults, otherwise the depth and shadow passes discard the surface.
    const engineExtra = manifest.properties["u_extraParams"] as number[] | undefined;
    expect(engineExtra?.[1] ?? 0).toBe(0);

    const extra = manifest.properties["u_matParam0"] as number[];
    expect(extra[0]).toBe(2.2);
    expect(extra[1]).toBe(0.9);
    expect(extra[2]).toBe(30.0);
    expect(extra[3]).toBe(0.7);

    const liquid = manifest.properties["u_matParam1"] as number[];
    expect(liquid[0]).toBe(150.0);
    expect(liquid[1]).toBe(1.8);
    expect(liquid[2]).toBe(0.85);
    expect(liquid[3]).toBe(0.4);

    const styleA = manifest.properties["u_styleA"] as number[];
    expect(styleA[0]).toBe(0.1);
    expect(styleA[1]).toBe(0.15);
    expect(styleA[2]).toBe(0.85);
    expect(styleA[3]).toBe(0.9);

    const styleB = manifest.properties["u_styleB"] as number[];
    expect(styleB[0]).toBe(0.45);

    expect(manifest.properties["u_time"]).toBe(5.5);
  });

  it("provides valid shader definitions for all three API tiers", () => {
    const mat = new MetalReliefScreenMaterial();
    const def = mat.getShaderDefinition();

    expect(def.id).toBe("MetalReliefScreenMaterial");
    expect(def.sources.glsl300?.fs).toContain("mrs_voronoiFacets");
    expect(def.sources.glsl100?.fs).toContain("mrs_voronoiFacets");
    expect(def.sources.wgsl).toContain("mrs_voronoiFacets");
  });
});
