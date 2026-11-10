/**
 * `swm lod` headless core tests (ADR 0059 step 2 / P2-3).
 *
 * Covers the deterministic meshoptimizer pipeline on a synthetic indexed grid fixture:
 * target-budget math, LOD0 verbatim pass-through, monotonic triangle reduction, structural
 * GLB validity (verify + re-parse attribute invariants), and byte-level determinism.
 */

import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GltfBinaryParser } from "@small-world-machine/engine/loaders/gltf/GltfBinaryParser.js";
import type { GltfData } from "@small-world-machine/engine/loaders/gltf/types.js";
import {
  computeNormals,
  loadLodSources,
  runLodGeneration,
  targetTrisForLevel,
  verifyLodGlb,
} from "../../src/core/lod.js";
import { buildGridGlb } from "../lodFixture.js";

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "swm-lod-test-"));
  try {
    return await fn(dir);
  } finally {
    await import("node:fs/promises").then((fs) => fs.rm(dir, { recursive: true, force: true }));
  }
}

interface ParsedAttrs {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  material: number | undefined;
  meshName: string;
  attributes: Record<string, number>;
}

function parseFirstPrimitive(glb: Uint8Array): ParsedAttrs {
  const view = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer;
  const gltf: GltfData = GltfBinaryParser.parseGlb(view);
  const mesh = gltf.json.meshes![0]!;
  const prim = mesh.primitives[0]!;
  const read = (key: string): Float32Array =>
    GltfBinaryParser.getBufferData(
      gltf.json.accessors?.[prim.attributes[key]!],
      gltf.json,
      gltf.buffers,
    ) as Float32Array;
  const indices = GltfBinaryParser.getBufferData(
    gltf.json.accessors?.[prim.indices!],
    gltf.json,
    gltf.buffers,
  ) as Uint32Array;
  return {
    positions: read("POSITION"),
    normals: read("NORMAL"),
    uvs: read("TEXCOORD_0"),
    indices,
    material: prim.material,
    meshName: mesh.name ?? "",
    attributes: prim.attributes,
  };
}

describe("targetTrisForLevel", () => {
  it("reduces by the requested ratio, floored at minTris", () => {
    expect(targetTrisForLevel(9000, 0.5, 32)).toBe(4500);
    expect(targetTrisForLevel(9000, 0.2, 32)).toBe(1800);
    expect(targetTrisForLevel(9000, 0.08, 32)).toBe(720);
  });

  it("never exceeds the source (tiny primitives pass through)", () => {
    expect(targetTrisForLevel(2, 0.5, 32)).toBe(2);
    expect(targetTrisForLevel(3, 0.5, 32)).toBe(3);
    // 10-tri prim: minTris floor is clamped so the target never exceeds src (and stays
    // within meshopt's `target_index_count <= indices.length` contract).
    const t = targetTrisForLevel(10, 0.5, 32);
    expect(t).toBeGreaterThanOrEqual(3);
    expect(t).toBeLessThanOrEqual(10);
    expect(t * 3).toBeLessThanOrEqual(30);
  });

  it("clamps large targets to the source-3 reduction ceiling but never exceeds it", () => {
    // 1923 tris * 0.5 = 961 -> floored to 960 by the multiple-of-3 rounding, < src.
    const t = targetTrisForLevel(1923, 0.5, 32);
    expect(t).toBe(960);
    expect(t * 3).toBeLessThan(1923 * 3);
    expect(t).toBeLessThan(1923);
  });
});

describe("computeNormals", () => {
  it("produces unit-length, finite normals for valid input", () => {
    const { glb, trisPerPrim } = buildGridGlb(8, 8);
    expect(trisPerPrim[0]).toBeGreaterThan(0);
    const view = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer;
    const gltf = GltfBinaryParser.parseGlb(view);
    const prim = gltf.json.meshes![0]!.primitives[0]!;
    const positions = GltfBinaryParser.getBufferData(
      gltf.json.accessors?.[prim.attributes["POSITION"]!],
      gltf.json,
      gltf.buffers,
    ) as Float32Array;
    const indices = GltfBinaryParser.getBufferData(
      gltf.json.accessors?.[prim.indices!],
      gltf.json,
      gltf.buffers,
    ) as Uint32Array;
    const normals = computeNormals(indices, positions);
    expect(normals.length / 3).toBe(positions.length / 3);
    for (let v = 0; v < positions.length / 3; v++) {
      const l = Math.hypot(normals[v * 3]!, normals[v * 3 + 1]!, normals[v * 3 + 2]!);
      expect(Number.isFinite(l)).toBe(true);
      expect(Math.abs(l - 1)).toBeLessThan(1e-4);
    }
  });

  it("falls back to +Y for degenerate (coincident) vertices", () => {
    const positions = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const indices = new Uint32Array([0, 1, 2]);
    const normals = computeNormals(indices, positions);
    expect(normals[0]).toBeCloseTo(0);
    expect(normals[1]).toBeCloseTo(1);
    expect(normals[2]).toBeCloseTo(0);
  });
});

describe("runLodGeneration (synthetic grid)", () => {
  const RATIOS = [0.5, 0.2, 0.08];

  it("passes LOD0 through verbatim and reduces LOD1..n monotonically", async () => {
    await withTempDir(async (dir) => {
      const { glb, trisPerPrim, width, height } = buildGridGlb(32, 32);
      const srcTris = trisPerPrim[0]!;
      const inputPath = join(dir, "gridInput.glb");
      await writeFile(inputPath, glb);
      const result = await runLodGeneration(inputPath, {
        ratios: RATIOS,
        minTris: 32,
        error: 0.02,
      });
      expect(result.levels).toHaveLength(4);
      // LOD0 verbatim
      expect(result.levels[0]!.glb.length).toBe(glb.length);
      expect(result.levels[0]!.glb.every((b, i) => b === glb[i]!)).toBe(true);
      expect(result.levels[0]!.trisPerMesh[0]).toBe(srcTris);
      // Monotonic descending (strict where the simplifier can reach its target)
      const counts = result.levels.map((l) => l.trisPerMesh[0]!);
      expect(counts[1]!).toBeLessThan(counts[0]!);
      expect(counts[2]!).toBeLessThan(counts[1]!);
      expect(counts[3]!).toBeLessThan(counts[2]!);
      // The PROVEN large-mesh behavior: reduction hits the calibrated targets (0.02 error
      // reliably marches to the triangle budget on meshes large enough to matter).
      expect(counts[1]!).toBeLessThanOrEqual(Math.floor(srcTris * RATIOS[0]!));
      void width;
      void height;
    });
  });

  it("every level passes structural verification and attribute invariants", async () => {
    await withTempDir(async (dir) => {
      const { glb } = buildGridGlb(24, 24);
      const inputPath = join(dir, "gridInput.glb");
      await writeFile(inputPath, glb);
      const result = await runLodGeneration(inputPath, {
        ratios: RATIOS,
        minTris: 32,
        error: 0.02,
      });
      for (let idx = 0; idx < result.levels.length; idx++) {
        const level = result.levels[idx]!;
        expect(verifyLodGlb(level.fileName, level.glb)).toEqual([]);
        const attrs = parseFirstPrimitive(level.glb);
        for (const i of attrs.indices) {
          expect(i).toBeLessThan(attrs.positions.length / 3);
        }
        for (const uv of attrs.uvs) {
          expect(Number.isFinite(uv)).toBe(true);
        }
        for (let v = 0; v < attrs.positions.length / 3; v++) {
          const l = Math.hypot(
            attrs.normals[v * 3]!,
            attrs.normals[v * 3 + 1]!,
            attrs.normals[v * 3 + 2]!,
          );
          expect(Number.isFinite(l)).toBe(true);
          expect(Math.abs(l - 1)).toBeLessThan(1e-4);
        }
        expect(attrs.attributes["TANGENT"]).toBeUndefined();
        expect(attrs.material).toBe(0); // material slot preserved from the source
        // LOD0 is the verbatim input (unsuffixed name); generated levels carry the suffix.
        if (idx >= 1) {
          expect(attrs.meshName).toContain(`_LOD${idx}`);
        } else {
          expect(attrs.meshName).toBe("grid");
        }
      }
    });
  });

  it("is byte-deterministic across runs", async () => {
    await withTempDir(async (dir) => {
      const { glb } = buildGridGlb(20, 20);
      const inputPath = join(dir, "gridInput.glb");
      await writeFile(inputPath, glb);
      const a = await runLodGeneration(inputPath, { ratios: RATIOS, minTris: 32, error: 0.02 });
      const b = await runLodGeneration(inputPath, { ratios: RATIOS, minTris: 32, error: 0.02 });
      expect(a.levels).toHaveLength(b.levels.length);
      for (let i = 0; i < a.levels.length; i++) {
        expect(a.levels[i]!.glb.length).toBe(b.levels[i]!.glb.length);
        expect(a.levels[i]!.glb.every((byte, j) => byte === b.levels[i]!.glb[j]!)).toBe(true);
      }
    });
  });

  it("keeps material slots when a named material is present (no texture refs to strip)", async () => {
    await withTempDir(async (dir) => {
      const { glb } = buildGridGlb(16, 16);
      const inputPath = join(dir, "gridInput.glb");
      await writeFile(inputPath, glb);
      const result = await runLodGeneration(inputPath, { ratios: [0.5], minTris: 32, error: 0.02 });
      expect(result.warnings).toEqual([]);
      expect(result.levels).toHaveLength(2);
      const attrs = parseFirstPrimitive(result.levels[1]!.glb);
      expect(attrs.material).toBe(0);
    });
  });
});

describe("loadLodSources", () => {
  it("throws on a non-GLB file", async () => {
    await withTempDir(async (dir) => {
      const inputPath = join(dir, "notGlb.bin");
      await writeFile(inputPath, new Uint8Array([1, 2, 3, 4]));
      await expect(loadLodSources(inputPath)).rejects.toThrow(/Not a valid \.glb/i);
    });
  });

  it("extracts indexed primitives from the fixture", async () => {
    await withTempDir(async (dir) => {
      const { glb } = buildGridGlb(8, 8);
      const inputPath = join(dir, "gridInput.glb");
      await writeFile(inputPath, glb);
      const { sources, fileName } = await loadLodSources(inputPath);
      expect(sources).toHaveLength(1);
      expect(sources[0]!.primitives[0]!.indices.length % 3).toBe(0);
      expect(fileName).toBe("gridInput.glb");
    });
  });
});
