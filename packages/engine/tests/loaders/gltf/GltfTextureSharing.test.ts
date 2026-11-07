import { describe, it, expect, vi, afterEach } from "vitest";
import "../../../src/loaders/gltf/extensions/index.js";
import { GltfMaterialParser } from "../../../src/loaders/gltf/GltfMaterialParser.js";
import { AssetManager } from "../../../src/loaders/AssetManager.js";
import type { StandardMaterial } from "../../../src/core/materials/index.js";
import type { GltfJson } from "../../../src/loaders/gltf/types.js";
import type { GltfReadContext } from "../../../src/loaders/gltf/GltfExtensionPlugin.js";

function makeAssetManager(): { am: AssetManager; loadImage: ReturnType<typeof vi.fn> } {
  const am = new AssetManager();
  const loadImage = vi.fn(
    async () => ({ width: 4, height: 4, close: () => {} }) as unknown as ImageBitmap,
  );
  vi.spyOn(am, "loadImage").mockImplementation(loadImage);
  return { am, loadImage };
}

function json(materials: NonNullable<GltfJson["materials"]>): GltfJson {
  return {
    asset: { version: "2.0" },
    images: [{ uri: "a.png" }],
    textures: [{ source: 0 }],
    materials,
  };
}

async function parse(
  j: GltfJson,
  am: AssetManager,
  ctx?: GltfReadContext,
): Promise<StandardMaterial> {
  return GltfMaterialParser.parseMaterial(
    j.materials![0]!,
    j,
    "m/",
    [],
    am,
    {},
    ctx ?? { json: j, state: new Map() },
  );
}

describe("glTF texture sharing per parse", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shares one Texture between slots with the same texture index (ORM, specular)", async () => {
    const { am } = makeAssetManager();
    const j = json([
      {
        pbrMetallicRoughness: { metallicRoughnessTexture: { index: 0 } },
        occlusionTexture: { index: 0 },
        extensions: {
          KHR_materials_specular: {
            specularTexture: { index: 0 },
            specularColorTexture: { index: 0 },
          },
        },
      } as never,
    ]);
    const mat = await parse(j, am);
    expect(mat.aoMap).toBeDefined();
    expect(mat.aoMap).toBe(mat.metallicMap);
    expect(mat.metallicMap).toBe(mat.roughnessMap);
    expect(mat.specularMap).toBeDefined();
    expect(mat.specularMap).toBe(mat.specularColorMap);
  });

  it("shares the Texture across materials of one parse and decodes once", async () => {
    const { am, loadImage } = makeAssetManager();
    const j = json([
      { pbrMetallicRoughness: { baseColorTexture: { index: 0 } } },
      { pbrMetallicRoughness: { baseColorTexture: { index: 0 } } },
    ]);
    const ctx: GltfReadContext = { json: j, state: new Map() };
    const [a, b] = await Promise.all([
      GltfMaterialParser.parseMaterial(j.materials![0]!, j, "m/", [], am, {}, ctx),
      GltfMaterialParser.parseMaterial(j.materials![1]!, j, "m/", [], am, {}, ctx),
    ]);
    expect(a.diffuseMap).toBe(b.diffuseMap);
    expect(loadImage).toHaveBeenCalledTimes(1);
  });

  it("gives slots with different KHR_texture_transform their own Texture without mutating the shared one", async () => {
    const { am, loadImage } = makeAssetManager();
    const j = json([
      {
        pbrMetallicRoughness: {
          baseColorTexture: {
            index: 0,
            extensions: { KHR_texture_transform: { offset: [0.5, 0], scale: [2, 2] } },
          },
          metallicRoughnessTexture: { index: 0 },
        },
        emissiveTexture: { index: 0 },
      },
    ]);
    const mat = await parse(j, am);
    expect(mat.diffuseMap).not.toBe(mat.metallicMap);
    expect(mat.diffuseMap!.offset.x).toBe(0.5);
    expect(mat.diffuseMap!.repeat.x).toBe(2);
    expect(mat.metallicMap!.offset.x).toBe(0);
    expect(mat.metallicMap!.repeat.x).toBe(1);
    expect(mat.emissiveMap).toBe(mat.metallicMap);
    expect(mat.diffuseMap!.image).toBe(mat.metallicMap!.image);
    expect(loadImage).toHaveBeenCalledTimes(1);
  });

  it("decodes bufferView images without touching the AssetManager URL cache", async () => {
    const { am, loadImage } = makeAssetManager();
    const create = vi.fn(async () => ({ width: 2, height: 2 }) as unknown as ImageBitmap);
    vi.stubGlobal("createImageBitmap", create);
    try {
      const j: GltfJson = {
        asset: { version: "2.0" },
        bufferViews: [{ buffer: 0, byteLength: 4 }],
        images: [{ bufferView: 0, mimeType: "image/png" }],
        textures: [{ source: 0 }],
        materials: [
          {
            pbrMetallicRoughness: { baseColorTexture: { index: 0 } },
            emissiveTexture: { index: 0 },
          },
        ],
      };
      const mat = await GltfMaterialParser.parseMaterial(
        j.materials![0]!,
        j,
        "",
        [new ArrayBuffer(4)],
        am,
        {},
        { json: j, state: new Map() },
      );
      expect(mat.diffuseMap).toBe(mat.emissiveMap);
      expect(create).toHaveBeenCalledTimes(1);
      expect(loadImage).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("glTF material slot parameters", () => {
  afterEach(() => vi.restoreAllMocks());

  it("applies normalTexture.scale to normalScale", async () => {
    const { am } = makeAssetManager();
    const j = json([{ normalTexture: { index: 0, scale: 0.4 } }]);
    const mat = await parse(j, am);
    expect(mat.normalScale.x).toBeCloseTo(0.4);
    expect(mat.normalScale.y).toBeCloseTo(0.4);
  });

  it("warns once per slot for texCoord != 0 and stays silent for texCoord 0", async () => {
    const { am } = makeAssetManager();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const j = json([
      {
        pbrMetallicRoughness: { baseColorTexture: { index: 0, texCoord: 1 } },
        occlusionTexture: {
          index: 0,
          extensions: { KHR_texture_transform: { texCoord: 2 } },
        },
        emissiveTexture: { index: 0, texCoord: 0 },
      },
    ]);
    await parse(j, am);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[0]![0])).toContain("texCoord 1");
    expect(String(warn.mock.calls[1]![0])).toContain("texCoord 2");
  });
});
