import { describe, it, expect } from "vitest";
import { Object3D } from "../../src/core/Object3D.js";
import { StandardMaterial } from "../../src/core/materials/surface/StandardMaterial.js";
import { Color } from "../../src/core/colors/index.js";
import { Cube } from "../../src/geometry/Cube.js";
import { GltfBinaryParser } from "../../src/loaders/gltf/GltfBinaryParser.js";
import { GltfLoader } from "../../src/loaders/GltfLoader.js";
import { WorldWriter } from "../../src/loaders/WorldWriter.js";
import { GlbWriter } from "../../src/loaders/GlbWriter.js";

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

describe("GlbWriter & WorldWriter binary export", () => {
  it("packs JSON + binary payload into 4-byte-aligned GLB v2 chunks parseable by GltfBinaryParser", () => {
    const json = { asset: { version: "2.0" }, buffers: [{ byteLength: 5 }] };
    const bin = new Uint8Array([1, 2, 3, 4, 5]);
    const glb = GlbWriter.pack(json, bin);

    const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
    expect(view.getUint32(0, true)).toBe(0x46546c67); // "glTF"
    expect(view.getUint32(4, true)).toBe(2);
    expect(view.getUint32(8, true)).toBe(glb.byteLength);
    expect(glb.byteLength % 4).toBe(0);

    const parsed = GltfBinaryParser.parseGlb(toArrayBuffer(glb));
    expect(parsed.json.asset?.version).toBe("2.0");
    expect(parsed.buffers).toHaveLength(1);
    expect(new Uint8Array(parsed.buffers[0]!).slice(0, 5)).toEqual(bin);
  });

  it("round-trips a live scene graph through WorldWriter.writeGlb() and GltfLoader.parse()", async () => {
    const root = new Object3D("WorldRoot");
    const mesh = new Object3D("Box");
    mesh.geometry = new Cube({ size: 2 }).getGeometryData();
    mesh.position.set(1, 2, 3);
    mesh.material = new StandardMaterial({ color: new Color(0.2, 0.6, 0.8), roughness: 0.4 });
    root.add(mesh);

    const glb = new WorldWriter().writeGlb(root);
    const parsed = GltfBinaryParser.parseGlb(toArrayBuffer(glb));
    expect(parsed.json.buffers?.[0]?.uri).toBeUndefined();

    const loaded = await new GltfLoader().parse(parsed);
    expect(loaded.children).toHaveLength(1);
    const child = loaded.children[0]!;
    expect(child.name).toBe("Box");
    expect(child.position.x).toBeCloseTo(1, 5);
    expect(child.children).toHaveLength(1);
    const loadedMesh = child.children[0]!;
    expect(loadedMesh.geometry?.vertices.length).toBe(mesh.geometry?.vertices.length);
    const loadedMat = loadedMesh.material as StandardMaterial;
    expect(loadedMat.roughness).toBeCloseTo(0.4, 5);
  });

  it("packs WorldWriter .gltf (data URI) into a self-contained GLB via GlbWriter.packGltf()", async () => {
    const tri = new Object3D("Tri");
    tri.geometry = new Cube({ size: 1 }).getGeometryData();
    tri.material = new StandardMaterial();
    const doc = new WorldWriter().writeSingle(tri);

    const glb = await GlbWriter.packGltf(doc);
    const parsed = GltfBinaryParser.parseGlb(toArrayBuffer(glb));
    expect(parsed.json.buffers?.[0]?.uri).toBeUndefined();
    expect(parsed.json.nodes?.[0]?.name).toBe("Tri");
  });
});
