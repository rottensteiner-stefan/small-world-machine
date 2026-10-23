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

  it("rejects a MAT3 UNSIGNED_BYTE accessor that is too short for its padded layout", () => {
    const json = {
      bufferViews: [{ buffer: 0, byteLength: 4 }],
      accessors: [{ bufferView: 0, componentType: 5121, count: 1, type: "MAT3" }],
    };
    // MAT3 with 1-byte components is column-padded (3 columns x 4 bytes = 12 bytes/element), so a
    // 4-byte bufferView can never satisfy count 1 -- the parser must reject it, not produce garbage.
    expect(() =>
      GltfBinaryParser.getBufferData(json.accessors[0], json, [new ArrayBuffer(4)]),
    ).toThrow(/exceeds buffer/);
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

/** Builds a spec-shaped .glb container (magic, version, JSON chunk padded to 4, optional BIN chunk). */
function buildGlb(json: unknown, bin?: Uint8Array): ArrayBuffer {
  const encoder = new TextEncoder();
  const jsonBytes = encoder.encode(JSON.stringify(json));
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const paddedJson = new Uint8Array(jsonBytes.length + jsonPad);
  paddedJson.set(jsonBytes);
  paddedJson.fill(0x20, jsonBytes.length); // JSON chunks are space-padded per the glTF 2.0 spec.

  const binLen = bin ? bin.length : 0;
  const binPad = bin ? (4 - (bin.length % 4)) % 4 : 0;
  const total = 12 + 8 + jsonBytes.length + jsonPad + (bin ? 8 + binLen + binPad : 0);

  const buffer = new ArrayBuffer(total);
  const dv = new DataView(buffer);
  dv.setUint32(0, 0x46546c67, true); // "glTF"
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);

  let offset = 12;
  dv.setUint32(offset, paddedJson.length, true);
  dv.setUint32(offset + 4, 0x4e4f534a, true); // JSON
  new Uint8Array(buffer, offset + 8, paddedJson.length).set(paddedJson);
  offset += 8 + paddedJson.length;

  if (bin) {
    const paddedBin = new Uint8Array(binLen + binPad);
    paddedBin.set(bin);
    paddedBin.fill(0, binLen); // BIN chunks are zero-padded to 4-byte alignment.
    dv.setUint32(offset, binLen + binPad, true);
    dv.setUint32(offset + 4, 0x004e4942, true); // BIN
    new Uint8Array(buffer, offset + 8, paddedBin.length).set(paddedBin);
  }
  return buffer;
}

describe("GltfBinaryParser.parseGlb (real .glb container bytes)", () => {
  it("extracts JSON and BIN payload from a well-formed .glb", () => {
    const json = { asset: { version: "2.0" }, buffers: [{ byteLength: 4 }] };
    const bin = new Uint8Array([1, 2, 3, 4]);
    const glb = buildGlb(json, bin);

    const { json: parsedJson, buffers } = GltfBinaryParser.parseGlb(glb);
    expect(parsedJson.asset?.version).toBe("2.0");
    expect(buffers).toHaveLength(1);
    expect(Array.from(new Uint8Array(buffers[0]!))).toEqual([1, 2, 3, 4]);
  });

  it("parses a JSON-only .glb into an empty buffer list", () => {
    const glb = buildGlb({ asset: { version: "2.0" } });
    const { json, buffers } = GltfBinaryParser.parseGlb(glb);
    expect(json.asset?.version).toBe("2.0");
    expect(buffers).toHaveLength(0);
  });

  it("skips unknown chunk types instead of failing", () => {
    // Manually build header + an unknown chunk + a JSON chunk. Spec says readers must ignore
    // unknown chunk types, so only the JSON chunk may drive the result.
    const jsonBytes = new TextEncoder().encode(JSON.stringify({ asset: { version: "2.0" } }));
    const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
    const paddedJson = new Uint8Array(jsonBytes.length + jsonPad);
    paddedJson.set(jsonBytes);
    paddedJson.fill(0x20, jsonBytes.length);

    const UNKNOWN_PAYLOAD = 8;
    const total = 12 + 8 + UNKNOWN_PAYLOAD + 8 + paddedJson.length;
    const buffer = new ArrayBuffer(total);
    const dv = new DataView(buffer);
    dv.setUint32(0, 0x46546c67, true);
    dv.setUint32(4, 2, true);
    dv.setUint32(8, total, true);
    let offset = 12;
    dv.setUint32(offset, UNKNOWN_PAYLOAD, true);
    dv.setUint32(offset + 4, 0x46554e00, true); // unknown "FUN\0" chunk
    offset += 8 + UNKNOWN_PAYLOAD;
    dv.setUint32(offset, paddedJson.length, true);
    dv.setUint32(offset + 4, 0x4e4f534a, true);
    new Uint8Array(buffer, offset + 8, paddedJson.length).set(paddedJson);

    const { json } = GltfBinaryParser.parseGlb(buffer);
    expect(json.asset?.version).toBe("2.0");
  });

  it("rejects a wrong magic number", () => {
    const glb = buildGlb({ asset: { version: "2.0" } });
    new DataView(glb).setUint32(0, 0x12345678, true);
    expect(() => GltfBinaryParser.parseGlb(glb)).toThrow(/Not a valid \.glb/);
  });

  it("rejects a non-2.0 version", () => {
    const glb = buildGlb({ asset: { version: "2.0" } });
    new DataView(glb).setUint32(4, 1, true);
    expect(() => GltfBinaryParser.parseGlb(glb)).toThrow(/Only glTF 2\.0/);
  });

  it("rejects a truncated header (fewer than 12 bytes)", () => {
    // Magic/version read succeeds for a 4-byte buffer, but a 4-byte buffer has no valid chunk and
    // no JSON -> the parser must fail rather than return partial data.
    expect(() => GltfBinaryParser.parseGlb(new ArrayBuffer(4))).toThrow();
  });

  it("rejects a chunk whose declared length runs off the end of the buffer", () => {
    const glb = buildGlb({ asset: { version: "2.0" } });
    // Claim an absurd JSON chunk length that overflows the buffer.
    new DataView(glb).setUint32(12, 0x7fffffff, true);
    expect(() => GltfBinaryParser.parseGlb(glb)).toThrow();
  });

  it("rejects a .glb without a JSON chunk", () => {
    // BIN chunk only: no JSON chunk present -> must fail (a scene description is mandatory).
    const dv = new DataView(new ArrayBuffer(28));
    dv.setUint32(0, 0x46546c67, true);
    dv.setUint32(4, 2, true);
    dv.setUint32(8, 28, true);
    dv.setUint32(12, 16, true); // BIN chunk length (16 = 12 + 4 padding)
    dv.setUint32(16, 0x004e4942, true);
    const noJson = dv.buffer;
    expect(() => GltfBinaryParser.parseGlb(noJson)).toThrow(/No JSON chunk/);
  });

  it("uses the last JSON chunk when multiple are present", () => {
    const enc = new TextEncoder();
    const first = enc.encode(JSON.stringify({ a: 1 }));
    const second = enc.encode(JSON.stringify({ a: 2 }));
    const padTo4 = (n: number): number => (4 - (n % 4)) % 4;
    const p1 = first.length + padTo4(first.length);
    const p2 = second.length + padTo4(second.length);
    const total = 12 + 8 + p1 + 8 + p2;
    const buffer = new ArrayBuffer(total);
    const dv = new DataView(buffer);
    dv.setUint32(0, 0x46546c67, true);
    dv.setUint32(4, 2, true);
    dv.setUint32(8, total, true);
    let offset = 12;
    for (const bytes of [first, second]) {
      const pad = (4 - (bytes.length % 4)) % 4;
      const padded = new Uint8Array(bytes.length + pad);
      padded.set(bytes);
      padded.fill(0x20, bytes.length);
      dv.setUint32(offset, padded.length, true);
      dv.setUint32(offset + 4, 0x4e4f534a, true);
      new Uint8Array(buffer, offset + 8, padded.length).set(padded);
      offset += 8 + padded.length;
    }

    const { json } = GltfBinaryParser.parseGlb(buffer);
    // The parser overwrites `json` per chunk, so the last JSON chunk wins.
    expect((json as { a: number }).a).toBe(2);
  });
});

describe("GltfBinaryParser.getBufferData edge branches", () => {
  it("throws when byteStride is smaller than the element size", () => {
    const json = {
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 16, byteStride: 2 }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 4, type: "SCALAR" }],
    };
    // SCALAR Float32 element = 4 bytes; a stride of 2 cannot pack it densely.
    expect(() =>
      GltfBinaryParser.getBufferData(json.accessors[0], json, [new ArrayBuffer(16)]),
    ).toThrow(/Invalid byteStride/);
  });

  it("returns null for an out-of-range bufferView index", () => {
    const json = {
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 16 }],
      accessors: [{ bufferView: 3, componentType: 5126, count: 4, type: "SCALAR" }],
    };
    expect(
      GltfBinaryParser.getBufferData(json.accessors[0], json, [new ArrayBuffer(16)]),
    ).toBeNull();
  });

  it("returns null for an out-of-range buffer index", () => {
    const json = {
      bufferViews: [{ buffer: 7, byteOffset: 0, byteLength: 16 }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 4, type: "SCALAR" }],
    };
    expect(
      GltfBinaryParser.getBufferData(json.accessors[0], json, [new ArrayBuffer(16)]),
    ).toBeNull();
  });

  it("normalizes SHORT/UNSIGNED_SHORT/UNSIGNED_INT componentTypes", () => {
    // 5122 SHORT normalized: -32768 -> -1.0 (clamped).
    const i16 = new Int16Array([-32768, 0, 32767]).buffer;
    const jI16 = {
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 6 }],
      accessors: [
        {
          bufferView: 0,
          componentType: 5122,
          count: 3,
          type: "SCALAR",
          normalized: true,
        },
      ],
    };
    const dI16 = GltfBinaryParser.getBufferData(jI16.accessors[0], jI16, [i16]);
    expect(Array.from(dI16 as Float32Array)).toEqual([-1, 0, 1]);

    // 5123 UNSIGNED_SHORT normalized: 65535 -> 1.0.
    const u16 = new Uint16Array([0, 65535]).buffer;
    const jU16 = {
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 4 }],
      accessors: [
        { bufferView: 0, componentType: 5123, count: 2, type: "SCALAR", normalized: true },
      ],
    };
    const dU16 = GltfBinaryParser.getBufferData(jU16.accessors[0], jU16, [u16]);
    expect(Array.from(dU16 as Float32Array)).toEqual([0, 1]);

    // 5125 UNSIGNED_INT normalized: 4294967295 -> 1.0.
    const u32 = new Uint32Array([0, 4294967295]).buffer;
    const jU32 = {
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 8 }],
      accessors: [
        { bufferView: 0, componentType: 5125, count: 2, type: "SCALAR", normalized: true },
      ],
    };
    const dU32 = GltfBinaryParser.getBufferData(jU32.accessors[0], jU32, [u32]);
    expect(Array.from(dU32 as Float32Array)).toEqual([0, 1]);
  });

  it("handles count === 0 as an empty typed array without throwing", () => {
    const json = {
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 0 }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 0, type: "SCALAR" }],
    };
    const data = GltfBinaryParser.getBufferData(json.accessors[0], json, [new ArrayBuffer(0)]);
    expect(data).toBeInstanceOf(Float32Array);
    expect((data as Float32Array).length).toBe(0);
  });

  it("throws when a sparse accessor index exceeds the accessor count", () => {
    const base = new Float32Array([1, 2, 3]).buffer;
    const indices = new Uint8Array([5]); // index 5 >= count 3
    const values = new Float32Array([99]);
    const bin = new Uint8Array(12 + 8);
    bin.set(new Uint8Array(base), 0);
    bin.set(indices, 12);
    bin.set(new Uint8Array(values.buffer), 16);
    const json = {
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 12 },
        { buffer: 0, byteOffset: 12, byteLength: 1 },
        { buffer: 0, byteOffset: 16, byteLength: 4 },
      ],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 3,
          type: "SCALAR",
          sparse: {
            count: 1,
            indices: { bufferView: 1, componentType: 5121 },
            values: { bufferView: 2 },
          },
        },
      ],
    };
    expect(() => GltfBinaryParser.getBufferData(json.accessors[0], json, [bin.buffer])).toThrow(
      /outside count/,
    );
  });
});
