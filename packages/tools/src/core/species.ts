/**
 * Species bake (ADR 0059): scan/photogrammetry tree (.gltf + external .bin) -> field-lane LOD chain
 * + species sidecar + albedo layers, the input of `vegetation-extras` `loadVegetationSpecies`.
 *
 * Industry model: SpeedTree exporter / Simplygon foliage reduction. Per level, leaf-card islands
 * are ONLY thinned (stable hash; kept cards scaled about their centroid by `sqrt(ref/keep)` to keep
 * canopy coverage) -- never simplified, a collapsed card becomes a textured shard. Small twig
 * islands are thinned unscaled; large wood islands (limbs, trunk) are kept and simplified with
 * meshoptimizer `Permissive` (may cross uv seams; no vertex-clustering shards). COLOR_0 becomes
 * (1,1,1,foliageMask). Cutout layers merge the diffuse PNG with a separate `*_alpha_*.png` (pngjs).
 * Headless + deterministic: identical input = identical output bytes.
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { PNG } from "pngjs";
import { MeshoptSimplifier } from "meshoptimizer/simplifier";
import {
  buildLodGlb,
  extractLodSources,
  computeNormals,
  type LodLevelPrimitive,
  type LodPrimitiveSource,
} from "./lod.js";

export interface SpeciesLevel {
  /** Share of leaf-card islands kept. */
  leafKeep: number;
  /** Share of small twig islands kept (islands >= `WOOD_PROTECT_TRIS` always survive). */
  twigKeep: number;
  /** Triangle budget of the surviving wood (trunk + branches, split by source share). */
  woodTris: number;
}
export const SPECIES_LEVELS: readonly SpeciesLevel[] = [
  { leafKeep: 0.05, twigKeep: 0.3, woodTris: 25000 },
  { leafKeep: 0.015, twigKeep: 0.1, woodTris: 7000 },
  { leafKeep: 0.005, twigKeep: 0.03, woodTris: 2000 },
  { leafKeep: 0.0015, twigKeep: 0.01, woodTris: 500 },
];
/** Leaf share that already reads as a full canopy (cards overlap heavily); scale = sqrt(ref/keep). */
const LEAF_COVERAGE_REF = 0.2;
const MAX_LEAF_SCALE = 8;
/** Wood islands at or above this triangle count are limbs: never thinned. */
const WOOD_PROTECT_TRIS = 150;

function hash01(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Keeps a stable `keep` share of the primitive's islands, scaled about their centroids. */
function thinIslands(
  src: LodPrimitiveSource,
  keep: number,
  scale: number,
  protectTris: number,
): LodPrimitiveSource {
  const nv = src.positions.length / 3;
  const parent = new Int32Array(nv);
  for (let i = 0; i < nv; i++) parent[i] = i;
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  const idx = src.indices;
  for (let t = 0; t < idx.length; t += 3) {
    const a = find(idx[t]!);
    parent[find(idx[t + 1]!)] = a;
    parent[find(idx[t + 2]!)] = a;
  }
  // Island id = root; rank islands by their root's position hash (stable, input-order independent).
  const centroid = new Map<number, [number, number, number, number]>();
  for (let v = 0; v < nv; v++) {
    const r = find(v);
    const c = centroid.get(r) ?? [0, 0, 0, 0];
    c[0] += src.positions[v * 3]!;
    c[1] += src.positions[v * 3 + 1]!;
    c[2] += src.positions[v * 3 + 2]!;
    c[3]++;
    centroid.set(r, c);
  }
  const islandTris = new Map<number, number>();
  for (let t = 0; t < idx.length; t += 3) {
    const r = find(idx[t]!);
    islandTris.set(r, (islandTris.get(r) ?? 0) + 1);
  }
  const kept = new Set<number>();
  const protectedSet = new Set<number>();
  let bestHash = Number.POSITIVE_INFINITY;
  let bestRoot = -1;
  for (const [r, c] of centroid) {
    if ((islandTris.get(r) ?? 0) >= protectTris) {
      kept.add(r);
      protectedSet.add(r);
      continue;
    }
    const key =
      Math.round((c[0] / c[3]) * 1000) ^
      Math.imul(Math.round((c[2] / c[3]) * 1000), 31) ^
      Math.imul(Math.round((c[1] / c[3]) * 1000), 131);
    const h = hash01(key);
    if (h < keep) kept.add(r);
    if (h < bestHash) {
      bestHash = h;
      bestRoot = r;
    }
  }
  // Never thin a primitive away entirely (an empty primitive breaks the GLB writer and the species
  // part/layer contract): keep the island with the smallest hash (deterministic).
  if (kept.size === 0 && bestRoot >= 0) kept.add(bestRoot);
  const positions = new Float32Array(src.positions);
  for (let v = 0; v < nv; v++) {
    const r = find(v);
    if (!kept.has(r) || protectedSet.has(r) || scale === 1) continue;
    const c = centroid.get(r)!;
    for (let k = 0; k < 3; k++) {
      const m = c[k]! / c[3];
      positions[v * 3 + k] = m + (positions[v * 3 + k]! - m) * scale;
    }
  }
  const out: number[] = [];
  for (let t = 0; t < idx.length; t += 3)
    if (kept.has(find(idx[t]!))) out.push(idx[t]!, idx[t + 1]!, idx[t + 2]!);
  return { ...src, positions, indices: new Uint32Array(out) };
}

/** meshoptimizer `Permissive` collapse (may cross uv seams; error-bounded, no vertex clustering).
 * Attributes are taken from the surviving source vertices; normals recomputed. */
function simplifyPermissive(
  src: LodPrimitiveSource,
  targetTris: number,
  error: number,
): LodLevelPrimitive {
  // Compact to the referenced vertex set first (meshopt requires it).
  const nv = src.positions.length / 3;
  const map = new Int32Array(nv).fill(-1);
  const used: number[] = [];
  const ib = new Uint32Array(src.indices.length);
  for (let i = 0; i < ib.length; i++) {
    const o = src.indices[i]!;
    if (map[o] === -1) {
      map[o] = used.length;
      used.push(o);
    }
    ib[i] = map[o]!;
  }
  const take = (a: Float32Array, k: number, from: readonly number[]): Float32Array => {
    const out = new Float32Array(from.length * k);
    from.forEach((o, n) => {
      for (let c = 0; c < k; c++) out[n * k + c] = a[o * k + c]!;
    });
    return out;
  };
  const pos = take(src.positions, 3, used);
  const uv = src.uvs ? take(src.uvs, 2, used) : new Float32Array(used.length * 2);
  const [simplified] = MeshoptSimplifier.simplifyWithAttributes(
    ib,
    pos,
    3,
    uv,
    2,
    [0.02, 0.02],
    null,
    targetTris * 3,
    error,
    ["Permissive"],
  );
  const [remap, unique] = MeshoptSimplifier.compactMesh(simplified);
  const back: number[] = new Array(unique);
  for (let v = 0; v < remap.length; v++) if (remap[v] !== 0xffffffff) back[remap[v]!] = v;
  const positions = take(pos, 3, back);
  return {
    positions,
    normals: computeNormals(simplified, positions),
    uvs: take(uv, 2, back),
    colors: null,
    indices: simplified,
    material: src.material,
  };
}

/** Drops unreferenced vertices (thinning keeps the full source arrays). */
function compact(src: LodPrimitiveSource): LodLevelPrimitive {
  const nv = src.positions.length / 3;
  const map = new Int32Array(nv).fill(-1);
  const used: number[] = [];
  const indices = new Uint32Array(src.indices.length);
  for (let i = 0; i < indices.length; i++) {
    const o = src.indices[i]!;
    if (map[o] === -1) {
      map[o] = used.length;
      used.push(o);
    }
    indices[i] = map[o]!;
  }
  const take = (a: Float32Array | null, k: number): Float32Array | null => {
    if (!a) return null;
    const out = new Float32Array(used.length * k);
    used.forEach((o, n) => {
      for (let c = 0; c < k; c++) out[n * k + c] = a[o * k + c]!;
    });
    return out;
  };
  return {
    positions: take(src.positions, 3)!,
    normals: take(src.normals, 3),
    uvs: take(src.uvs, 2),
    colors: null,
    indices,
    material: src.material,
  };
}

function withMaskColors(p: LodLevelPrimitive, mask: number): LodLevelPrimitive {
  const n = p.positions.length / 3;
  const colors = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) colors.set([1, 1, 1, mask], i * 4);
  return { ...p, colors };
}

/** Material names that count as foliage (leaf cards). */
const FOLIAGE_NAME = /leaf|leaves|needle|foliage/i;

export interface SpeciesBakeResult {
  /** Triangles per primitive (material name) per level, finest first. */
  readonly levels: readonly Record<string, number>[];
  /** Files written into the output directory. */
  readonly files: readonly string[];
}

/** Merges a diffuse PNG with a grey alpha PNG (same size) into an RGBA PNG buffer. */
export function mergeAlphaPng(diffusePng: Buffer, alphaPng: Buffer): Buffer {
  const diffuse = PNG.sync.read(diffusePng);
  const alpha = PNG.sync.read(alphaPng);
  if (diffuse.width !== alpha.width || diffuse.height !== alpha.height) {
    throw new Error(
      `[species] alpha ${alpha.width}x${alpha.height} != diffuse ${diffuse.width}x${diffuse.height}`,
    );
  }
  for (let p = 0; p < diffuse.width * diffuse.height; p++)
    diffuse.data[p * 4 + 3] = alpha.data[p * 4]!;
  return PNG.sync.write(diffuse);
}

/**
 * Bakes `inPath` (.gltf with an external .bin) into `outDir`: `<stem>_LOD0..N.glb`,
 * `<stem>_albedo_<i>.(jpg|png)` (one per primitive, primitive order) and `<stem>.species.json`.
 * A cutout layer needs `<diffuse>_alpha_<res>.png` next to the diffuse; the diffuse must then be
 * a PNG (a `.png` sibling of a `.jpg` diffuse is picked up automatically).
 */
export async function bakeSpecies(
  inPath: string,
  outDir: string,
  stem: string,
  levels: readonly SpeciesLevel[] = SPECIES_LEVELS,
): Promise<SpeciesBakeResult> {
  await MeshoptSimplifier.ready;
  const json = JSON.parse(readFileSync(inPath, "utf8"));
  const binBytes = readFileSync(join(dirname(inPath), json.buffers[0].uri));
  const bin = binBytes.buffer.slice(
    binBytes.byteOffset,
    binBytes.byteOffset + binBytes.byteLength,
  ) as ArrayBuffer;
  const sources = extractLodSources({ json, buffers: [bin] });
  if (sources.length === 0)
    throw new Error("[species] no indexed triangle primitives in the input");
  const matName = (m: number | undefined): string =>
    m === undefined ? "" : String(json.materials?.[m]?.name ?? "");
  mkdirSync(outDir, { recursive: true });
  const files: string[] = [];
  const prims = sources[0]!.primitives;
  const woodTotal =
    prims
      .filter((p) => !FOLIAGE_NAME.test(matName(p.material)))
      .reduce((s, p) => s + p.indices.length / 3, 0) || 1;
  const layers = prims.map((p, i) => {
    const mat = json.materials?.[p.material ?? 0];
    const texIndex = mat?.pbrMetallicRoughness?.baseColorTexture?.index;
    const uri: string | undefined =
      texIndex !== undefined ? json.images[json.textures[texIndex].source].uri : undefined;
    if (!uri) throw new Error(`[species] primitive ${i}: material without base-colour texture`);
    const diffusePath = join(dirname(inPath), uri);
    const alphaPath = diffusePath.replace(/_diff_(\w+)\.(jpg|png)$/, "_alpha_$1.png");
    let file: string;
    if (alphaPath !== diffusePath && existsSync(alphaPath)) {
      const pngDiffuse = diffusePath.replace(/\.jpg$/, ".png");
      if (!existsSync(pngDiffuse)) {
        throw new Error(
          `[species] cutout layer needs a PNG diffuse: ${pngDiffuse} (alpha: ${alphaPath})`,
        );
      }
      file = `${stem}_albedo_${i}.png`;
      writeFileSync(
        join(outDir, file),
        mergeAlphaPng(readFileSync(pngDiffuse), readFileSync(alphaPath)),
      );
    } else {
      file = `${stem}_albedo_${i}${uri.endsWith(".png") ? ".png" : ".jpg"}`;
      copyFileSync(diffusePath, join(outDir, file));
    }
    files.push(file);
    return {
      albedo: file,
      cutout: file.endsWith(".png") && alphaPath !== diffusePath && existsSync(alphaPath),
      foliage: FOLIAGE_NAME.test(matName(p.material)) ? 1 : 0,
      material: matName(p.material),
    };
  });
  const sidecar = `${stem}.species.json`;
  writeFileSync(
    join(outDir, sidecar),
    JSON.stringify({ stem, levels: levels.length, layers }, null, 2) + "\n",
  );
  files.push(sidecar);
  const stats: Record<string, number>[] = [];
  for (let level = 0; level < levels.length; level++) {
    const L = levels[level]!;
    const meshes = sources.map((mesh) => ({
      name: mesh.name,
      primitives: mesh.primitives.map((p) => {
        if (FOLIAGE_NAME.test(matName(p.material))) {
          const scale = Math.min(
            MAX_LEAF_SCALE,
            Math.max(1, Math.sqrt(LEAF_COVERAGE_REF / L.leafKeep)),
          );
          return withMaskColors(
            compact(thinIslands(p, L.leafKeep, scale, Number.POSITIVE_INFINITY)),
            1,
          );
        }
        const thinned = thinIslands(p, L.twigKeep, 1, WOOD_PROTECT_TRIS);
        const target = Math.max(32, Math.round((L.woodTris * (p.indices.length / 3)) / woodTotal));
        const simplified =
          thinned.indices.length / 3 <= target
            ? compact(thinned)
            : simplifyPermissive(thinned, target, 0.05);
        return withMaskColors(simplified, 0);
      }),
    }));
    const row: Record<string, number> = {};
    meshes[0]!.primitives.forEach(
      (p, k) => (row[matName(p.material) || `primitive${k}`] = p.indices.length / 3),
    );
    stats.push(row);
    const file = `${stem}_LOD${level}.glb`;
    writeFileSync(join(outDir, file), buildLodGlb(json, meshes, stem, level));
    files.push(file);
  }
  return { levels: stats, files };
}
