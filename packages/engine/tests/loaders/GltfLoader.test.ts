import { describe, it, expect, vi } from "vitest";
import { GltfLoader } from "../../src/loaders/GltfLoader.js";
import { Topology } from "../../src/enums/index.js";
import type { StandardMaterial } from "../../src/core/materials/surface/StandardMaterial.js";
import type { Object3D } from "../../src/core/Object3D.js";

describe("GltfLoader PBR Options", () => {
  it("should apply defaultMetallic and defaultRoughness when factors are omitted", async () => {
    const loader = new GltfLoader({
      defaultMetallic: 0.1,
      defaultRoughness: 0.8,
    });

    const mat = await (
      loader as unknown as {
        _parseMaterial: (
          m: unknown,
          json: unknown,
          folder: string,
          buffers: ArrayBuffer[],
        ) => Promise<StandardMaterial>;
      }
    )._parseMaterial({ pbrMetallicRoughness: {} }, {}, "", []);

    expect(mat.metallic).toBe(0.1);
    expect(mat.roughness).toBe(0.8);
  });

  it("should clamp metallic factor to upper bound", async () => {
    const loader = new GltfLoader({
      clampMetallic: 0.25,
    });

    const mat = await (
      loader as unknown as {
        _parseMaterial: (
          m: unknown,
          json: unknown,
          folder: string,
          buffers: ArrayBuffer[],
        ) => Promise<StandardMaterial>;
      }
    )._parseMaterial(
      { pbrMetallicRoughness: { metallicFactor: 1.0, roughnessFactor: 0.5 } },
      {},
      "",
      [],
    );

    expect(mat.metallic).toBe(0.25);
    expect(mat.roughness).toBe(0.5);
  });

  it("should clamp metallic and roughness to [min, max] range", async () => {
    const loader = new GltfLoader({
      clampMetallic: [0.1, 0.4],
      clampRoughness: [0.3, 0.7],
    });

    const matOver = await (
      loader as unknown as {
        _parseMaterial: (
          m: unknown,
          json: unknown,
          folder: string,
          buffers: ArrayBuffer[],
        ) => Promise<StandardMaterial>;
      }
    )._parseMaterial(
      { pbrMetallicRoughness: { metallicFactor: 0.9, roughnessFactor: 0.95 } },
      {},
      "",
      [],
    );

    expect(matOver.metallic).toBe(0.4);
    expect(matOver.roughness).toBe(0.7);

    const matUnder = await (
      loader as unknown as {
        _parseMaterial: (
          m: unknown,
          json: unknown,
          folder: string,
          buffers: ArrayBuffer[],
        ) => Promise<StandardMaterial>;
      }
    )._parseMaterial(
      { pbrMetallicRoughness: { metallicFactor: 0.02, roughnessFactor: 0.1 } },
      {},
      "",
      [],
    );

    expect(matUnder.metallic).toBe(0.1);
    expect(matUnder.roughness).toBe(0.3);
  });

  it("should invoke onMaterialParsed with the constructed material and raw definition", async () => {
    const seen: unknown[] = [];
    const loader = new GltfLoader({
      onMaterialParsed: (material, rawDef): void => {
        seen.push([material, rawDef]);
      },
    });

    const rawDef = { pbrMetallicRoughness: { metallicFactor: 0.4 } };
    const mat = await (
      loader as unknown as {
        _parseMaterial: (
          m: unknown,
          json: unknown,
          folder: string,
          buffers: ArrayBuffer[],
        ) => Promise<StandardMaterial>;
      }
    )._parseMaterial(rawDef, {}, "", []);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toEqual([mat, rawDef]);
  });
});

describe("GltfLoader node-parsing options", () => {
  it("should apply nodeNameTransform to every parsed node's name", async () => {
    const loader = new GltfLoader({
      nodeNameTransform: (name): string => name.toUpperCase(),
    });

    const root = await loader.parse({ json: { nodes: [{ name: "hero" }] }, buffers: [] }, "");

    expect(root.getObjectByName("HERO")).toBeDefined();
    expect(root.getObjectByName("hero")).toBeUndefined();
  });

  it("should normalize numeric Mixamo rig prefixes when normalizeMixamoRig is set", async () => {
    const loader = new GltfLoader({ normalizeMixamoRig: true });

    const root = await loader.parse(
      { json: { nodes: [{ name: "mixamorig3:Hips" }] }, buffers: [] },
      "",
    );

    expect(root.getObjectByName("mixamorig:Hips")).toBeDefined();
  });

  it("should invoke onNodeParsed once per node with the object and its raw definition", async () => {
    const seen: { name: string; rawName: unknown }[] = [];
    const loader = new GltfLoader({
      onNodeParsed: (object, rawDef): void => {
        seen.push({ name: object.name, rawName: rawDef["name"] });
      },
    });

    await loader.parse({ json: { nodes: [{ name: "A" }, { name: "B" }] }, buffers: [] }, "");

    expect(seen).toEqual([
      { name: "A", rawName: "A" },
      { name: "B", rawName: "B" },
    ]);
  });

  it("should invoke onParsed once with the final scene root after the full hierarchy is built", async () => {
    let receivedRoot: Object3D | undefined;
    const loader = new GltfLoader({
      onParsed: (root): void => {
        receivedRoot = root;
      },
    });

    const root = await loader.parse({ json: { nodes: [{ name: "A" }] }, buffers: [] }, "");

    expect(receivedRoot).toBe(root);
    expect(receivedRoot?.getObjectByName("A")).toBeDefined();
  });
});

describe("GltfLoader validation and fail-fast", () => {
  it("should throw when glTF version is unsupported (< 2.0)", async () => {
    const loader = new GltfLoader();
    await expect(
      loader.parse({ json: { asset: { version: "1.0" } }, buffers: [] }, ""),
    ).rejects.toThrow(/Unsupported glTF version/);
  });

  it("should throw when extensionsRequired contains unsupported extension", async () => {
    const loader = new GltfLoader();
    await expect(
      loader.parse(
        {
          json: {
            asset: { version: "2.0" },
            extensionsRequired: ["KHR_draco_mesh_compression"],
          },
          buffers: [],
        },
        "",
      ),
    ).rejects.toThrow(/Unsupported required extension/);
  });

  it("should not throw when extensionsRequired contains supported extensions", async () => {
    const loader = new GltfLoader();
    const root = await loader.parse(
      {
        json: {
          asset: { version: "2.0" },
          extensionsRequired: ["KHR_materials_variants"],
        },
        buffers: [],
      },
      "",
    );
    expect(root).toBeDefined();
  });

  it("loads a LINES primitive next to the triangle primitive of the same mesh", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const buffer = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer;
    const loader = new GltfLoader();
    const root = await loader.parse(
      {
        json: {
          asset: { version: "2.0" },
          scene: 0,
          scenes: [{ nodes: [0] }],
          nodes: [{ name: "Mixed", mesh: 0 }],
          meshes: [
            {
              primitives: [
                { attributes: { POSITION: 0 }, mode: 1 },
                { attributes: { POSITION: 0 }, mode: 4 },
              ],
            },
          ],
          accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3" }],
          bufferViews: [{ buffer: 0, byteLength: 36 }],
        },
        buffers: [buffer],
      },
      "",
    );

    const meshes = root.getObjectByName("Mixed")?.children ?? [];
    expect(meshes).toHaveLength(2);
    expect(meshes.map((m) => m.geometry?.topology)).toEqual([
      Topology.LINE_LIST,
      Topology.TRIANGLE_LIST,
    ]);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("loads a KHR_mesh_quantization primitive (Int16 positions, dequantized by the node scale)", async () => {
    const buffer = new ArrayBuffer(18);
    new Int16Array(buffer).set([0, 0, 0, 1000, 0, 0, 0, 2000, 0]);
    const loader = new GltfLoader();
    const root = await loader.parse(
      {
        json: {
          asset: { version: "2.0" },
          extensionsRequired: ["KHR_mesh_quantization"],
          extensionsUsed: ["KHR_mesh_quantization"],
          scene: 0,
          scenes: [{ nodes: [0] }],
          nodes: [{ name: "Quantized", mesh: 0, scale: [0.001, 0.001, 0.001] }],
          meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
          accessors: [{ bufferView: 0, componentType: 5122, count: 3, type: "VEC3" }],
          bufferViews: [{ buffer: 0, byteLength: 18 }],
        },
        buffers: [buffer],
      },
      "",
    );

    const node = root.getObjectByName("Quantized");
    expect(node).toBeDefined();
    expect(node?.scale.x).toBeCloseTo(0.001, 9);
  });
});

describe("GltfLoader asset.version", () => {
  it("warns when the required asset.version is missing, but still loads", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const loader = new GltfLoader();
    const parse = (
      loader as unknown as {
        _parse: (gltf: unknown, baseUrl: string) => Promise<Object3D>;
      }
    )._parse.bind(loader);
    await parse({ json: { scenes: [{ nodes: [] }], scene: 0 }, buffers: [] }, "x.gltf");
    expect(warn.mock.calls.some((c) => String(c[0]).includes("asset.version"))).toBe(true);
    warn.mockRestore();
  });
});
