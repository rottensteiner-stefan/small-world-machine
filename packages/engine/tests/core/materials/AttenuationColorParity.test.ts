import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { StandardMaterial } from "../../../src/core/materials/surface/StandardMaterial.js";
import { Color } from "../../../src/core/colors/index.js";

const SRC_DIR = join(__dirname, "../../../src");
// StandardMaterial transmission lives in the shared PBR lighting chunk (all tiers mirror it).
const WGSL = join(SRC_DIR, "renderers/shaders/source/web_gpu/chunks/lighting_pbr.wgsl");
const GLSL300_CHUNK = join(
  SRC_DIR,
  "renderers/shaders/source/web_gl2/chunks/light_calc_pbr.frag.glsl",
);
// WebGL1 now declares the transmission path too (the former E-M13 'documented off' decision was
// lifted): the template carries the lane + samplers, the shared light-calc chunk the kernel.
const GLSL100 = join(SRC_DIR, "core/materials/surface/shaders/Standard.frag.glsl100");
const GLSL100_CHUNK = join(
  SRC_DIR,
  "renderers/shaders/source/web_gl1/chunks/light_calc_pbr.frag.glsl",
);

// ── P3/S1 R1 (severity error, E1-A + E2-A): StandardMaterial.attenuationColor was declared and
// glTF-imported but NEVER written to a uniform; the shaders passed `albedo` into Beer-Lambert
// absorption, silently breaking KHR_materials_volume. The ratified fix packs the attenuation color
// into an owned typed lane and feeds it to VolumeAbsorption on the tiers that carry the
// transmission path (WebGPU + WebGL2). Colour convention: LINEAR/RAW (the ORM/normal 'roh'
// convention) -- the raw RGB is shipped to the Beer-Lambert kernel without an sRGB decode; the
// shader's VolumeAbsorption already treats its input as linear absorbance. Material.color, by
// contrast, is sRGB-authored and linearized in-shader. (@pending-S5-review: reconcile with the S5
// glTF loader colour-space conversion once GltfMaterialParser lands.)

describe("R1: StandardMaterial.attenuationColor reaches the Beer-Lambert kernel (every tier)", () => {
  it("packs attenuationColor into the owned typed lane (RGB raw, w = 1)", () => {
    const material = new StandardMaterial({
      attenuationColor: new Color(0.5, 0.25, 0.125),
      attenuationDistance: 4.0,
    });
    const props = material.getRenderManifest().properties as Record<string, number[]>;
    const lane = props["u_matParam11"];
    expect(lane, "u_matParam11 lane carries the attenuation colour").toEqual([
      0.5, 0.25, 0.125, 1.0,
    ]);
  });

  it("default attenuationColor (white) still packs (1,1,1,1) - value-preserving at default", () => {
    const props = new StandardMaterial().getRenderManifest().properties as Record<string, number[]>;
    expect(props["u_matParam11"]).toEqual([1.0, 1.0, 1.0, 1.0]);
  });

  it("WGSL calls VolumeAbsorption with the attenuation colour lane, not albedo", () => {
    const wgsl = readFileSync(WGSL, "utf8");
    const callSite = wgsl.match(/VolumeAbsorption\([^)]*\)/)?.[0] ?? "";
    expect(callSite).toContain("obj.matParam11.xyz");
    expect(callSite).not.toContain("albedo");
  });

  it("WebGL2 chunk calls VolumeAbsorption with the attenuation colour uniform, not albedo", () => {
    const glsl300 = readFileSync(GLSL300_CHUNK, "utf8");
    const callSite = glsl300.match(/VolumeAbsorption\([^)]*\)/)?.[0] ?? "";
    expect(callSite).toContain("u_matParam11.rgb");
    expect(callSite).not.toContain("albedo");
  });

  it("WebGL1 chunk calls VolumeAbsorption with the attenuation colour uniform, not albedo", () => {
    const glsl100Chunk = readFileSync(GLSL100_CHUNK, "utf8");
    const callSite = glsl100Chunk.match(/VolumeAbsorption\([^)]*\)/)?.[0] ?? "";
    expect(callSite).toContain("u_matParam11.rgb");
    expect(callSite).not.toContain("albedo");
  });

  it("WebGL1 template declares the transmission path with the attenuation-colour lane (E-M13 lifted)", () => {
    const glsl100 = readFileSync(GLSL100, "utf8");
    expect(glsl100).toContain("USE_TRANSMISSION");
    expect(glsl100).toContain("u_matParam11");
    expect(glsl100).toContain("u_opaqueMap");
  });
});
