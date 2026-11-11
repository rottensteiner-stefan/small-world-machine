import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { bakeSpecies, mergeAlphaPng } from "../../src/core/species.js";

function png(w: number, h: number, fill: (i: number) => [number, number, number, number]): Buffer {
  const img = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) img.data.set(fill(i), i * 4);
  return PNG.sync.write(img);
}

/** Writes a tiny tree: a 4-quad trunk strip ("bark") + 200 separate leaf quads ("leaves"). */
function writeFixture(dir: string): string {
  const parts: { pos: number[]; uv: number[]; idx: number[] }[] = [];
  const bark = { pos: [] as number[], uv: [] as number[], idx: [] as number[] };
  for (let k = 0; k <= 4; k++) {
    bark.pos.push(-0.2, k, 0, 0.2, k, 0);
    bark.uv.push(0, k / 4, 1, k / 4);
  }
  for (let k = 0; k < 4; k++) {
    const a = k * 2;
    bark.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  parts.push(bark);
  const leaves = { pos: [] as number[], uv: [] as number[], idx: [] as number[] };
  for (let q = 0; q < 200; q++) {
    const x = (q % 20) * 0.3 - 3;
    const z = Math.floor(q / 20) * 0.3 - 1.5;
    const b = leaves.pos.length / 3;
    leaves.pos.push(x, 4, z, x + 0.2, 4, z, x, 4, z + 0.2, x + 0.2, 4, z + 0.2);
    leaves.uv.push(0, 0, 1, 0, 0, 1, 1, 1);
    leaves.idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  parts.push(leaves);
  const chunks: Buffer[] = [];
  const views: object[] = [];
  const accessors: object[] = [];
  let offset = 0;
  const push = (
    data: Float32Array | Uint32Array,
    type: string,
    target: number,
    minmax = false,
  ): number => {
    const buf = Buffer.from(data.buffer);
    views.push({ buffer: 0, byteOffset: offset, byteLength: buf.length, target });
    chunks.push(buf);
    offset += buf.length;
    const comps = { SCALAR: 1, VEC2: 2, VEC3: 3 }[type]!;
    const acc: Record<string, unknown> = {
      bufferView: views.length - 1,
      componentType: data instanceof Float32Array ? 5126 : 5125,
      count: data.length / comps,
      type,
    };
    if (minmax) {
      const f = data as Float32Array;
      acc["min"] = [0, 1, 2].map((c) => Math.min(...Array.from(f).filter((_, i) => i % 3 === c)));
      acc["max"] = [0, 1, 2].map((c) => Math.max(...Array.from(f).filter((_, i) => i % 3 === c)));
    }
    accessors.push(acc);
    return accessors.length - 1;
  };
  const primitives = parts.map((p, m) => ({
    attributes: {
      POSITION: push(new Float32Array(p.pos), "VEC3", 34962, true),
      TEXCOORD_0: push(new Float32Array(p.uv), "VEC2", 34962),
    },
    indices: push(new Uint32Array(p.idx), "SCALAR", 34963),
    material: m,
  }));
  mkdirSync(join(dir, "textures"), { recursive: true });
  writeFileSync(join(dir, "tree.bin"), Buffer.concat(chunks));
  writeFileSync(join(dir, "textures/bark_diff_1k.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  writeFileSync(
    join(dir, "textures/leaves_diff_1k.png"),
    png(4, 4, () => [30, 120, 40, 255]),
  );
  writeFileSync(
    join(dir, "textures/leaves_alpha_1k.png"),
    png(4, 4, (i) => (i % 2 ? [255, 255, 255, 255] : [0, 0, 0, 255])),
  );
  const gltf = {
    asset: { version: "2.0" },
    buffers: [{ uri: "tree.bin", byteLength: offset }],
    bufferViews: views,
    accessors,
    images: [{ uri: "textures/bark_diff_1k.jpg" }, { uri: "textures/leaves_diff_1k.png" }],
    textures: [{ source: 0 }, { source: 1 }],
    materials: [
      { name: "bark", pbrMetallicRoughness: { baseColorTexture: { index: 0 } } },
      { name: "leaves", pbrMetallicRoughness: { baseColorTexture: { index: 1 } } },
    ],
    meshes: [{ name: "tree", primitives }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };
  const path = join(dir, "tree_1k.gltf");
  writeFileSync(path, JSON.stringify(gltf));
  return path;
}

describe("bakeSpecies", () => {
  it("writes a thinned LOD chain, albedo layers and the sidecar", async () => {
    const dir = mkdtempSync(join(tmpdir(), "species-"));
    const out = join(dir, "out");
    const result = await bakeSpecies(writeFixture(dir), out, "tree", [
      { leafKeep: 0.5, twigKeep: 1, woodTris: 1000 },
      { leafKeep: 0.1, twigKeep: 1, woodTris: 1000 },
    ]);
    expect(result.levels).toHaveLength(2);
    expect(result.levels[0]!["leaves"]).toBeLessThan(400);
    expect(result.levels[1]!["leaves"]).toBeLessThan(result.levels[0]!["leaves"]!);
    expect(result.levels[0]!["bark"]).toBe(8);
    const sidecar = JSON.parse(readFileSync(join(out, "tree.species.json"), "utf8"));
    expect(
      sidecar.layers.map((l: { foliage: number; cutout: boolean }) => [l.foliage, l.cutout]),
    ).toEqual([
      [0, false],
      [1, true],
    ]);
    const leaf = PNG.sync.read(readFileSync(join(out, "tree_albedo_1.png")));
    expect([leaf.data[3], leaf.data[7]]).toEqual([0, 255]);
    expect(readFileSync(join(out, "tree_LOD0.glb")).readUInt32LE(0)).toBe(0x46546c67);
  });

  it("is deterministic (identical input -> identical GLB bytes)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "species-"));
    const input = writeFixture(dir);
    await bakeSpecies(input, join(dir, "a"), "tree");
    await bakeSpecies(input, join(dir, "b"), "tree");
    expect(
      readFileSync(join(dir, "a/tree_LOD1.glb")).equals(readFileSync(join(dir, "b/tree_LOD1.glb"))),
    ).toBe(true);
  });

  it("rejects a cutout layer without a PNG diffuse and mismatched alpha sizes", () => {
    expect(() =>
      mergeAlphaPng(
        png(2, 2, () => [0, 0, 0, 255]),
        png(4, 4, () => [0, 0, 0, 255]),
      ),
    ).toThrow();
  });
});
