import { describe, it, expect } from "vitest";
import { MetalReliefMaterial } from "../src/materials/MetalReliefMaterial.js";
import { Color } from "@small-world-machine/engine";

describe("MetalReliefMaterial", () => {
  it("initializes with intended default parameters", () => {
    const mat = new MetalReliefMaterial();

    expect(mat.type).toBe("MetalReliefMaterial");
    expect(mat.paletteKnifeStrength).toBe(0.6);
    expect(mat.paletteKnifeScale).toBe(12.0);
    expect(mat.scratchIntensity).toBe(0.35);
    expect(mat.scratchScale).toBe(80.0);
    expect(mat.edgeBevelStrength).toBe(0.8);
    expect(mat.wireMeshStrength).toBe(0.0);
    expect(mat.colorPopTargetHue).toBe(0.0);
    expect(mat.colorPopTolerance).toBe(0.09);
    expect(mat.colorPopDesaturation).toBe(0.95);
    expect(mat.rustStrength).toBe(0.75);
    expect(mat.metallic).toBe(0.4);
    expect(mat.roughness).toBe(0.7);
  });

  it("packs all continuous tuning variables correctly into render manifest lanes", () => {
    const mat = new MetalReliefMaterial({
      color: new Color(0.9, 0.2, 0.2),
      paletteKnifeStrength: 1.2,
      paletteKnifeScale: 20.0,
      scratchIntensity: 0.6,
      scratchScale: 100.0,
      edgeBevelStrength: 1.5,
      wireMeshStrength: 0.5,
      wireMeshScale: 50.0,
      wetRainStreaks: 0.8,
      colorPopTargetHue: 0.05,
      colorPopTolerance: 0.12,
      colorPopDesaturation: 0.9,
      rustStrength: 0.85,
      metallic: 0.65,
      roughness: 0.45,
    });
    mat.time = 4.2;

    const manifest = mat.getRenderManifest();
    expect(manifest.shaderId).toBe("MetalReliefMaterial");

    // The engine owns u_extraParams (ao / alpha-test cutoff / normal scale): the material must
    // leave it at its defaults, otherwise the depth and shadow passes discard the surface.
    const engineExtra = manifest.properties["u_extraParams"] as number[] | undefined;
    expect(engineExtra?.[1] ?? 0).toBe(0);

    const extra = manifest.properties["u_matParam0"] as number[];
    expect(extra[0]).toBe(1.2);
    expect(extra[1]).toBe(20.0);
    expect(extra[2]).toBe(0.6);
    expect(extra[3]).toBe(100.0);

    const liquid = manifest.properties["u_matParam1"] as number[];
    expect(liquid[0]).toBe(1.5);
    expect(liquid[1]).toBe(0.5);
    expect(liquid[2]).toBe(50.0);
    expect(liquid[3]).toBe(0.8);

    const colorPop = manifest.properties["u_matParam2"] as number[];
    expect(colorPop[0]).toBe(0.05);
    expect(colorPop[1]).toBe(0.12);
    expect(colorPop[2]).toBe(0.9);
    expect(colorPop[3]).toBe(0.85);

    // Key light lane (stylized material): default direction, overridable per material.
    expect((manifest.properties["u_matParam3"] as number[]).slice(0, 3)).toEqual([0.4, 0.8, 0.5]);
    expect("u_styleA" in manifest.properties).toBe(false);

    expect(manifest.properties["u_metallic"]).toBe(0.65);
    expect(manifest.properties["u_roughness"]).toBe(0.45);
    expect(manifest.properties["u_time"]).toBe(4.2);
  });

  it("provides valid shader definitions for GLSL 300, GLSL 100, and WGSL", () => {
    const mat = new MetalReliefMaterial();
    const def = mat.getShaderDefinition();

    expect(def.id).toBe("MetalReliefMaterial");
    expect(def.sources.glsl300).toBeDefined();
    expect(def.sources.glsl300?.fs).toContain("mr_voronoiFacets");
    expect(def.sources.glsl300?.fs).toContain("mr_rgb2hsv");

    expect(def.sources.glsl100).toBeDefined();
    expect(def.sources.glsl100?.fs).toContain("mr_voronoiFacets");

    expect(def.sources.wgsl).toBeDefined();
    expect(def.sources.wgsl).toContain("mr_voronoiFacets");
    expect(def.sources.wgsl).toContain("fs(i: Out)");
  });

  it("clones cleanly without sharing render manifest buffer", () => {
    const original = new MetalReliefMaterial({ paletteKnifeStrength: 1.1 });
    const clone = original.clone() as MetalReliefMaterial;

    expect(clone.uuid).not.toBe(original.uuid);
    expect(clone.paletteKnifeStrength).toBe(1.1);

    clone.paletteKnifeStrength = 0.3;
    expect(original.paletteKnifeStrength).toBe(1.1);
  });

  it("exposes the key light direction as a material parameter", () => {
    const mat = new MetalReliefMaterial({ lightDirection: [0, 1, 0] });
    expect((mat.getRenderManifest().properties["u_matParam3"] as number[]).slice(0, 3)).toEqual([
      0, 1, 0,
    ]);
  });
});
