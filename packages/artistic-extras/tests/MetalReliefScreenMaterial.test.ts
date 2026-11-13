import { describe, it, expect } from "vitest";
import { MetalReliefScreenMaterial } from "../src/materials/MetalReliefScreenMaterial.js";

describe("MetalReliefScreenMaterial", () => {
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

    const colorPop = manifest.properties["u_matParam2"] as number[];
    expect(colorPop[0]).toBe(0.1);
    expect(colorPop[1]).toBe(0.15);
    expect(colorPop[2]).toBe(0.85);
    expect(colorPop[3]).toBe(0.9);

    expect((manifest.properties["u_matParam3"] as number[])[0]).toBe(0.45);
    expect("u_styleA" in manifest.properties).toBe(false);
    expect("u_styleB" in manifest.properties).toBe(false);

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
