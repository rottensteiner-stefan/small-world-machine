import { describe, expect, it } from "vitest";
import type { GeometryDataInterface, StandardMaterial } from "@small-world-machine/engine";
import { mergeVegetationParts, type VegetationPart } from "../src/species/VegetationSpecies.js";

function part(name: string, offsetY: number, color: [number, number, number]): VegetationPart {
  const geometry = {
    vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    indices: new Uint32Array([0, 1, 2]),
    uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
  } as unknown as GeometryDataInterface;
  const material = {
    color: { r: color[0], g: color[1], b: color[2] },
  } as unknown as StandardMaterial;
  return { name, geometry, material, offsetY };
}

describe("mergeVegetationParts", () => {
  it("bakes offsetY, offsets indices per part and keeps part-major order", () => {
    const geo = mergeVegetationParts([
      part("trunk", 0, [0.5, 0.3, 0.1]),
      part("leaves", 2, [0.2, 0.6, 0.2]),
    ]);
    expect(geo.vertices.length).toBe(18);
    expect(geo.vertices[9 + 1]).toBe(2); // second part, first vertex y = 0 + offsetY 2
    expect(Array.from(geo.indices!)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(geo.materialLayers).toBeUndefined();
  });

  it("without a manifest: linear part colour + green-dominant foliage mask", () => {
    const geo = mergeVegetationParts([
      part("trunk", 0, [0.5, 0.3, 0.1]),
      part("leaves", 0, [0.2, 0.6, 0.2]),
    ]);
    expect(geo.colors![3]).toBe(0);
    expect(geo.colors![3 * 4 + 3]).toBe(1);
    expect(geo.colors![0]).toBeLessThan(0.5); // sRGB 0.5 -> linear ~0.21
  });

  it("with a manifest: white albedo, sidecar foliage mask and part-ordinal material layers", () => {
    const manifest = {
      stem: "t",
      layers: [
        { albedo: "a.jpg", foliage: 0 },
        { albedo: "b.png", foliage: 1, cutout: true },
      ],
    };
    const geo = mergeVegetationParts(
      [part("wood", 0, [0.5, 0.3, 0.1]), part("leaf", 0, [0.5, 0.3, 0.1])],
      manifest,
    );
    expect(Array.from(geo.colors!.subarray(0, 4))).toEqual([1, 1, 1, 0]);
    expect(geo.colors![3 * 4 + 3]).toBe(1);
    expect(Array.from(geo.materialLayers!)).toEqual([0, 0, 0, 1, 1, 1]);
  });
});
