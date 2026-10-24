import { describe, it, expect, vi } from "vitest";
import { GltfGeometryParser } from "../../../src/loaders/gltf/GltfGeometryParser.js";
import { Topology } from "../../../src/enums/index.js";
import type { BoundingBox } from "../../../src/physix/BoundingBox.js";

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

  describe("asset-contract fixes (EP-5, EP-7, tangent passthrough)", () => {
    it("dequantizes quantized POSITION onto the declared min/max domain (EP-7)", async () => {
      // KHR_mesh_quantization: normalized Int16 storage whose accessor min/max declare the
      // real unit-space [-5, +5]. int = 32767 encodes u = 1 (→ max), int = -32767 → u = 0 (→ min).
      const buf = new ArrayBuffer(12);
      new Int16Array(buf).set([-32767, -32767, -32767, 32767, -32767, 32767]);

      const json = {
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 12 }],
        accessors: [
          {
            bufferView: 0,
            byteOffset: 0,
            componentType: 5122,
            normalized: true,
            count: 2,
            type: "VEC3",
            min: [-5, -5, -5],
            max: [5, 5, 5],
          },
        ],
      };

      const geo = await GltfGeometryParser.parseGeometry(
        { attributes: { POSITION: 0 } },
        json,
        [buf],
      );

      const positions = Array.from(geo!.vertices as Float32Array);
      // First vertex -> min corner (-5, -5, -5).
      expect(positions[0]).toBeCloseTo(-5, 4);
      expect(positions[1]).toBeCloseTo(-5, 4);
      expect(positions[2]).toBeCloseTo(-5, 4);
      // Second vertex -> (+5, -5, +5). Without dequantization the normalized [-1,1] buffer
      // would have yielded ±1, collapsing the geometry into a 1-unit cube.
      expect(positions[3]).toBeCloseTo(5, 4);
      expect(positions[4]).toBeCloseTo(-5, 4);
      expect(positions[5]).toBeCloseTo(5, 4);
    });

    it("honors Float32 POSITION accessor min/max as authoritative header bounds (EP-5)", async () => {
      const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
      const json = {
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }],
        accessors: [
          {
            bufferView: 0,
            byteOffset: 0,
            componentType: 5126,
            count: 3,
            type: "VEC3",
            min: [-0.25, -0.5, -1],
            max: [0.75, 0.5, 1],
          },
        ],
      };

      const geo = await GltfGeometryParser.parseGeometry(
        { attributes: { POSITION: 0 } },
        json,
        [pos.buffer],
      );

      // The header min/max feed the cached bound directly (no CPU vertex scan override).
      const box = geo!.getBoundingVolume() as BoundingBox;
      expect(box.min.x).toBeCloseTo(-0.25, 6);
      expect(box.min.y).toBeCloseTo(-0.5, 6);
      expect(box.min.z).toBeCloseTo(-1, 6);
      expect(box.max.x).toBeCloseTo(0.75, 6);
      expect(box.max.y).toBeCloseTo(0.5, 6);
      expect(box.max.z).toBeCloseTo(1, 6);
    });

    it("forwards glTF TANGENT verbatim and preserves the w handedness (EP-1 loader slice)", async () => {
      const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
      const tan = new Float32Array([
        1, 0, 0, 1, // w = +1 (regular)
        0, 1, 0, -1, // w = -1 (mirrored island), must NOT be dropped
        0, 0, 1, 1,
      ]);
      const json = {
        bufferViews: [
          { buffer: 0, byteOffset: 0, byteLength: 36 },
          { buffer: 1, byteOffset: 0, byteLength: 48 },
        ],
        accessors: [
          { bufferView: 0, byteOffset: 0, componentType: 5126, count: 3, type: "VEC3" },
          { bufferView: 1, byteOffset: 0, componentType: 5126, count: 3, type: "VEC4" },
        ],
      };

      const geo = await GltfGeometryParser.parseGeometry(
        { attributes: { POSITION: 0, TANGENT: 1 } },
        json,
        [pos.buffer, tan.buffer],
      );

      const tangents = geo!.tangents as Float32Array;
      expect(tangents.length).toBe(12);
      expect(Array.from(tangents)).toEqual([1, 0, 0, 1, 0, 1, 0, -1, 0, 0, 1, 1]);
    });
  });

  describe("primitive modes", () => {
    function quad(mode: number | undefined): {
      primitive: { attributes: { POSITION: number }; mode?: number };
      json: object;
      buffers: ArrayBuffer[];
    } {
      const pos = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]);
      const primitive: { attributes: { POSITION: number }; mode?: number } = {
        attributes: { POSITION: 0 },
      };
      if (mode !== undefined) primitive.mode = mode;
      return {
        primitive,
        json: {
          bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 48 }],
          accessors: [
            { bufferView: 0, byteOffset: 0, componentType: 5126, count: 4, type: "VEC3" },
          ],
        },
        buffers: [pos.buffer],
      };
    }

    it("skips POINTS with a warning instead of aborting the file", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { primitive, json, buffers } = quad(0);
      await expect(GltfGeometryParser.parseGeometry(primitive, json, buffers)).resolves.toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      warn.mockRestore();
    });

    it("builds LINES (1) as a line list: index pairs, LINE_LIST topology, no tangents", async () => {
      const { primitive, json, buffers } = quad(1);
      const geo = await GltfGeometryParser.parseGeometry(primitive, json, buffers);
      expect(geo!.topology).toBe(Topology.LINE_LIST);
      expect(Array.from(geo!.indices!)).toEqual([0, 1, 2, 3]);
      expect(geo!.normals).toHaveLength(12);
      expect(Array.from(geo!.normals!.slice(0, 3))).toEqual([0, 1, 0]);
    });

    it("re-indexes LINE_LOOP (2) and LINE_STRIP (3) into index pairs", async () => {
      const loop = quad(2);
      const loopGeo = await GltfGeometryParser.parseGeometry(
        loop.primitive,
        loop.json,
        loop.buffers,
      );
      expect(Array.from(loopGeo!.indices!)).toEqual([0, 1, 1, 2, 2, 3, 3, 0]);
      expect(loopGeo!.topology).toBe(Topology.LINE_LIST);

      const strip = quad(3);
      const stripGeo = await GltfGeometryParser.parseGeometry(
        strip.primitive,
        strip.json,
        strip.buffers,
      );
      expect(Array.from(stripGeo!.indices!)).toEqual([0, 1, 1, 2, 2, 3]);
    });

    it("keeps explicit indices when re-indexing lines", async () => {
      const pos = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0]);
      const idx = new Uint16Array([2, 0, 1]);
      const geo = await GltfGeometryParser.parseGeometry(
        { attributes: { POSITION: 0 }, indices: 1, mode: 3 },
        {
          bufferViews: [
            { buffer: 0, byteOffset: 0, byteLength: 36 },
            { buffer: 1, byteOffset: 0, byteLength: 6 },
          ],
          accessors: [
            { bufferView: 0, componentType: 5126, count: 3, type: "VEC3" },
            { bufferView: 1, componentType: 5123, count: 3, type: "SCALAR" },
          ],
        },
        [pos.buffer, idx.buffer],
      );
      expect(Array.from(geo!.indices!)).toEqual([2, 0, 0, 1]);
    });

    it("rejects an invalid primitive mode", async () => {
      const { primitive, json, buffers } = quad(9);
      await expect(GltfGeometryParser.parseGeometry(primitive, json, buffers)).rejects.toThrow(
        /Invalid primitive mode 9/,
      );
    });

    it("re-indexes TRIANGLE_STRIP into a triangle list with alternating winding fixed", async () => {
      const { primitive, json, buffers } = quad(5);
      const geo = await GltfGeometryParser.parseGeometry(primitive, json, buffers);
      expect(Array.from(geo!.indices!)).toEqual([0, 1, 2, 2, 1, 3]);
    });

    it("re-indexes TRIANGLE_FAN into a triangle list", async () => {
      const { primitive, json, buffers } = quad(6);
      const geo = await GltfGeometryParser.parseGeometry(primitive, json, buffers);
      expect(Array.from(geo!.indices!)).toEqual([0, 1, 2, 0, 2, 3]);
    });

    it("leaves TRIANGLES (explicit 4 or default) untouched", async () => {
      for (const mode of [undefined, 4]) {
        const { primitive, json, buffers } = quad(mode);
        const geo = await GltfGeometryParser.parseGeometry(primitive, json, buffers);
        expect(geo!.indices ?? []).toHaveLength(0);
      }
    });
  });
});
