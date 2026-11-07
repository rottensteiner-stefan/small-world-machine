import { describe, it, expect, vi } from "vitest";
import { GltfMaterialParser } from "../../../src/loaders/gltf/GltfMaterialParser.js";
import { AssetManager } from "../../../src/loaders/AssetManager.js";
import { CullMode } from "../../../src/enums/index.js";
import { Texture } from "../../../src/core/textures/index.js";

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
    // glTF colour factors are linear; the engine Colour is sRGB-authored (ADR 0049).
    expect(mat.sheenColor.r).toBeCloseTo(Math.pow(0.95, 1 / 2.2));
    expect(mat.sheenColor.g).toBeCloseTo(Math.pow(0.85, 1 / 2.2));
    expect(mat.sheenColor.b).toBeCloseTo(Math.pow(0.75, 1 / 2.2));
    expect(mat.sheenRoughness).toBe(0.4);
    expect(mat.transmission).toBe(0.88);
    expect(mat.thickness).toBe(2.5);
    expect(mat.attenuationDistance).toBe(12.0);
    expect(mat.attenuationColor.r).toBeCloseTo(Math.pow(0.1, 1 / 2.2));
    expect(mat.attenuationColor.g).toBeCloseTo(Math.pow(0.4, 1 / 2.2));
    expect(mat.attenuationColor.b).toBeCloseTo(Math.pow(0.9, 1 / 2.2));
    expect(mat.ior).toBe(1.33);
  });

  describe("KHR_texture_transform", () => {
    const transformed = {
      index: 0,
      extensions: { KHR_texture_transform: { offset: [0.25, 0.5], scale: [2, 3] } },
    };

    it("maps offset and scale onto Texture.offset/repeat", () => {
      const tex = Texture.fromImage({} as ImageBitmap);

      GltfMaterialParser.applyTextureTransform(tex, transformed);

      expect(tex.offset).toEqual({ x: 0.25, y: 0.5 });
      expect(tex.repeat).toEqual({ x: 2, y: 3 });
    });

    it("leaves the texture untouched without the extension", () => {
      const tex = Texture.fromImage({} as ImageBitmap);

      GltfMaterialParser.applyTextureTransform(tex, { index: 0 });

      expect(tex.offset).toEqual({ x: 0, y: 0 });
      expect(tex.repeat).toEqual({ x: 1, y: 1 });
    });

    it("maps rotation onto Texture.rotation and leaves it at 0 without one", () => {
      const rotated = Texture.fromImage({} as ImageBitmap);
      const plain = Texture.fromImage({} as ImageBitmap);

      GltfMaterialParser.applyTextureTransform(rotated, {
        index: 0,
        extensions: { KHR_texture_transform: { rotation: 0.75 } },
      });
      GltfMaterialParser.applyTextureTransform(plain, transformed);

      expect(rotated.rotation).toBe(0.75);
      expect(plain.rotation).toBe(0);
    });

    it("applies a partial transform (offset only) without touching repeat", () => {
      const tex = Texture.fromImage({} as ImageBitmap);

      GltfMaterialParser.applyTextureTransform(tex, {
        index: 0,
        extensions: { KHR_texture_transform: { offset: [0.1, 0.2] } },
      });

      expect(tex.offset).toEqual({ x: 0.1, y: 0.2 });
      expect(tex.repeat).toEqual({ x: 1, y: 1 });
    });
  });

  describe("KHR_materials_iridescence", () => {
    it("imports factor, film IOR and the thickness range", async () => {
      const mat = await GltfMaterialParser.parseMaterial(
        {
          extensions: {
            KHR_materials_iridescence: {
              iridescenceFactor: 0.9,
              iridescenceIor: 1.6,
              iridescenceThicknessMinimum: 150,
              iridescenceThicknessMaximum: 550,
            },
          },
        },
        {},
        "",
        [],
        new AssetManager(),
      );

      expect(mat.iridescenceFactor).toBe(0.9);
      expect(mat.iridescenceIor).toBe(1.6);
      expect(mat.iridescenceThicknessMinimum).toBe(150);
      expect(mat.iridescenceThicknessMaximum).toBe(550);
    });

    it("reuses one texture for intensity and thickness when both point at the same glTF texture", async () => {
      const packed = Texture.fromImage({} as ImageBitmap);
      const resolve = vi.spyOn(GltfMaterialParser, "resolveTexture").mockResolvedValue(packed);

      const mat = await GltfMaterialParser.parseMaterial(
        {
          extensions: {
            KHR_materials_iridescence: {
              iridescenceFactor: 1,
              iridescenceTexture: { index: 3 },
              iridescenceThicknessTexture: { index: 3 },
            },
          },
        },
        {},
        "",
        [],
        new AssetManager(),
      );
      const calls = resolve.mock.calls.length;
      resolve.mockRestore();

      expect(calls).toBe(1);
      expect(mat.iridescenceMap).toBe(packed);
      expect(mat.iridescenceThicknessMap).toBe(packed);
    });

    it("resolves two textures when intensity and thickness differ", async () => {
      const intensity = Texture.fromImage({} as ImageBitmap);
      const thickness = Texture.fromImage({} as ImageBitmap);
      const resolve = vi
        .spyOn(GltfMaterialParser, "resolveTexture")
        .mockImplementation(async (index) => (index === 1 ? intensity : thickness));

      const mat = await GltfMaterialParser.parseMaterial(
        {
          extensions: {
            KHR_materials_iridescence: {
              iridescenceFactor: 1,
              iridescenceTexture: { index: 1 },
              iridescenceThicknessTexture: {
                index: 2,
                extensions: { KHR_texture_transform: { scale: [2, 2] } },
              },
            },
          },
        },
        {},
        "",
        [],
        new AssetManager(),
      );
      resolve.mockRestore();

      expect(mat.iridescenceMap).toBe(intensity);
      // The transform lives on a per-transform sibling; the shared texture stays untouched.
      expect(mat.iridescenceThicknessMap).not.toBe(thickness);
      expect(mat.iridescenceThicknessMap!.image).toBe(thickness.image);
      expect(mat.iridescenceThicknessMap!.repeat).toEqual({ x: 2, y: 2 });
      expect(thickness.repeat).toEqual({ x: 1, y: 1 });
    });

    it("keeps the spec defaults (off, IOR 1.3, 100..400 nm) without the extension", async () => {
      const mat = await GltfMaterialParser.parseMaterial({}, {}, "", [], new AssetManager());

      expect(mat.iridescenceFactor).toBe(0);
      expect(mat.iridescenceIor).toBe(1.3);
      expect(mat.iridescenceThicknessMinimum).toBe(100);
      expect(mat.iridescenceThicknessMaximum).toBe(400);
    });
  });

  describe("KHR_materials_anisotropy", () => {
    it("imports anisotropyStrength and anisotropyRotation", async () => {
      const mat = await GltfMaterialParser.parseMaterial(
        {
          extensions: {
            KHR_materials_anisotropy: { anisotropyStrength: 0.8, anisotropyRotation: 1.25 },
          },
        },
        {},
        "",
        [],
        new AssetManager(),
      );

      expect(mat.anisotropyStrength).toBe(0.8);
      expect(mat.anisotropyRotation).toBe(1.25);
    });

    it("resolves anisotropyTexture and applies its texture transform", async () => {
      const directionMap = Texture.fromImage({} as ImageBitmap);
      const resolve = vi
        .spyOn(GltfMaterialParser, "resolveTexture")
        .mockResolvedValue(directionMap);

      const mat = await GltfMaterialParser.parseMaterial(
        {
          extensions: {
            KHR_materials_anisotropy: {
              anisotropyStrength: 1,
              anisotropyTexture: {
                index: 0,
                extensions: { KHR_texture_transform: { offset: [0.5, 0] } },
              },
            },
          },
        },
        {},
        "",
        [],
        new AssetManager(),
      );
      resolve.mockRestore();

      expect(mat.anisotropyMap).not.toBe(directionMap);
      expect(mat.anisotropyMap!.image).toBe(directionMap.image);
      expect(mat.anisotropyMap!.offset).toEqual({ x: 0.5, y: 0 });
      expect(directionMap.offset).toEqual({ x: 0, y: 0 });
    });

    it("keeps the isotropic defaults without the extension", async () => {
      const mat = await GltfMaterialParser.parseMaterial({}, {}, "", [], new AssetManager());

      expect(mat.anisotropyStrength).toBe(0);
      expect(mat.anisotropyRotation).toBe(0);
    });
  });

  describe("KHR_materials_specular", () => {
    it("imports specularFactor and encodes the linear specularColorFactor once", async () => {
      const mat = await GltfMaterialParser.parseMaterial(
        {
          extensions: {
            KHR_materials_specular: { specularFactor: 0.4, specularColorFactor: [1, 0.5, 0.25] },
          },
        },
        {},
        "",
        [],
        new AssetManager(),
      );

      expect(mat.specularFactor).toBe(0.4);
      expect(mat.specularColor.r).toBeCloseTo(1);
      expect(mat.specularColor.g).toBeCloseTo(Math.pow(0.5, 1 / 2.2));
      expect(mat.specularColor.b).toBeCloseTo(Math.pow(0.25, 1 / 2.2));
    });

    it("resolves specularTexture and specularColorTexture and applies their transforms", async () => {
      const weight = Texture.fromImage({} as ImageBitmap);
      const tint = Texture.fromImage({} as ImageBitmap);
      const resolve = vi
        .spyOn(GltfMaterialParser, "resolveTexture")
        .mockImplementation(async (index) => (index === 0 ? weight : tint));

      const mat = await GltfMaterialParser.parseMaterial(
        {
          extensions: {
            KHR_materials_specular: {
              specularTexture: {
                index: 0,
                extensions: { KHR_texture_transform: { scale: [2, 2] } },
              },
              specularColorTexture: { index: 1 },
            },
          },
        },
        {},
        "",
        [],
        new AssetManager(),
      );
      resolve.mockRestore();

      expect(mat.specularMap).not.toBe(weight);
      expect(mat.specularMap!.image).toBe(weight.image);
      expect(mat.specularMap!.repeat).toEqual({ x: 2, y: 2 });
      expect(mat.specularColorMap).toBe(tint);
      expect(weight.repeat).toEqual({ x: 1, y: 1 });
    });

    it("keeps the spec defaults without the extension", async () => {
      const mat = await GltfMaterialParser.parseMaterial({}, {}, "", [], new AssetManager());

      expect(mat.specularFactor).toBe(1);
      expect(mat.specularColor.r).toBe(1);
      expect(mat.specularColor.g).toBe(1);
      expect(mat.specularColor.b).toBe(1);
    });
  });

  describe("KHR_materials_unlit", () => {
    it("marks the material unlit when the extension is present", async () => {
      const mat = await GltfMaterialParser.parseMaterial(
        {
          pbrMetallicRoughness: { baseColorFactor: [0.8, 0.4, 0.2, 1.0] },
          extensions: { KHR_materials_unlit: {} },
        },
        {},
        "",
        [],
        new AssetManager(),
      );

      expect(mat.unlit).toBe(true);
      expect(mat.getRenderManifest().flags).toContain("USE_UNLIT");
    });

    it("keeps the material lit without the extension", async () => {
      const mat = await GltfMaterialParser.parseMaterial({}, {}, "", [], new AssetManager());

      expect(mat.unlit).toBe(false);
      expect(mat.getRenderManifest().flags).not.toContain("USE_UNLIT");
    });
  });
});
