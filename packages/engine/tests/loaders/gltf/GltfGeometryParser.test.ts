import { describe, it, expect } from "vitest";
import { GltfGeometryParser } from "../../../src/loaders/gltf/GltfGeometryParser.js";

describe("GltfGeometryParser", () => {
  it("parses primitive attributes into GeometryDataInterface", async () => {
    const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const norm = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    const buffers = [pos.buffer, norm.buffer];

    const json = {
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 36 },
        { buffer: 1, byteOffset: 0, byteLength: 36 },
      ],
      accessors: [
        { bufferView: 0, byteOffset: 0, componentType: 5126, count: 3, type: "VEC3" },
        { bufferView: 1, byteOffset: 0, componentType: 5126, count: 3, type: "VEC3" },
      ],
    };

    const primitive = {
      attributes: {
        POSITION: 0,
        NORMAL: 1,
      },
    };

    const geo = await GltfGeometryParser.parseGeometry(primitive, json, buffers);
    expect(geo).toBeDefined();
    expect(geo!.vertices).toHaveLength(9);
    expect(geo!.normals).toHaveLength(9);
  });

  it("converts Uint8Array indices and joints to Uint16Array", async () => {
    const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const indicesU8 = new Uint8Array([0, 1, 2]);
    const jointsU8 = new Uint8Array([0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3]);
    const buffers = [pos.buffer, indicesU8.buffer, jointsU8.buffer];

    const json = {
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 36 },
        { buffer: 1, byteOffset: 0, byteLength: 3 },
        { buffer: 2, byteOffset: 0, byteLength: 12 },
      ],
      accessors: [
        { bufferView: 0, byteOffset: 0, componentType: 5126, count: 3, type: "VEC3" },
        { bufferView: 1, byteOffset: 0, componentType: 5121, count: 3, type: "SCALAR" },
        { bufferView: 2, byteOffset: 0, componentType: 5121, count: 3, type: "VEC4" },
      ],
    };

    const primitive = {
      attributes: {
        POSITION: 0,
        JOINTS_0: 2,
      },
      indices: 1,
    };

    const geo = await GltfGeometryParser.parseGeometry(primitive, json, buffers);
    expect(geo).toBeDefined();
    expect(geo!.indices).toBeInstanceOf(Uint16Array);
    expect(Array.from(geo!.indices as Uint16Array)).toEqual([0, 1, 2]);
    expect(geo!.joints).toBeDefined();
    expect(Array.from(geo!.joints!)).toEqual([0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3]);
  });

  it("throws when primitive mode is not TRIANGLES (4)", async () => {
    const pos = new Float32Array([0, 0, 0, 1, 0, 0]);
    const buffers = [pos.buffer];

    const json = {
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 24 }],
      accessors: [{ bufferView: 0, byteOffset: 0, componentType: 5126, count: 2, type: "VEC3" }],
    };

    const primitive = {
      attributes: { POSITION: 0 },
      mode: 1, // LINES
    };

    await expect(GltfGeometryParser.parseGeometry(primitive, json, buffers)).rejects.toThrow(
      /Unsupported primitive mode 1/,
    );
  });
});
