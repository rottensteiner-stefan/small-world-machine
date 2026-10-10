import { describe, it, expect } from "vitest";
import { Object3D } from "../../../src/core/Object3D.js";
import { StandardMaterial } from "../../../src/core/materials/surface/StandardMaterial.js";
import { Color } from "../../../src/core/colors/Color.js";
import { GltfVariants } from "../../../src/loaders/gltf/GltfVariants.js";
import { GltfLoader } from "../../../src/loaders/GltfLoader.js";
import { AssetManager } from "../../../src/loaders/AssetManager.js";
import { GltfJson } from "../../../src/loaders/gltf/types.js";

describe("GltfVariants (KHR_materials_variants)", () => {
  it("queries variant names and switches materials across hierarchy", () => {
    const root = new Object3D("Root");
    root.userData["gltfVariants"] = ["Midnight Black", "Cherry Red", "Brushed Silver"];

    const defaultMat = new StandardMaterial({ color: new Color(1, 1, 1) });
    const blackMat = new StandardMaterial({ color: new Color(0, 0, 0) });
    const redMat = new StandardMaterial({ color: new Color(1, 0, 0) });
    const silverMat = new StandardMaterial({ color: new Color(0.8, 0.8, 0.8) });

    const childMesh = new Object3D("Mesh1");
    childMesh.material = defaultMat;
    childMesh.userData["gltfDefaultMaterial"] = defaultMat;
    childMesh.userData["gltfMaterialVariants"] = {
      0: blackMat,
      1: redMat,
      2: silverMat,
    };
    root.add(childMesh);

    expect(GltfVariants.getVariantNames(root)).toEqual([
      "Midnight Black",
      "Cherry Red",
      "Brushed Silver",
    ]);

    // Select by name
    const okName = GltfVariants.selectVariant(root, "Cherry Red");
    expect(okName).toBe(true);
    expect(childMesh.material).toBe(redMat);

    // Select by index
    const okIndex = GltfVariants.selectVariant(root, 0);
    expect(okIndex).toBe(true);
    expect(childMesh.material).toBe(blackMat);

    // Reset to default
    const okReset = GltfVariants.selectVariant(root, null);
    expect(okReset).toBe(true);
    expect(childMesh.material).toBe(defaultMat);

    // Unknown variant returns false
    const okUnknown = GltfVariants.selectVariant(root, "Neon Green");
    expect(okUnknown).toBe(false);
    expect(childMesh.material).toBe(defaultMat);
  });

  it("parses KHR_materials_variants in GltfLoader and applies initial variant option", async () => {
    const gltfJson: GltfJson = {
      asset: { version: "2.0" },
      extensions: {
        KHR_materials_variants: {
          variants: [{ name: "Variant_A" }, { name: "Variant_B" }],
        },
      },
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
      accessors: [{ bufferView: 0, byteOffset: 0, componentType: 5126, count: 3, type: "VEC3" }],
      materials: [
        { pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }, // 0: default
        { pbrMetallicRoughness: { baseColorFactor: [1, 0, 0, 1] } }, // 1: variant A
        { pbrMetallicRoughness: { baseColorFactor: [0, 0, 1, 1] } }, // 2: variant B
      ],
      meshes: [
        {
          primitives: [
            {
              attributes: { POSITION: 0 },
              material: 0,
              extensions: {
                KHR_materials_variants: {
                  mappings: [
                    { material: 1, variants: [0] },
                    { material: 2, variants: [1] },
                  ],
                },
              },
            },
          ],
        },
      ],
      nodes: [{ name: "Node_0", mesh: 0 }],
      scenes: [{ nodes: [0] }],
      scene: 0,
    };

    // Mock buffers for dummy vertex position accessor
    const posBuffer = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]).buffer;

    const loader = new GltfLoader({
      variant: "Variant_B",
      assetManager: new AssetManager(),
    });

    const root = await loader.parse({ json: gltfJson, buffers: [posBuffer] }, "test.gltf");

    expect(GltfVariants.getVariantNames(root)).toEqual(["Variant_A", "Variant_B"]);

    const meshNode = root.children[0]!.children[0]!;
    expect(meshNode).toBeDefined();

    // Since variant: "Variant_B" was specified in options, material should be material 2 (blue)
    const matB = meshNode.material as StandardMaterial;
    expect(matB.color.b).toBe(1);
    expect(matB.color.r).toBe(0);

    // Switch to Variant_A
    GltfVariants.selectVariant(root, "Variant_A");
    const matA = meshNode.material as StandardMaterial;
    expect(matA.color.r).toBe(1);
    expect(matA.color.b).toBe(0);

    // Reset to default
    GltfVariants.selectVariant(root, null);
    const matDef = meshNode.material as StandardMaterial;
    expect(matDef.color.r).toBe(1);
    expect(matDef.color.g).toBe(1);
    expect(matDef.color.b).toBe(1);
  });
});
