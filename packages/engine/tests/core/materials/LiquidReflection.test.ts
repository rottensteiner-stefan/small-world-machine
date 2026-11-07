import { describe, expect, it } from "vitest";
import { OpenWaterMaterial, StylizedWaterMaterial, Texture } from "../../../src/index.js";
import type { LiquidWaveMaterial } from "../../../src/index.js";

// Planar reflection of the wave-displaced liquids: `u_matParam9` carries `[strength, distortion]`
// and doubles as the "has a mirror" switch, `u_reflectionMap` rides in the manifest and layout.

const presets: ReadonlyArray<[string, () => LiquidWaveMaterial]> = [
  ["OpenWaterMaterial", (): LiquidWaveMaterial => new OpenWaterMaterial()],
  ["StylizedWaterMaterial", (): LiquidWaveMaterial => new StylizedWaterMaterial()],
];

describe.each(presets)("%s planar reflection", (_name, create) => {
  const mirror = Texture.empty();

  it("is off without a reflectionMap, whatever the strength", () => {
    const material = create();
    material.reflectionStrength = 0.8;
    const manifest = material.getRenderManifest();
    expect(manifest.textures["u_reflectionMap"]).toBeUndefined();
    expect((manifest.properties as Record<string, number[]>)["u_matParam9"]![0]).toBe(0);
  });

  it("packs strength and distortion once a reflectionMap is set", () => {
    const material = create();
    material.reflectionMap = mirror;
    material.reflectionStrength = 0.7;
    material.reflectionDistortion = 0.2;
    const manifest = material.getRenderManifest();
    expect(manifest.textures["u_reflectionMap"]).toBe(mirror);
    const lane = (manifest.properties as Record<string, number[]>)["u_matParam9"]!;
    expect(lane[0]).toBeCloseTo(0.7);
    expect(lane[1]).toBeCloseTo(0.2);
  });

  it("defaults to full Fresnel-weighted strength", () => {
    const material = create();
    material.reflectionMap = mirror;
    const lane = (material.getRenderManifest().properties as Record<string, number[]>)[
      "u_matParam9"
    ]!;
    expect(lane[0]).toBe(1);
  });

  it("turns off again when the map is removed", () => {
    const material = create();
    material.reflectionMap = mirror;
    material.getRenderManifest();
    material.reflectionMap = undefined;
    const manifest = material.getRenderManifest();
    expect(manifest.textures["u_reflectionMap"]).toBeUndefined();
    expect((manifest.properties as Record<string, number[]>)["u_matParam9"]![0]).toBe(0);
  });

  it("declares u_reflectionMap in the shader layout so WebGPU binds it", () => {
    expect(create().getShaderDefinition().layout.textures).toHaveProperty("u_reflectionMap");
  });
});

describe("reflection options", () => {
  it("OpenWaterMaterial and StylizedWaterMaterial take them from their constructor options", () => {
    const mirror = Texture.empty();
    for (const material of [
      new OpenWaterMaterial({ reflectionMap: mirror, reflectionStrength: 0.5 }),
      new StylizedWaterMaterial({ reflectionMap: mirror, reflectionDistortion: 0.3 }),
    ]) {
      expect(material.reflectionMap).toBe(mirror);
    }
    expect(new OpenWaterMaterial({ reflectionStrength: 0.5 }).reflectionStrength).toBe(0.5);
    expect(new StylizedWaterMaterial({ reflectionDistortion: 0.3 }).reflectionDistortion).toBe(0.3);
  });
});
