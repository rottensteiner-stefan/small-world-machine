import { describe, it, expect } from "vitest";
import { GltfBinaryParser } from "../../../src/loaders/gltf/GltfBinaryParser.js";

describe("GltfBinaryParser", () => {
  it("decodes Base64 data URIs correctly", () => {
    // "Hello" in base64 is "SGVsbG8="
    const dataUri = "data:application/octet-stream;base64,SGVsbG8=";
    const buffer = GltfBinaryParser.decodeBase64(dataUri);
    const text = new TextDecoder().decode(buffer);
    expect(text).toBe("Hello");
  });

  it("calculates component counts for glTF accessor types", () => {
    expect(GltfBinaryParser.getComponentCount("SCALAR")).toBe(1);
    expect(GltfBinaryParser.getComponentCount("VEC2")).toBe(2);
    expect(GltfBinaryParser.getComponentCount("VEC3")).toBe(3);
    expect(GltfBinaryParser.getComponentCount("VEC4")).toBe(4);
    expect(GltfBinaryParser.getComponentCount("MAT4")).toBe(16);
  });

  it("extracts typed buffer data from accessors", () => {
    const rawFloats = new Float32Array([1.0, 2.0, 3.0, 4.0]);
    const buffers = [rawFloats.buffer];

    const json = {
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 16 }],
      accessors: [{ bufferView: 0, byteOffset: 0, componentType: 5126, count: 4, type: "SCALAR" }],
    };

    const data = GltfBinaryParser.getBufferData(json.accessors[0], json, buffers);
    expect(data).toBeInstanceOf(Float32Array);
    expect(Array.from(data as Float32Array)).toEqual([1, 2, 3, 4]);
  });

  it("handles unaligned byte offsets without throwing RangeError [BLK-L3]", () => {
    // Create an ArrayBuffer with an odd byte offset (e.g. 1 or 3 bytes into the buffer)
    const rawFloats = new Float32Array([10.0, 20.0, 30.0]);
    const byteLength = rawFloats.byteLength;
    const paddedBuffer = new ArrayBuffer(byteLength + 3); // 3-byte prefix -> unaligned offset 3
    const u8View = new Uint8Array(paddedBuffer);
    u8View.set(new Uint8Array(rawFloats.buffer), 3);

    const json = {
      bufferViews: [{ buffer: 0, byteOffset: 3, byteLength }],
      accessors: [{ bufferView: 0, byteOffset: 0, componentType: 5126, count: 3, type: "SCALAR" }],
    };

    const data = GltfBinaryParser.getBufferData(json.accessors[0], json, [paddedBuffer]);
    expect(data).toBeInstanceOf(Float32Array);
    expect(Array.from(data as Float32Array)).toEqual([10.0, 20.0, 30.0]);
  });

  it("throws when accessor exceeds buffer bounds (corrupt-file data error, not 'no data')", () => {
    const rawFloats = new Float32Array([1.0, 2.0]);
    const json = {
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 8 }],
      accessors: [{ bufferView: 0, byteOffset: 0, componentType: 5126, count: 10, type: "SCALAR" }],
    };

    expect(() =>
      GltfBinaryParser.getBufferData(json.accessors[0], json, [rawFloats.buffer]),
    ).toThrow(/exceeds buffer/);
  });

  it("returns null (not throwing) for legitimately absent data: missing bufferView or unknown componentType", () => {
    const rawFloats = new Float32Array([1.0, 2.0, 3.0, 4.0]);

    // No bufferView -> no data to read, null is the contract.
    const jsonNoView = {
      bufferViews: [],
      accessors: [{ componentType: 5126, count: 4, type: "SCALAR" }],
    };
    expect(
      GltfBinaryParser.getBufferData(jsonNoView.accessors[0], jsonNoView, [rawFloats.buffer]),
    ).toBeNull();

    // Unknown componentType -> cannot interpret, null is the contract.
    const jsonBadType = {
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 16 }],
      accessors: [{ bufferView: 0, byteOffset: 0, componentType: 9999, count: 4, type: "SCALAR" }],
    };
    expect(
      GltfBinaryParser.getBufferData(jsonBadType.accessors[0], jsonBadType, [rawFloats.buffer]),
    ).toBeNull();
  });

  it("handles interleaved bufferViews with byteStride", () => {
    // Interleaved layout: Pos (Vec3 Float32 = 12 bytes) + UV (Vec2 Float32 = 8 bytes) => stride = 20 bytes
    // Vertex 0: Pos=(1, 2, 3), UV=(0.1, 0.2)
    // Vertex 1: Pos=(4, 5, 6), UV=(0.4, 0.5)
    const buffer = new ArrayBuffer(40);
    const floatView = new Float32Array(buffer);
    // Vertex 0:
    floatView[0] = 1;
    floatView[1] = 2;
    floatView[2] = 3;
    floatView[3] = 0.1;
    floatView[4] = 0.2;
    // Vertex 1:
    floatView[5] = 4;
    floatView[6] = 5;
    floatView[7] = 6;
    floatView[8] = 0.4;
    floatView[9] = 0.5;

    const json = {
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 40, byteStride: 20 }],
      accessors: [
        // Pos: byteOffset 0, VEC3
        { bufferView: 0, byteOffset: 0, componentType: 5126, count: 2, type: "VEC3" },
        // UV: byteOffset 12, VEC2
        { bufferView: 0, byteOffset: 12, componentType: 5126, count: 2, type: "VEC2" },
      ],
    };

    const posData = GltfBinaryParser.getBufferData(json.accessors[0], json, [buffer]);
    expect(posData).toBeInstanceOf(Float32Array);
    expect(Array.from(posData as Float32Array)).toEqual([1, 2, 3, 4, 5, 6]);

    const uvData = GltfBinaryParser.getBufferData(json.accessors[1], json, [buffer]);
    expect(uvData).toBeInstanceOf(Float32Array);
    const uvs = Array.from(uvData as Float32Array);
    expect(uvs[0]).toBeCloseTo(0.1);
    expect(uvs[1]).toBeCloseTo(0.2);
    expect(uvs[2]).toBeCloseTo(0.4);
    expect(uvs[3]).toBeCloseTo(0.5);
  });

  it("normalizes integer accessors into Float32Array", () => {
    // 5121: UNSIGNED_BYTE normalized: 0 -> 0.0, 255 -> 1.0
    const u8Buf = new Uint8Array([0, 127, 255]).buffer;
    const jsonU8 = {
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 3 }],
      accessors: [
        {
          bufferView: 0,
          byteOffset: 0,
          componentType: 5121,
          count: 3,
          type: "SCALAR",
          normalized: true,
        },
      ],
    };
    const u8Data = GltfBinaryParser.getBufferData(jsonU8.accessors[0], jsonU8, [u8Buf]);
    expect(u8Data).toBeInstanceOf(Float32Array);
    const u8Floats = Array.from(u8Data as Float32Array);
    expect(u8Floats[0]).toBeCloseTo(0.0);
    expect(u8Floats[1]).toBeCloseTo(127 / 255);
    expect(u8Floats[2]).toBeCloseTo(1.0);

    // 5120: BYTE normalized: -128 -> -1.0, 0 -> 0.0, 127 -> 1.0
    const i8Buf = new Int8Array([-128, 0, 127]).buffer;
    const jsonI8 = {
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 3 }],
      accessors: [
        {
          bufferView: 0,
          byteOffset: 0,
          componentType: 5120,
          count: 3,
          type: "SCALAR",
          normalized: true,
        },
      ],
    };
    const i8Data = GltfBinaryParser.getBufferData(jsonI8.accessors[0], jsonI8, [i8Buf]);
    expect(i8Data).toBeInstanceOf(Float32Array);
    const i8Floats = Array.from(i8Data as Float32Array);
    expect(i8Floats[0]).toBeCloseTo(-1.0);
    expect(i8Floats[1]).toBeCloseTo(0.0);
    expect(i8Floats[2]).toBeCloseTo(1.0);
  });

  it("supports BYTE (5120) and SHORT (5122) componentTypes", () => {
    const i8Buf = new Int8Array([-10, 20]).buffer;
    const jsonI8 = {
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 2 }],
      accessors: [{ bufferView: 0, byteOffset: 0, componentType: 5120, count: 2, type: "SCALAR" }],
    };
    const i8Data = GltfBinaryParser.getBufferData(jsonI8.accessors[0], jsonI8, [i8Buf]);
    expect(i8Data).toBeInstanceOf(Int8Array);
    expect(Array.from(i8Data as Int8Array)).toEqual([-10, 20]);

    const i16Buf = new Int16Array([-1000, 2000]).buffer;
    const jsonI16 = {
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 4 }],
      accessors: [{ bufferView: 0, byteOffset: 0, componentType: 5122, count: 2, type: "SCALAR" }],
    };
    const i16Data = GltfBinaryParser.getBufferData(jsonI16.accessors[0], jsonI16, [i16Buf]);
    expect(i16Data).toBeInstanceOf(Int16Array);
    expect(Array.from(i16Data as Int16Array)).toEqual([-1000, 2000]);
  });

  it("skips the 4-byte column padding of a MAT3 UNSIGNED_BYTE accessor", () => {
    // Two matrices; each column is 3 bytes + 1 pad byte, so one element is 12 bytes.
    const bytes = new Uint8Array(24);
    for (let m = 0; m < 2; m++) {
      for (let col = 0; col < 3; col++) {
        for (let row = 0; row < 3; row++) bytes[m * 12 + col * 4 + row] = m * 9 + col * 3 + row + 1;
        bytes[m * 12 + col * 4 + 3] = 255; // padding must never leak into the result
      }
    }
    const json = {
      bufferViews: [{ buffer: 0, byteLength: 24 }],
      accessors: [{ bufferView: 0, componentType: 5121, count: 2, type: "MAT3" }],
    };
    const data = GltfBinaryParser.getBufferData(json.accessors[0], json, [bytes.buffer]);
    expect(Array.from(data!)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
  });

  it("rejects a MAT2 UNSIGNED_BYTE accessor that is too short for its padded layout", () => {
    const json = {
      bufferViews: [{ buffer: 0, byteLength: 4 }],
      accessors: [{ bufferView: 0, componentType: 5121, count: 1, type: "MAT3" }],
    };
    expect(() =>
      GltfBinaryParser.getBufferData(json.accessors[0], json, [new ArrayBuffer(4)]),
    ).toThrow();
  });

  it("applies a sparse accessor on top of its base bufferView", () => {
    const base = new Float32Array([1, 2, 3, 4]);
    const indices = new Uint8Array([1, 3]);
    const values = new Float32Array([20, 40]);
    const bin = new Uint8Array(16 + 2 + 2 + 8);
    bin.set(new Uint8Array(base.buffer), 0);
    bin.set(indices, 16);
    bin.set(new Uint8Array(values.buffer), 20);
    const json = {
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 16 },
        { buffer: 0, byteOffset: 16, byteLength: 2 },
        { buffer: 0, byteOffset: 20, byteLength: 8 },
      ],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 4,
          type: "SCALAR",
          sparse: {
            count: 2,
            indices: { bufferView: 1, componentType: 5121 },
            values: { bufferView: 2 },
          },
        },
      ],
    };
    const data = GltfBinaryParser.getBufferData(json.accessors[0], json, [bin.buffer]);
    expect(Array.from(data!)).toEqual([1, 20, 3, 40]);
    // The source buffer is not mutated.
    expect(Array.from(new Float32Array(bin.buffer, 0, 4))).toEqual([1, 2, 3, 4]);
  });

  it("builds a zero-based sparse accessor when no bufferView is given", () => {
    const bin = new Uint8Array(4 + 4);
    new Uint8Array(bin.buffer, 0, 2).set([2, 0]); // indices (u8, padded)
    new Float32Array(bin.buffer, 4, 1).set([7]);
    const json = {
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 1 },
        { buffer: 0, byteOffset: 4, byteLength: 4 },
      ],
      accessors: [
        {
          componentType: 5126,
          count: 3,
          type: "SCALAR",
          sparse: {
            count: 1,
            indices: { bufferView: 0, componentType: 5121 },
            values: { bufferView: 1 },
          },
        },
      ],
    };
    const data = GltfBinaryParser.getBufferData(json.accessors[0], json, [bin.buffer]);
    expect(Array.from(data!)).toEqual([0, 0, 7]);
  });
});
