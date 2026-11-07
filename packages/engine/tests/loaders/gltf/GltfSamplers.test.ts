import { describe, it, expect, vi, afterEach } from "vitest";
import "../../../src/loaders/gltf/extensions/index.js";
import { GltfMaterialParser } from "../../../src/loaders/gltf/GltfMaterialParser.js";
import { AssetManager } from "../../../src/loaders/AssetManager.js";
import { TextureFilter, TextureWrap } from "../../../src/enums/index.js";
import type { StandardMaterial } from "../../../src/core/materials/index.js";
import type { GltfJson } from "../../../src/loaders/gltf/types.js";

function makeAm(): AssetManager {
  const am = new AssetManager();
  vi.spyOn(am, "loadImage").mockImplementation(
    async () => ({ width: 4, height: 4, close: () => {} }) as unknown as ImageBitmap,
  );
  return am;
}

async function parse(j: GltfJson): Promise<StandardMaterial> {
  return GltfMaterialParser.parseMaterial(
    j.materials![0]!,
    j,
    "m/",
    [],
    makeAm(),
    {},
    {
      json: j,
      state: new Map(),
    },
  );
}

const base = (): GltfJson => ({
  asset: { version: "2.0" },
  images: [{ uri: "a.png" }],
  textures: [{ source: 0, sampler: 0 }],
  samplers: [{ wrapS: 33071, wrapT: 33648, magFilter: 9728, minFilter: 9987 }],
  materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
});

describe("glTF samplers", () => {
  afterEach(() => vi.restoreAllMocks());

  it("maps wrapS/wrapT/filters onto the Texture", async () => {
    const mat = await parse(base());
    const tex = mat.diffuseMap!;
    expect(tex.addressModeU).toBe(TextureWrap.CLAMP_TO_EDGE);
    expect(tex.addressModeV).toBe(TextureWrap.MIRRORED_REPEAT);
    expect(tex.magFilter).toBe(TextureFilter.NEAREST);
    expect(tex.minFilter).toBe(TextureFilter.LINEAR_MIPMAP_LINEAR);
  });

  it("keeps defaults without a sampler and maps 10497 to repeat", async () => {
    const j = base();
    delete j.textures![0]!.sampler;
    const tex = (await parse(j)).diffuseMap!;
    expect(tex.addressModeU).toBe(TextureWrap.DEFAULT);
    const j2 = base();
    j2.samplers = [{ wrapS: 10497 }];
    const tex2 = (await parse(j2)).diffuseMap!;
    expect(tex2.addressModeU).toBe(TextureWrap.REPEAT);
    expect(tex2.addressModeV).toBe(TextureWrap.DEFAULT);
  });

  it("gives textures with different samplers distinct instances with their own modes", async () => {
    const j = base();
    j.textures = [
      { source: 0, sampler: 0 },
      { source: 0, sampler: 1 },
    ];
    j.samplers = [{ wrapS: 33071 }, { wrapS: 33648 }];
    j.materials = [
      {
        pbrMetallicRoughness: { baseColorTexture: { index: 0 } },
        normalTexture: { index: 1 },
      },
    ];
    const mat = await parse(j);
    expect(mat.diffuseMap).not.toBe(mat.normalMap);
    expect(mat.diffuseMap!.addressModeU).toBe(TextureWrap.CLAMP_TO_EDGE);
    expect(mat.normalMap!.addressModeU).toBe(TextureWrap.MIRRORED_REPEAT);
  });

  it("keeps sampler modes on the per-transform sibling texture", async () => {
    const j = base();
    j.materials = [
      {
        pbrMetallicRoughness: {
          baseColorTexture: {
            index: 0,
            extensions: { KHR_texture_transform: { scale: [2, 2] } },
          },
        },
      } as never,
    ];
    const tex = (await parse(j)).diffuseMap!;
    expect(tex.repeat.x).toBe(2);
    expect(tex.addressModeU).toBe(TextureWrap.CLAMP_TO_EDGE);
    expect(tex.magFilter).toBe(TextureFilter.NEAREST);
  });
});

describe("glTF unresolved texture slots warn", () => {
  afterEach(() => vi.restoreAllMocks());

  it("warns for invalid index, missing source, missing image and missing bufferView", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cases: GltfJson[] = [
      { ...base(), materials: [{ pbrMetallicRoughness: { baseColorTexture: { index: 9 } } }] },
      { ...base(), textures: [{}] },
      { ...base(), textures: [{ source: 5 }] },
      { ...base(), images: [{ bufferView: 0 }] },
    ];
    for (const j of cases) {
      warn.mockClear();
      const mat = await parse(j);
      expect(mat.diffuseMap).toBeUndefined();
      expect(warn).toHaveBeenCalledTimes(1);
    }
  });

  it("warns once per texture index when several slots reference it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const j = base();
    j.textures = [{}];
    j.materials = [
      {
        pbrMetallicRoughness: { baseColorTexture: { index: 0 } },
        normalTexture: { index: 0 },
        emissiveTexture: { index: 0 },
      },
    ];
    await parse(j);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("glTF KHR_materials_volume / sheen / specular spec defaults", () => {
  it("present-but-empty extensions yield the spec defaults (no attenuation, factors 1/black)", async () => {
    const j = base();
    j.materials = [
      {
        extensions: {
          KHR_materials_volume: {},
          KHR_materials_sheen: {},
          KHR_materials_specular: {},
        },
      } as never,
    ];
    const mat = await parse(j);
    expect(mat.attenuationDistance).toBeGreaterThanOrEqual(1000);
    expect(mat.attenuationColor.r).toBe(1);
    expect(mat.sheenColor.r).toBe(0);
    expect(mat.sheenRoughness).toBe(0);
    expect(mat.specularFactor).toBe(1);
    expect(mat.specularColor.r).toBe(1);
  });
});
