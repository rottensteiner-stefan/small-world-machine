import { describe, it, expect, afterEach, vi } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { GltfLoader, registerGltfExtension } from "@small-world-machine/engine";
import { DracoWasmDecoder } from "../src/draco/DracoWasmDecoder.js";
import { DracoDecoder } from "../src/draco/DracoDecoder.js";
import { khrDracoMeshCompression } from "../src/draco/KhrDracoMeshCompression.js";

const vendorDir = fileURLToPath(new URL("../vendor/draco/", import.meta.url));
const fixtureDir = fileURLToPath(new URL("./fixtures/draco/", import.meta.url));

function asArrayBuffer(source: Uint8Array): ArrayBuffer {
  return source.buffer.slice(
    source.byteOffset,
    source.byteOffset + source.byteLength,
  ) as ArrayBuffer;
}

const wasmBinary = asArrayBuffer(readFileSync(vendorDir + "draco_decoder.wasm"));
// `cube.drc`: unit cube, 24 vertices (one normal per face), 12 triangles, Edgebreaker, quantized
// POSITION 14 / NORMAL 10 / TEX_COORD 12 bits, plus an unquantized 4-component TANGENT. Unique ids
// 0 / 1 / 2 / 3. The tangent is deliberately not what the CPU generator would produce: it follows
// +v with handedness w = -1 (the generator gives +u), so only a verbatim passthrough passes.
const cube = asArrayBuffer(readFileSync(fixtureDir + "cube.drc"));
const cubeIds = { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2, TANGENT: 3 };

describe("DracoWasmDecoder", () => {
  afterEach(() => {
    DracoDecoder.setConfig({ wasmBinary: undefined });
  });

  it("decodes a real Draco bitstream into the expected vertex/triangle counts", async () => {
    const geometry = await DracoWasmDecoder.decode(cube, cubeIds, { wasmBinary });

    expect(geometry.vertices).toHaveLength(24 * 3);
    expect(geometry.normals).toHaveLength(24 * 3);
    expect(geometry.uvs).toHaveLength(24 * 2);
    expect(geometry.indices).toHaveLength(12 * 3);
  });

  it("dequantizes positions into the original unit-cube range", async () => {
    const { vertices } = await DracoWasmDecoder.decode(cube, cubeIds, { wasmBinary });

    for (const value of vertices) {
      expect(Math.abs(value)).toBeCloseTo(0.5, 2);
    }
  });

  it("returns unit, axis-aligned normals and UVs inside [0, 1]", async () => {
    const { normals, uvs } = await DracoWasmDecoder.decode(cube, cubeIds, { wasmBinary });

    for (let i = 0; i < normals!.length; i += 3) {
      const [x, y, z] = [normals![i]!, normals![i + 1]!, normals![i + 2]!];
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 1);
      expect(Math.max(Math.abs(x), Math.abs(y), Math.abs(z))).toBeGreaterThan(0.95);
    }
    for (const uv of uvs!) {
      expect(uv).toBeGreaterThanOrEqual(-0.001);
      expect(uv).toBeLessThanOrEqual(1.001);
    }
  });

  it("keeps triangle winding consistent with the vertex normals (decoder may reorder points)", async () => {
    const { vertices, normals, indices } = await DracoWasmDecoder.decode(cube, cubeIds, {
      wasmBinary,
    });

    for (let t = 0; t < indices!.length; t += 3) {
      const [a, b, c] = [indices![t]!, indices![t + 1]!, indices![t + 2]!];
      const p = (i: number): number[] => [
        vertices[i * 3]!,
        vertices[i * 3 + 1]!,
        vertices[i * 3 + 2]!,
      ];
      const [pa, pb, pc] = [p(a), p(b), p(c)];
      const e1 = [pb[0]! - pa[0]!, pb[1]! - pa[1]!, pb[2]! - pa[2]!];
      const e2 = [pc[0]! - pa[0]!, pc[1]! - pa[1]!, pc[2]! - pa[2]!];
      const face = [
        e1[1]! * e2[2]! - e1[2]! * e2[1]!,
        e1[2]! * e2[0]! - e1[0]! * e2[2]!,
        e1[0]! * e2[1]! - e1[1]! * e2[0]!,
      ];
      const dot =
        face[0]! * normals![a * 3]! +
        face[1]! * normals![a * 3 + 1]! +
        face[2]! * normals![a * 3 + 2]!;
      expect(dot).toBeGreaterThan(0);
    }
  });

  it("passes the authored TANGENT through verbatim (+v direction, w = -1), not a regenerated one", async () => {
    const { vertices, uvs, normals, tangents, indices } = await DracoWasmDecoder.decode(
      cube,
      cubeIds,
      { wasmBinary },
    );

    expect(tangents).toHaveLength(24 * 4);
    for (let i = 0; i < 24; i++) {
      const t = [tangents![i * 4]!, tangents![i * 4 + 1]!, tangents![i * 4 + 2]!];
      const n = [normals![i * 3]!, normals![i * 3 + 1]!, normals![i * 3 + 2]!];
      expect(Math.hypot(...t)).toBeCloseTo(1, 5);
      expect(t[0]! * n[0]! + t[1]! * n[1]! + t[2]! * n[2]!).toBeCloseTo(0, 1);
      expect(tangents![i * 4 + 3]).toBe(-1);
    }

    // Every triangle: the stored tangent must point along dP/dV, derived from positions and UVs.
    for (let t = 0; t < indices!.length; t += 3) {
      const [a, b, c] = [indices![t]!, indices![t + 1]!, indices![t + 2]!];
      const pos = (i: number, k: number): number => vertices[i * 3 + k]!;
      const uv = (i: number, k: number): number => uvs![i * 2 + k]!;
      const du1 = uv(b, 0) - uv(a, 0);
      const dv1 = uv(b, 1) - uv(a, 1);
      const du2 = uv(c, 0) - uv(a, 0);
      const dv2 = uv(c, 1) - uv(a, 1);
      const det = du1 * dv2 - du2 * dv1;
      const dPdV = [0, 1, 2].map(
        (k) => ((pos(c, k) - pos(a, k)) * du1 - (pos(b, k) - pos(a, k)) * du2) / det,
      );
      const len = Math.hypot(...dPdV);
      const alongV =
        (dPdV[0]! * tangents![a * 4]! +
          dPdV[1]! * tangents![a * 4 + 1]! +
          dPdV[2]! * tangents![a * 4 + 2]!) /
        len;
      expect(alongV).toBeGreaterThan(0.99);
    }
  });

  it("rejects a TANGENT attribute that does not have 4 components", async () => {
    // Attribute id 0 is POSITION (3 components): a wrongly mapped tangent must fail loudly.
    await expect(
      DracoWasmDecoder.decode(cube, { POSITION: 0, TANGENT: 0 }, { wasmBinary }),
    ).rejects.toThrow(/TANGENT must have 4 components/);
  });

  it("rejects when a required POSITION attribute id is missing", async () => {
    await expect(DracoWasmDecoder.decode(cube, { NORMAL: 1 }, { wasmBinary })).rejects.toThrow(
      /POSITION/,
    );
  });

  it("rejects a truncated bitstream instead of returning garbage", async () => {
    const truncated = cube.slice(0, 40);

    await expect(DracoWasmDecoder.decode(truncated, cubeIds, { wasmBinary })).rejects.toThrow(
      /Decoding failed/,
    );
  });

  it("rejects an unknown Draco attribute id with a clear error instead of a WASM trap", async () => {
    await expect(
      DracoWasmDecoder.decode(cube, { POSITION: 0, NORMAL: 99 }, { wasmBinary }),
    ).rejects.toThrow(/unique id 99 not found/);
  });

  it("destroys the decode status object (no WASM heap leak per decode), also on failure", async () => {
    const module = await DracoWasmDecoder.getModule({ wasmBinary });
    const destroy = vi.spyOn(module, "destroy");
    try {
      await DracoWasmDecoder.decode(cube, cubeIds, { wasmBinary });
      // status + mesh + decoderBuffer + decoder
      expect(destroy).toHaveBeenCalledTimes(4);
      destroy.mockClear();
      await expect(
        DracoWasmDecoder.decode(cube.slice(0, 40), cubeIds, { wasmBinary }),
      ).rejects.toThrow(/Decoding failed/);
      expect(destroy).toHaveBeenCalledTimes(4);
    } finally {
      destroy.mockRestore();
    }
  });

  it("reuses one module per binary reference", async () => {
    const first = await DracoWasmDecoder.getModule({ wasmBinary });
    const second = await DracoWasmDecoder.getModule({ wasmBinary });

    expect(second).toBe(first);
  });
});

describe("KHR_draco_mesh_compression with the real decoder", () => {
  afterEach(() => {
    DracoDecoder.setConfig({ wasmBinary: undefined });
  });

  it("loads a Draco-compressed primitive through GltfLoader with no custom handler", async () => {
    registerGltfExtension(khrDracoMeshCompression);
    DracoDecoder.setConfig({ wasmBinary });

    const gltf = {
      json: {
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: cube.byteLength }],
        meshes: [
          {
            primitives: [
              {
                attributes: {},
                extensions: {
                  KHR_draco_mesh_compression: { bufferView: 0, attributes: cubeIds },
                },
              },
            ],
          },
        ],
        nodes: [{ name: "DracoCube", mesh: 0 }],
        scenes: [{ nodes: [0] }],
        scene: 0,
      },
      buffers: [cube],
    };

    const scene = await new GltfLoader().parse(gltf, "");
    const mesh = scene.getObjectByName("DracoCube")?.children[0];

    expect(mesh?.geometry?.vertices).toHaveLength(24 * 3);
    expect(mesh?.geometry?.indices).toHaveLength(12 * 3);
  });
});
