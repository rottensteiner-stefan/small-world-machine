import { describe, it, expect } from "vitest";
import { GltfMaterialParser } from "../../../src/loaders/gltf/GltfMaterialParser.js";
import { AssetManager } from "../../../src/loaders/AssetManager.js";
import { CullMode } from "../../../src/enums/index.js";

describe("GltfMaterialParser", () => {
  it("parses PBR metallic-roughness factors and colors", async () => {
    const gltfMat = {
      pbrMetallicRoughness: {
        baseColorFactor: [1, 0, 0, 1],
        metallicFactor: 0.5,
        roughnessFactor: 0.25,
      },
      doubleSided: true,
      alphaMode: "BLEND" as const,
    };

    const mat = await GltfMaterialParser.parseMaterial(gltfMat, {}, "", [], new AssetManager());

    expect(mat.color.r).toBe(1);
    expect(mat.color.g).toBe(0);
    expect(mat.metallic).toBe(0.5);
    expect(mat.roughness).toBe(0.25);
    expect(mat.cullMode).toBe(CullMode.NONE);
    expect(mat.transparent).toBe(true);
  });

  it("keeps a MASK material in the opaque batch (depth-writing cutout, EP-3)", async () => {
    const mat = await GltfMaterialParser.parseMaterial(
      { alphaMode: "MASK", alphaCutoff: 0.4 },
      {},
      "",
      [],
      new AssetManager(),
    );

    // glTF MASK is a depth-writing opaque cutout: the fragment shader discards below the
    // cutoff, so transparent must stay false (no alpha blending, depthWrite retained).
    expect(mat.transparent).toBe(false);
    expect(mat.alphaTest).toBe(0.4);

    const defaultCutoff = await GltfMaterialParser.parseMaterial(
      { alphaMode: "MASK" },
      {},
      "",
      [],
      new AssetManager(),
    );
    expect(defaultCutoff.transparent).toBe(false);
    expect(defaultCutoff.alphaTest).toBe(0.5);
  });

  it("encodes baseColorFactor once per the sRGB-authored Material.color convention (EP-4)", async () => {
    // glTF baseColorFactor is linear; Material.color (and the shader decode) is sRGB-authored.
    // The loader encodes ONCE here, the shader decodes ONCE -- no double-decode.
    const mat = await GltfMaterialParser.parseMaterial(
      { pbrMetallicRoughness: { baseColorFactor: [0.5, 0.25, 0.75, 0.6] } },
      {},
      "",
      [],
      new AssetManager(),
    );

    expect(mat.color.a).toBe(0.6); // alpha is never encoded
    expect(mat.color.r).toBeCloseTo(GltfMaterialParser.linearToEngineSRGB(0.5), 6);

    // A single shader decode pow(x, 2.2) round-trips to the authored linear factor ...
    expect(Math.pow(mat.color.r, 2.2)).toBeCloseTo(0.5, 4);
    expect(Math.pow(mat.color.g, 2.2)).toBeCloseTo(0.25, 4);
    expect(Math.pow(mat.color.b, 2.2)).toBeCloseTo(0.75, 4);
    // ... and the stored value is raised, not darkened by a second decode.
    expect(mat.color.r).toBeGreaterThan(0.5);
  });

  it("applies clamp constraints to metallic and roughness", () => {
    expect(GltfMaterialParser.applyClamp(0.8, 0.5)).toBe(0.5);
    expect(GltfMaterialParser.applyClamp(0.2, [0.3, 0.7])).toBe(0.3);
    expect(GltfMaterialParser.applyClamp(0.9, [0.3, 0.7])).toBe(0.7);
    expect(GltfMaterialParser.applyClamp(0.5, [0.3, 0.7])).toBe(0.5);
  });

  it("parses KHR material extensions (clearcoat, sheen, transmission, volume, ior, emissive strength)", async () => {
    const gltfMat = {
      pbrMetallicRoughness: {
        baseColorFactor: [0.8, 0.8, 0.8, 1.0],
      },
      extensions: {
        KHR_materials_emissive_strength: {
          emissiveStrength: 4.5,
        },
        KHR_materials_clearcoat: {
          clearcoatFactor: 0.9,
          clearcoatRoughnessFactor: 0.15,
        },
        KHR_materials_sheen: {
          sheenColorFactor: [0.95, 0.85, 0.75],
          sheenRoughnessFactor: 0.4,
        },
        KHR_materials_transmission: {
          transmissionFactor: 0.88,
        },
        KHR_materials_volume: {
          thicknessFactor: 2.5,
          attenuationDistance: 12.0,
          attenuationColor: [0.1, 0.4, 0.9],
        },
        KHR_materials_ior: {
          ior: 1.33,
        },
      },
    };

    const mat = await GltfMaterialParser.parseMaterial(gltfMat, {}, "", [], new AssetManager());

    expect(mat.emissiveIntensity).toBe(4.5);
    expect(mat.clearcoat).toBe(0.9);
    expect(mat.clearcoatRoughness).toBe(0.15);
    expect(mat.sheenColor.r).toBeCloseTo(0.95);
    expect(mat.sheenColor.g).toBeCloseTo(0.85);
    expect(mat.sheenColor.b).toBeCloseTo(0.75);
    expect(mat.sheenRoughness).toBe(0.4);
    expect(mat.transmission).toBe(0.88);
    expect(mat.thickness).toBe(2.5);
    expect(mat.attenuationDistance).toBe(12.0);
    expect(mat.attenuationColor.r).toBeCloseTo(0.1);
    expect(mat.attenuationColor.g).toBeCloseTo(0.4);
    expect(mat.attenuationColor.b).toBeCloseTo(0.9);
    expect(mat.ior).toBe(1.33);
  });
});
