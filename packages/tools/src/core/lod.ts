/**
 * `swm lod` headless core (ADR 0059 step 2 / P2-3): offline glTF LOD generation via
 * meshoptimizer (embedded WASM, zero external files). Runtime stays TS per ADR 0036 —
 * the engine consumes `*_LOD<n>`-named GLB meshes as per-bucket geometry without an
 * engine change (the per-bucket contract `LodBucketDescriptor.lodIndex` = 0 finest is
 * already bound engine-side).
 *
 * Naming contract (decided 2026-11-10): `<stem>_LOD0.glb` = the ORIGINAL file verbatim,
 * `<stem>_LOD<n>.glb` = progressively simplified (n descending detail). A consumer maps
 * the asset level onto `lodIndex` semantics (0 = finest / near).
 *
 * Pipeline per primitive (all WASM batch ops, zero JS mesh mutation):
 *   `simplifyWithAttributes` (UV weights against seam collapse; position weight implicit)
 *   -> `compactMesh` (in-place renumbering; sampled via the inverted old->new map)
 *   -> attribute sampling -> area-weighted normal recomputation in TypeScript.
 * Deterministic: identical input bytes + options = identical output bytes.
 */

import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { GltfBinaryParser } from "@small-world-machine/engine/loaders/gltf/GltfBinaryParser.js";
import type { GltfJson } from "@small-world-machine/engine/loaders/gltf/types.js";
import { MeshoptSimplifier } from "meshoptimizer/simplifier";

const GLB_MAGIC = 0x46546c67;
const GLB_JSON_TYPE = 0x4e4f534a;
const GLB_BIN_TYPE = 0x004e4942;
const GLB_VERSION = 2;
const GL_FLOAT = 5126;
const GL_UNSIGNED_INT = 5125;
const GL_TRIANGLES = 4;
const MISSING = 2 ** 32 - 1;

/** One extracted, indexed triangle primitive ready for simplification. */
export interface LodPrimitiveSource {
  positions: Float32Array; // count * 3
  normals: Float32Array | null; // count * 3
  uvs: Float32Array | null; // count * 2 (TEXCOORD_0)
  colors: Float32Array | null; // count * 4 (COLOR_0, alpha padded)
  indices: Uint32Array;
  material: number | undefined;
}

/** One mesh: name + triangle primitives (indexed-only, non-skinned V1 contract). */
export interface LodMeshSource {
  name: string;
  primitives: LodPrimitiveSource[];
}

/**
 * One generated level's geometry for one mesh. TANGENT is intentionally omitted: the
 * engine regenerates tangents at runtime (asset-pipeline §T1); meshoptimizer 1.3's
 * offline `generateTangents` sizes its output by the INDEX count, which never matches
 * the compacted vertex set — a half-working offline tangent path is worse than none.
 */
export interface LodLevelPrimitive {
  positions: Float32Array;
  normals: Float32Array | null;
  uvs: Float32Array | null;
  colors: Float32Array | null;
  indices: Uint32Array;
  material: number | undefined;
}

export interface LodMeshLevel {
  name: string;
  primitives: LodLevelPrimitive[];
}

export interface LodOptions {
  /** Per generated level (LOD1..LODn) target index budget as a FRACTION of source tris. */
  ratios: readonly number[];
  /** Floor for every level's triangle target (rounded to a multiple of 3). */
  minTris: number;
  /**
   * Base simplification error, meshoptimizer RELATIVE semantics (0.02 = 2 % of the mesh
   * size). The budget grows linearly per level (`error * level`): coarser LODs are allowed
   * more geometric deviation — the standard LOD quality ramp. Calibrated 2026-11-10 on an
   * organic 4.4 k-tri mesh: below 0.02 the simplifier stops early (quality gate), 0.02
   * reliably marches to the requested triangle target.
   */
  error: number;
}

export interface LodLevelOutput {
  /** Output file name (`<stem>_LOD<n>.glb`). */
  fileName: string;
  /** GLB bytes. LOD0 = verbatim copy of the input file. */
  glb: Uint8Array;
  /** Per-mesh triangle count at this level. */
  trisPerMesh: readonly number[];
}

export interface LodRunResult {
  levels: LodLevelOutput[];
  warnings: readonly string[];
}

export type LodVerificationIssue = { file: string; message: string };

export const LOD_DEFAULT_RATIOS: readonly number[] = [0.5, 0.2, 0.08];
export const LOD_DEFAULT_MIN_TRIS = 32;
/** Calibrated base error (see {@link LodOptions.error}): 2 % of the mesh size. */
export const LOD_DEFAULT_ERROR = 0.02;
/** glTF 2.0 spec-compliant normalized decoding (unsigned: c / (2^b - 1)). */
const NORM_DIVISOR_U = new Map<number, number>([
  [5121, 255],
  [5123, 65535],
]);
/** Signed normalized divisor (max(c / (2^(b-1) - 1), -1)). */
const NORM_DIVISOR_S = new Map<number, number>([
  [5120, 127],
  [5122, 32767],
]);

const COMPONENT_COUNT: Readonly<Record<string, number>> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
};

/** glTF accessor element type (used for the rebuild type instead of `unknown` records). */
type GltfAccessor = NonNullable<GltfJson["accessors"]>[number];

/** GLB buffers need `byteLength` (the engine's `GltfJson` buffer type models `uri` only). */
type LodJsonBuffer = NonNullable<GltfJson["buffers"]>[number] & { byteLength: number };

function componentCount(type: string): number {
  const count = COMPONENT_COUNT[type];
  if (count === undefined) {
    throw new Error(`[lod] unsupported accessor type "${type}" (expected SCALAR/VEC2/VEC3/VEC4)`);
  }
  return count;
}

/**
 * Decodes an accessor into a Float32Array, applying the exact glTF 2.0 normalized
 * integer mapping when `accessor.normalized` is set. Non-normalized data casts (5126
 * stays float). `dequantize` is intentionally NOT used: NORMAL stays in its
 * normalized domain per the parser contract.
 */
function accessorToF32(
  accessor: NonNullable<GltfJson["accessors"]>[number] | undefined,
  json: GltfJson,
  buffers: ArrayBuffer[],
): Float32Array | null {
  const raw = GltfBinaryParser.getBufferData(accessor, json, buffers);
  if (raw === null) return null;
  const out = new Float32Array(raw.length);
  const normalized = accessor?.normalized === true;
  if (!normalized) {
    out.set(raw as Float32Array);
    return out;
  }
  const divU = NORM_DIVISOR_U.get(accessor!.componentType);
  const divS = NORM_DIVISOR_S.get(accessor!.componentType);
  if (divS !== undefined) {
    for (let i = 0; i < raw.length; i++) out[i] = Math.max(raw[i]! / divS, -1);
  } else if (divU !== undefined) {
    for (let i = 0; i < raw.length; i++) out[i] = raw[i]! / divU;
  } else {
    throw new Error(
      `[lod] normalized accessor with unsupported componentType ${accessor!.componentType}`,
    );
  }
  return out;
}

function indicesToU32(
  accessor: NonNullable<GltfJson["accessors"]>[number] | undefined,
  json: GltfJson,
  buffers: ArrayBuffer[],
): Uint32Array | null {
  const raw = GltfBinaryParser.getBufferData(accessor, json, buffers);
  if (raw === null) return null;
  const out = new Uint32Array(raw.length);
  out.set(raw as Uint32Array);
  return out;
}

/** Extracts all indexed TRIANGLE primitives of every mesh (non-skinned V1 contract). */
export function extractLodSources(gltf: {
  json: GltfJson;
  buffers: ArrayBuffer[];
}): LodMeshSource[] {
  const json = gltf.json;
  const sources: LodMeshSource[] = [];
  for (const mesh of json.meshes ?? []) {
    const primitives: LodPrimitiveSource[] = [];
    for (const prim of mesh.primitives) {
      if (prim.mode !== undefined && prim.mode !== GL_TRIANGLES) {
        throw new Error(`[lod] primitive mode ${prim.mode} unsupported (TRIANGLES only)`);
      }
      if (prim.indices === undefined) {
        throw new Error("[lod] indexed-only V1 contract: primitive has no indices accessor");
      }
      const posIndex = prim.attributes["POSITION"];
      if (posIndex === undefined) continue;
      const positions = accessorToF32(json.accessors?.[posIndex], json, gltf.buffers);
      if (positions === null || positions.length < 9) continue;
      const normals =
        prim.attributes["NORMAL"] !== undefined
          ? accessorToF32(json.accessors?.[prim.attributes["NORMAL"]], json, gltf.buffers)
          : null;
      const uvs =
        prim.attributes["TEXCOORD_0"] !== undefined
          ? accessorToF32(json.accessors?.[prim.attributes["TEXCOORD_0"]], json, gltf.buffers)
          : null;
      let colors =
        prim.attributes["COLOR_0"] !== undefined
          ? accessorToF32(json.accessors?.[prim.attributes["COLOR_0"]], json, gltf.buffers)
          : null;
      const vertexCount = positions.length / 3;
      if (colors !== null && colors.length === vertexCount * 3) {
        // VEC3 COLOR_0 -> alpha 1 (the pipeline emits VEC4 uniformly).
        const alpha = new Float32Array(vertexCount * 4);
        for (let i = 0; i < vertexCount; i++) {
          alpha[i * 4] = colors[i * 3]!;
          alpha[i * 4 + 1] = colors[i * 3 + 1]!;
          alpha[i * 4 + 2] = colors[i * 3 + 2]!;
          alpha[i * 4 + 3] = 1;
        }
        colors = alpha;
      }
      const indices = indicesToU32(json.accessors?.[prim.indices], json, gltf.buffers);
      if (indices === null || indices.length < 3) continue;
      primitives.push({
        positions,
        normals,
        uvs,
        colors,
        indices,
        material: prim.material,
      });
    }
    if (primitives.length > 0) {
      sources.push({ name: mesh.name ?? "mesh", primitives });
    }
  }
  return sources;
}

/** Reads + parses a GLB from disk into `LodMeshSource`s (keeps the verbatim bytes for LOD0). */
export async function loadLodSources(filePath: string): Promise<{
  sources: LodMeshSource[];
  json: GltfJson;
  originalBytes: Uint8Array;
  fileName: string;
}> {
  const originalBytes = new Uint8Array(await readFile(filePath));
  const view = originalBytes.buffer.slice(
    originalBytes.byteOffset,
    originalBytes.byteOffset + originalBytes.byteLength,
  ) as ArrayBuffer;
  const gltf = GltfBinaryParser.parseGlb(view);
  const sources = extractLodSources(gltf);
  if (sources.length === 0) {
    throw new Error("[lod] no indexed TRIANGLE primitives found in the input GLB");
  }
  return {
    sources,
    json: gltf.json,
    originalBytes,
    fileName: basename(filePath),
  };
}

/** Rounds a target index count down to a multiple of 3 (meshopt asserts target % 3 == 0). */
function roundToMultipleOf3(target: number): number {
  return Math.max(Math.floor(target / 3) * 3, 3);
}

/**
 * Target triangle count for one level: `srcTris * ratio`, floored at `minTris`, never
 * exceeding `srcTris` — meshopt asserts `target_index_count <= index_count`, so tiny
 * primitives (e.g. a 2-tri flag) collapse to a no-op pass-through (target = src) and the
 * simplifier honestly keeps them. A `3 * n` multiple-of-3 target preserves the assert.
 */
export function targetTrisForLevel(srcTris: number, ratio: number, minTris: number): number {
  const raw = roundToMultipleOf3(Math.floor(srcTris * ratio));
  const floored = roundToMultipleOf3(minTris);
  // Reduce by at most `srcTris - 3` (keep >= 3 tris) and clamp to `srcTris` itself.
  const reduced = Math.min(Math.max(raw, floored), Math.max(3, srcTris - 3));
  return Math.min(reduced, srcTris);
}

function sampleByRemap(
  attr: Float32Array | null,
  oldForNew: Uint32Array,
  components: number,
): Float32Array | null {
  if (attr === null) return null;
  const out = new Float32Array(oldForNew.length * components);
  for (let v = 0; v < oldForNew.length; v++) {
    const old = oldForNew[v]! * components;
    for (let c = 0; c < components; c++) out[v * components + c] = attr[old + c]!;
  }
  return out;
}

interface CompactedPrimitive {
  positions: Float32Array;
  normals: Float32Array | null;
  uvs: Float32Array | null;
  colors: Float32Array | null;
  indices: Uint32Array;
}

/**
 * Compacts the index-referenced vertex set (usage-based, NOT position-welding — duplicate
 * positions with different attributes stay distinct). meshoptimizer 1.3 does NOT simplify
 * arrays that carry unreferenced vertices (observed: hits retain the full triangle set), so
 * every primitive is compacted to exactly the referenced set before the WASM call. The
 * attribute VALUES are copied verbatim; only the set is renumbered.
 */
function compactByUsage(src: LodPrimitiveSource): CompactedPrimitive {
  const vcount = src.positions.length / 3;
  const newForOld = new Uint32Array(vcount);
  const oldForNew = new Uint32Array(vcount).fill(MISSING);
  let unique = 0;
  const indices = new Uint32Array(src.indices.length);
  for (let i = 0; i < src.indices.length; i++) {
    const old = src.indices[i]!;
    let nw = oldForNew[old]!;
    if (nw === MISSING) {
      nw = unique;
      oldForNew[old] = nw;
      newForOld[nw] = old;
      unique++;
    }
    indices[i] = nw;
  }
  const positions = new Float32Array(unique * 3);
  for (let v = 0; v < unique; v++) {
    const old = newForOld[v]! * 3;
    positions[v * 3] = src.positions[old]!;
    positions[v * 3 + 1] = src.positions[old + 1]!;
    positions[v * 3 + 2] = src.positions[old + 2]!;
  }
  // `used` is EXACTLY `unique` long (sampling allocates by `.length`).
  const used = newForOld.subarray(0, unique);
  return {
    positions,
    normals: sampleByRemap(src.normals, used, 3),
    uvs: sampleByRemap(src.uvs, used, 2),
    colors: sampleByRemap(src.colors, used, 4),
    indices,
  };
}

/**
 * Computes area-weighted per-vertex normals for an indexed triangle set in pure
 * TypeScript (deterministic, tested). Coincident/degenerate vertices that accumulate
 * a zero cross-product fall back to +Y (valid but neutral shading). Normals are ALWAYS
 * recomputed for simplified geometry: the post-simplification face set differs from the
 * source, so sampling the original per-vertex normals would leave stale shading.
 */
export function computeNormals(indices: Uint32Array, positions: Float32Array): Float32Array {
  const vertexCount = positions.length / 3;
  const normals = new Float32Array(vertexCount * 3);
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i]! * 3;
    const b = indices[i + 1]! * 3;
    const c = indices[i + 2]! * 3;
    const abx = positions[b]! - positions[a]!;
    const aby = positions[b + 1]! - positions[a + 1]!;
    const abz = positions[b + 2]! - positions[a + 2]!;
    const acx = positions[c]! - positions[a]!;
    const acy = positions[c + 1]! - positions[a + 1]!;
    const acz = positions[c + 2]! - positions[a + 2]!;
    // Unnormalized cross product accumulates per-area contribution (area weighting).
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    normals[a]! += nx;
    normals[a + 1]! += ny;
    normals[a + 2]! += nz;
    normals[b]! += nx;
    normals[b + 1]! += ny;
    normals[b + 2]! += nz;
    normals[c]! += nx;
    normals[c + 1]! += ny;
    normals[c + 2]! += nz;
  }
  for (let v = 0; v < vertexCount; v++) {
    const i = v * 3;
    const len = Math.hypot(normals[i]!, normals[i + 1]!, normals[i + 2]!);
    if (len > 0) {
      normals[i] = normals[i]! / len;
      normals[i + 1] = normals[i + 1]! / len;
      normals[i + 2] = normals[i + 2]! / len;
    } else {
      normals[i + 1] = 1; // degenerate vertex: neutral +Y fallback
    }
  }
  return normals;
}

/**
 * Simplifies one primitive to `targetTris` via the meshoptimizer WASM chain.
 * Returns compacted geometry (fresh vertex arrays) with recomputed area-weighted
 * normals. TANGENT is intentionally omitted (the engine regenerates it at runtime,
 * asset-pipeline §T1). Deterministic for fixed inputs.
 */
export function simplifyPrimitive(
  src: LodPrimitiveSource,
  targetTris: number,
  error: number,
): LodLevelPrimitive {
  // Pre-compaction: meshoptimizer 1.3 requires the exact referenced vertex set (see
  // `compactByUsage`). This is ALSO the standard LOD-tool hygiene (no wasted WASM work).
  const compact = compactByUsage(src);
  const indexTarget = targetTris * 3;
  const hasUv = compact.uvs !== null;
  // Low UV weight (0.05) gently penalizes seam stretch without blocking collapse (weight
  // 0.5 empirically froze organic foliage at its collapse floor). The error budget is the
  // productive gate: meshopt stops the collapse stream before `targetTris` when the next
  // edge would exceed `error` — fail-soft, the CLI reports the honest achieved count.
  const [simplified] = hasUv
    ? MeshoptSimplifier.simplifyWithAttributes(
        compact.indices,
        compact.positions,
        3,
        compact.uvs!,
        2,
        [0.05, 0.05],
        null,
        indexTarget,
        error,
      )
    : MeshoptSimplifier.simplify(compact.indices, compact.positions, 3, indexTarget, error);

  // `compactMesh` renumbers `simplified` IN PLACE to [0, uniqueCount) and returns the
  // old->new map. Compacted attributes are sampled through the inverted map.
  const [remap, uniqueCount] = MeshoptSimplifier.compactMesh(simplified);
  const oldForNew = new Uint32Array(uniqueCount);
  const compactVertexCount = compact.positions.length / 3;
  for (let old = 0; old < compactVertexCount; old++) {
    const nw = remap[old]!;
    if (nw !== MISSING) oldForNew[nw] = old;
  }
  const positions = new Float32Array(uniqueCount * 3);
  for (let v = 0; v < uniqueCount; v++) {
    const old = oldForNew[v]! * 3;
    positions[v * 3] = compact.positions[old]!;
    positions[v * 3 + 1] = compact.positions[old + 1]!;
    positions[v * 3 + 2] = compact.positions[old + 2]!;
  }
  const uvs = sampleByRemap(compact.uvs, oldForNew, 2);
  const colors = sampleByRemap(compact.colors, oldForNew, 4);

  // See `computeNormals`: always recomputed (stale source normals would mis-shade the
  // simplified face set); TANGENT omitted (engine regenerates at runtime, §T1).
  const normals = computeNormals(simplified, positions);
  return {
    positions,
    normals,
    uvs,
    colors,
    indices: simplified,
    material: src.material,
  };
}

/**
 * Strips all texture references from a copied material so the geometry-only GLB stays
 * VALID glTF 2.0 (no dangling `textures` indices). Appearance deviates only for assets
 * that carried textures (called through the warning path); the repo tree-asset
 * contract is texture-free.
 */
function stripTextureRefs(material: Record<string, unknown>): Record<string, unknown> {
  const stripped: Record<string, unknown> = { ...material };
  const pbr = stripped["pbrMetallicRoughness"] as Record<string, unknown> | undefined;
  if (pbr !== undefined) {
    const p: Record<string, unknown> = { ...pbr };
    delete p["baseColorTexture"];
    delete p["metallicRoughnessTexture"];
    stripped["pbrMetallicRoughness"] = p;
  }
  delete stripped["normalTexture"];
  delete stripped["occlusionTexture"];
  delete stripped["emissiveTexture"];
  return stripped;
}

interface PackedAttr {
  accessor: GltfAccessor;
  bytes: Uint8Array;
}

function packData(
  data: Float32Array | Uint32Array,
  type: "VEC2" | "VEC3" | "VEC4" | "SCALAR",
  componentType: number,
): PackedAttr {
  const bytes = new Uint8Array(
    data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
  );
  const accessor: GltfAccessor = {
    componentType,
    count: data.length / componentCount(type),
    type,
  };
  return { accessor, bytes };
}

/**
 * Builds a self-contained geometry-only GLB for one LOD level of every source mesh.
 * Materials are copied from the source with texture refs stripped, so the primitive
 * `material` indices stay meaningful to any glTF consumer. POSITION accessors carry
 * the spec-required `min`/`max`; all buffer views are 4-byte aligned.
 */
export function buildLodGlb(
  json: GltfJson,
  levelMeshes: readonly LodMeshLevel[],
  stem: string,
  level: number,
): Uint8Array {
  const accessors: GltfAccessor[] = [];
  const viewBytes: Uint8Array[] = [];
  let binLength = 0;

  const meshesJson = levelMeshes.map((mesh) => {
    const primitivesJson = mesh.primitives.map((p) => {
      const attrs: Record<string, number> = {};
      const push = (data: Float32Array, name: string, type: "VEC2" | "VEC3" | "VEC4"): void => {
        if (data.length === 0) return;
        const packed = packData(data, type, GL_FLOAT);
        const ai = accessors.length;
        const vi = viewBytes.length;
        packed.accessor["bufferView"] = vi; // accessor -> view linkage (required glTF)
        accessors.push(packed.accessor);
        viewBytes.push(packed.bytes);
        binLength += packed.bytes.length;
        attrs[name] = ai;
      };
      push(p.positions, "POSITION", "VEC3");
      const posAttr = accessors[attrs["POSITION"]!]!;
      // glTF spec: POSITION accessor MUST declare min/max (float domain here).
      let min: number[] = [];
      let max: number[] = [];
      for (let c = 0; c < 3; c++) {
        let lo = Infinity;
        let hi = -Infinity;
        for (let i = c; i < p.positions.length; i += 3) {
          lo = Math.min(lo, p.positions[i]!);
          hi = Math.max(hi, p.positions[i]!);
        }
        min = [...min, lo];
        max = [...max, hi];
      }
      posAttr["min"] = min;
      posAttr["max"] = max;
      if (p.normals !== null) push(p.normals, "NORMAL", "VEC3");
      if (p.uvs !== null) push(p.uvs, "TEXCOORD_0", "VEC2");
      if (p.colors !== null) push(p.colors, "COLOR_0", "VEC4");
      const indicesPacked = packData(p.indices, "SCALAR", GL_UNSIGNED_INT);
      const indicesAccessor = accessors.length;
      indicesPacked.accessor["bufferView"] = viewBytes.length;
      accessors.push(indicesPacked.accessor);
      viewBytes.push(indicesPacked.bytes);
      binLength += indicesPacked.bytes.length;
      return {
        attributes: attrs,
        indices: indicesAccessor,
        ...(p.material !== undefined ? { material: p.material } : {}),
      };
    });
    return { name: `${mesh.name}_LOD${level}`, primitives: primitivesJson };
  });

  if (binLength === 0) {
    throw new Error("[lod] no geometry produced — every mesh has empty primitives");
  }

  const bufferViews = [];
  let offset = 0;
  for (const bytes of viewBytes) {
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length });
    offset += bytes.length;
  }
  const buffers: LodJsonBuffer[] = [{ byteLength: binLength }];
  const outJson: GltfJson = {
    asset: { version: "2.0", generator: "small-world-machine swm lod" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: stem, mesh: 0 }],
    meshes: meshesJson,
    materials: (json.materials ?? []).map((m) => stripTextureRefs(m as Record<string, unknown>)),
    accessors,
    bufferViews,
    buffers,
  };

  const jsonBytes = new TextEncoder().encode(JSON.stringify(outJson));
  const jsonPadded = Math.ceil(jsonBytes.length / 4) * 4;
  const binPadded = Math.ceil(binLength / 4) * 4;
  const total = 12 + 8 + jsonPadded + 8 + binPadded;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, GLB_VERSION, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonPadded, true);
  view.setUint32(16, GLB_JSON_TYPE, true);
  out.set(jsonBytes, 20);
  // The glTF spec REQUIRES the JSON chunk trailing padding to be SPACES (0x20), never
  // null bytes: parsers decode `chunkLength` bytes and feed them to JSON.parse, which
  // rejects NUL but accepts whitespace. The engine parser reads exactly this window.
  out.fill(0x20, 20 + jsonBytes.length, 20 + jsonPadded);
  view.setUint32(20 + jsonPadded, binPadded, true);
  view.setUint32(20 + jsonPadded + 4, GLB_BIN_TYPE, true);
  let binOffset = 20 + jsonPadded + 8;
  for (const bytes of viewBytes) {
    out.set(bytes, binOffset);
    binOffset += bytes.length;
  }
  return out;
}

/**
 * Orchestrates a full LOD run: parse -> LOD0 verbatim + LOD1..n via meshoptimizer.
 * Deterministic; warnings surface texture-stripping and skipped levels.
 */
export async function runLodGeneration(
  inputPath: string,
  options: LodOptions,
): Promise<LodRunResult> {
  const { sources, json, originalBytes, fileName } = await loadLodSources(inputPath);
  const stem = basename(fileName, extname(fileName));
  const warnings: string[] = [];
  if ((json.textures?.length ?? 0) > 0) {
    warnings.push(
      "source embeds textures: geometry-only output keeps materials but strips texture refs (V1)",
    );
  }
  const sourceTris = sources.map((s) => s.primitives.reduce((a, p) => a + p.indices.length / 3, 0));
  const levels: LodLevelOutput[] = [
    { fileName: `${stem}_LOD0.glb`, glb: originalBytes, trisPerMesh: sourceTris },
  ];
  options.ratios.forEach((ratio, lvl) => {
    const levelError = options.error * (lvl + 1); // coarser LODs get a larger error budget
    const levelMeshes: LodMeshLevel[] = sources.map((src) => ({
      name: src.name,
      primitives: src.primitives.map((p) => {
        const target = targetTrisForLevel(p.indices.length / 3, ratio, options.minTris);
        return simplifyPrimitive(p, target, levelError);
      }),
    }));
    levels.push({
      fileName: `${stem}_LOD${lvl + 1}.glb`,
      glb: buildLodGlb(json, levelMeshes, stem, lvl + 1),
      trisPerMesh: levelMeshes.map((m) =>
        m.primitives.reduce((a, p) => a + p.indices.length / 3, 0),
      ),
    });
  });
  return { levels, warnings };
}

/**
 * Structural verification of a generated GLB: re-parse, index bounds, POSITION
 * min/max presence, no non-finite float values. Used by `--verify` and tests.
 */
export function verifyLodGlb(fileName: string, glb: Uint8Array): LodVerificationIssue[] {
  const issues: LodVerificationIssue[] = [];
  try {
    const view = glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer;
    const gltf = GltfBinaryParser.parseGlb(view);
    const json = gltf.json;
    const accessors = json.accessors ?? [];
    const meshes = json.meshes ?? [];
    if (meshes.length === 0) {
      issues.push({ file: fileName, message: "empty meshes" });
      return issues;
    }
    for (const mesh of meshes) {
      for (const prim of mesh.primitives) {
        const idxAccessor = accessors[prim.indices ?? -1];
        const indices = GltfBinaryParser.getBufferData(
          idxAccessor,
          json,
          gltf.buffers,
        ) as Uint32Array | null;
        const posAccessor =
          prim.attributes["POSITION"] !== undefined
            ? accessors[prim.attributes["POSITION"]]
            : undefined;
        const positions = GltfBinaryParser.getBufferData(
          posAccessor,
          json,
          gltf.buffers,
        ) as Float32Array | null;
        if (indices === null || positions === null || positions.length === 0) {
          issues.push({ file: fileName, message: "primitive missing indices/POSITION" });
          continue;
        }
        for (const i of indices) {
          if (i >= positions.length / 3) {
            issues.push({
              file: fileName,
              message: `index ${i} out of range (${positions.length / 3} verts)`,
            });
            break;
          }
        }
        if (posAccessor?.min === undefined || posAccessor?.max === undefined) {
          issues.push({ file: fileName, message: "POSITION accessor missing min/max" });
        }
        for (let i = 0; i < positions.length; i++) {
          if (!Number.isFinite(positions[i])) {
            issues.push({ file: fileName, message: `non-finite POSITION at ${i}` });
            break;
          }
        }
      }
    }
  } catch (error) {
    issues.push({
      file: fileName,
      message: `unparseable GLB: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  return issues;
}
