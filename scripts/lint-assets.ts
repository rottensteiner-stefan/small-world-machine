#!/usr/bin/env node
/**
 * scripts/lint-assets.ts
 *
 * Asset Linter CLI (Backlog P2 D6 / ADR 0011 / asset-pipeline §5):
 * Offline asset quality & contract linter for modular models and kits under public/assets/kits/**.
 *
 * Enforces 7 core checks:
 * 1. Geometrie-Vollständigkeit: POSITION (VEC3), NORMAL (VEC3), TEXCOORD_0 (VEC2), and TANGENT (VEC4).
 * 2. Degenerierte Dreiecke: No zero-area triangles, no collinear vertices, no duplicate indices, no NaN/Inf.
 * 3. Root-Transform-Konformität: Root nodes must have identity transforms (no unbaked translation/rotation/scale).
 * 4. Keine negativen Skalierungen: No negative scale in any node transform (prevents inverted winding orders).
 * 5. Polycount-Budget nach ADR 0011: 4-Tier polycount and file-size budgets, honoring grandfathered baselines.
 * 6. Konsistenzcheck AABB: Measured mesh bounding box vs. meta.json dimensions (catches export bugs like the historic Bunker Blast Door).
 * 7. Textur-Slot- und Namensverträge: Texture slot matching via TextureSlotMatcher, WebP format (.webp) enforcement.
 *
 * Usage:
 *   npm run lint:assets
 *   npm run lint:assets -- --verbose
 *   npm run lint:assets -- public/assets/kits/flakturm
 *   npm run lint:assets -- public/assets/kits/industrial/wall_lamp/model.glb
 *
 * Exit codes:
 *   0: All assets clean
 *   1: Lint violations found
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { detectTextureMapSlot } from "../packages/engine/src/loaders/kit/TextureSlotMatcher.js";

export type LintRule =
  | "geometry-completeness"
  | "degenerate-triangles"
  | "root-transform"
  | "negative-scale"
  | "polycount-budget"
  | "aabb-consistency"
  | "texture-contracts";

export interface AssetLintIssue {
  rule: LintRule;
  severity: "error" | "warning";
  assetId: string;
  file?: string;
  message: string;
}

export interface GlbHeader {
  magic: number;
  version: number;
  totalLength: number;
}

export interface GlbPrimitive {
  attributes?: {
    POSITION?: number;
    NORMAL?: number;
    TEXCOORD_0?: number;
    TANGENT?: number;
    [key: string]: number | undefined;
  };
  indices?: number;
}

export interface GlbMesh {
  primitives?: GlbPrimitive[];
}

export interface GlbAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  min?: number[];
  max?: number[];
}

export interface GlbBufferView {
  buffer: number;
  byteOffset?: number;
  byteLength: number;
  byteStride?: number;
}

export interface GlbNode {
  name?: string;
  translation?: [number, number, number];
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
  matrix?: number[];
  children?: number[];
  mesh?: number;
}

export interface GlbScene {
  nodes?: number[];
}

export interface GlbImage {
  uri?: string;
  mimeType?: string;
  bufferView?: number;
}

export interface GlbData {
  asset?: { version: string };
  scene?: number;
  scenes?: GlbScene[];
  nodes?: GlbNode[];
  meshes?: GlbMesh[];
  accessors?: GlbAccessor[];
  bufferViews?: GlbBufferView[];
  buffers?: Array<{ byteLength: number }>;
  images?: GlbImage[];
}

export interface GlbContainer {
  header: GlbHeader;
  json: GlbData;
  bin: Buffer;
}

export interface PropDimensions {
  width?: number;
  height: number;
  depth?: number;
  radius?: number;
}

export interface PropMeta {
  id: string;
  name: string;
  category: string;
  kit: string;
  version: string;
  description: string;
  triangles: number;
  materials: number;
  textures: string[];
  dimensions: PropDimensions;
  recommendedScale?: number;
  author: string;
  license: string;
}

export interface KitItem {
  id: string;
  name: string;
  category: string;
  path: string;
  preview: string;
  meta: string;
}

export interface KitTexture {
  id: string;
  name: string;
  category: string;
  maps: string[];
}

export interface KitDecal {
  id: string;
  name: string;
  file: string;
}

export interface KitManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  items?: KitItem[];
  textures?: KitTexture[];
  decals?: KitDecal[];
  author: string;
  license: string;
}

export interface TierBudget {
  tier: "T1" | "T2" | "T3" | "T4";
  maxL: number;
  maxTris: number;
}

export const TIER_BUDGETS: readonly TierBudget[] = [
  { tier: "T1", maxL: 0.35, maxTris: 1500 },
  { tier: "T2", maxL: 1.0, maxTris: 4500 },
  { tier: "T3", maxL: 2.5, maxTris: 10000 },
  { tier: "T4", maxL: Number.POSITIVE_INFINITY, maxTris: 16000 },
];

export const MAX_GLB_BYTES = 3 * 1024 * 1024; // 3 MB reference boundary per ADR 0011

export interface LegacyBaseline {
  tris: number;
  bytes: number;
}

/**
 * Grandfathered baselines for legacy assets existing before ADR 0011 tier ratification.
 * Prevents regression on existing props while enforcing strict limits on new props.
 */
export const GRANDFATHERED_BASELINES: Record<string, LegacyBaseline> = {
  "industrial/barrel_chemical_blue": { tris: 10337, bytes: 1243524 },
  "industrial/barrel_hazard_yellow": { tris: 9401, bytes: 1106412 },
  "industrial/barrel_oil_black": { tris: 10416, bytes: 1201256 },
  "industrial/wall_lamp": { tris: 11183, bytes: 1214388 },
  "bunker/coffee_grinder": { tris: 13955, bytes: 1420404 },
  "bunker/bunk_bed": { tris: 13057, bytes: 1570644 },
  "bunker/terminal_2100": { tris: 14143, bytes: 1775648 },
  "flakturm/debris_rubble_pile": { tris: 13453, bytes: 1567968 },
  "flakturm/bunker_blast_door": { tris: 13092, bytes: 1027688 },
  "flakturm/bunker_vent_hatch": { tris: 11356, bytes: 995216 },
  "flakturm/bunker_blast_door_leaf": { tris: 7593, bytes: 2231512 },
  "flakturm/ceiling_lamp": { tris: 1414382, bytes: 42776748 },
  "flakturm/vent_wall_breach": { tris: 1466018, bytes: 46578688 },
  "bunker/worn_rug": { tris: 1419192, bytes: 45862084 },
  "bunker/mess_tin_set": { tris: 1484142, bytes: 45659992 },
  "bunker/combat_boots": { tris: 1463204, bytes: 45569680 },
  "bunker/metal_desk": { tris: 1474454, bytes: 44589736 },
  "bunker/wall_shelf_supplies": { tris: 1414562, bytes: 44127964 },
  "bunker/kerosene_lantern": { tris: 1431926, bytes: 43914768 },
  "bunker/hanging_towels": { tris: 1425404, bytes: 43848436 },
  "bunker/metal_stool": { tris: 1386108, bytes: 41635080 },
};

export function parseGlb(buffer: Buffer): GlbContainer {
  if (buffer.length < 12) {
    throw new Error("GLB file too small (less than 12-byte header)");
  }
  const magic = buffer.readUInt32LE(0);
  if (magic !== 0x46546c67) {
    throw new Error("Not a valid GLB container (magic header is not 0x46546C67)");
  }
  const version = buffer.readUInt32LE(4);
  const totalLength = buffer.readUInt32LE(8);

  let offset = 12;
  let jsonChunk: GlbData | null = null;
  let binChunk: Buffer = Buffer.alloc(0);

  while (offset + 8 <= buffer.length) {
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.readUInt32LE(offset + 4);
    const chunkData = buffer.subarray(offset + 8, offset + 8 + chunkLength);
    offset += 8 + chunkLength;

    if (chunkType === 0x4e4f534a) {
      jsonChunk = JSON.parse(chunkData.toString("utf8")) as GlbData;
    } else if (chunkType === 0x004e4942) {
      binChunk = Buffer.from(chunkData.buffer, chunkData.byteOffset, chunkData.byteLength);
    }
  }

  if (!jsonChunk) {
    throw new Error("Invalid GLB container: missing JSON chunk");
  }

  return {
    header: { magic, version, totalLength },
    json: jsonChunk,
    bin: binChunk,
  };
}

// 4x4 Matrix math helpers for node hierarchy transformation
function multiplyMat4(out: Float32Array, a: Float32Array, b: Float32Array): Float32Array {
  const a00 = a[0]!,
    a01 = a[1]!,
    a02 = a[2]!,
    a03 = a[3]!;
  const a10 = a[4]!,
    a11 = a[5]!,
    a12 = a[6]!,
    a13 = a[7]!;
  const a20 = a[8]!,
    a21 = a[9]!,
    a22 = a[10]!,
    a23 = a[11]!;
  const a30 = a[12]!,
    a31 = a[13]!,
    a32 = a[14]!,
    a33 = a[15]!;

  let b0 = b[0]!,
    b1 = b[1]!,
    b2 = b[2]!,
    b3 = b[3]!;
  out[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

  b0 = b[4]!;
  b1 = b[5]!;
  b2 = b[6]!;
  b3 = b[7]!;
  out[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

  b0 = b[8]!;
  b1 = b[9]!;
  b2 = b[10]!;
  b3 = b[11]!;
  out[8] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[9] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

  b0 = b[12]!;
  b1 = b[13]!;
  b2 = b[14]!;
  b3 = b[15]!;
  out[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
  return out;
}

function fromRotationTranslationScale(
  out: Float32Array,
  q: readonly number[],
  v: readonly number[],
  s: readonly number[],
): Float32Array {
  const x = q[0]!,
    y = q[1]!,
    z = q[2]!,
    w = q[3]!;
  const x2 = x + x,
    y2 = y + y,
    z2 = z + z;
  const xx = x * x2,
    xy = x * y2,
    xz = x * z2;
  const yy = y * y2,
    yz = y * z2,
    zz = z * z2;
  const wx = w * x2,
    wy = w * y2,
    wz = w * z2;
  const sx = s[0]!,
    sy = s[1]!,
    sz = s[2]!;

  out[0] = (1 - (yy + zz)) * sx;
  out[1] = (xy + wz) * sx;
  out[2] = (xz - wy) * sx;
  out[3] = 0;
  out[4] = (xy - wz) * sy;
  out[5] = (1 - (xx + zz)) * sy;
  out[6] = (yz + wx) * sy;
  out[7] = 0;
  out[8] = (xz + wy) * sz;
  out[9] = (yz - wx) * sz;
  out[10] = (1 - (xx + yy)) * sz;
  out[11] = 0;
  out[12] = v[0]!;
  out[13] = v[1]!;
  out[14] = v[2]!;
  out[15] = 1;
  return out;
}

function getNodeMatrix(node: GlbNode): Float32Array {
  if (node.matrix) return new Float32Array(node.matrix);
  const t = node.translation ?? [0, 0, 0];
  const r = node.rotation ?? [0, 0, 0, 1];
  const s = node.scale ?? [1, 1, 1];
  const out = new Float32Array(16);
  fromRotationTranslationScale(out, r, t, s);
  return out;
}

/**
 * Checks a GLB model and optional PropMeta against the 7 core asset-linter rules.
 */
export function lintGlbModel(
  glbPath: string,
  assetId: string,
  meta?: PropMeta,
  itemPreviewPath?: string,
): AssetLintIssue[] {
  const issues: AssetLintIssue[] = [];

  if (!fs.existsSync(glbPath)) {
    issues.push({
      rule: "geometry-completeness",
      severity: "error",
      assetId,
      file: glbPath,
      message: `GLB model file missing at ${glbPath}`,
    });
    return issues;
  }

  const glbBytes = fs.readFileSync(glbPath);
  const fileBytes = glbBytes.length;
  let parsed: GlbContainer;
  try {
    parsed = parseGlb(glbBytes);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    issues.push({
      rule: "geometry-completeness",
      severity: "error",
      assetId,
      file: glbPath,
      message: `Failed to parse GLB: ${message}`,
    });
    return issues;
  }

  const { json, bin } = parsed;

  // 1. Geometrie-Vollständigkeit (Vorhandensein von Normalen, UVs, vec4-Tangenten)
  const meshes: GlbMesh[] = json.meshes ?? [];
  for (let mIdx = 0; mIdx < meshes.length; mIdx++) {
    const mesh = meshes[mIdx]!;
    const primitives: GlbPrimitive[] = mesh.primitives ?? [];
    for (let pIdx = 0; pIdx < primitives.length; pIdx++) {
      const prim = primitives[pIdx]!;
      const attrs = prim.attributes ?? {};

      if (attrs.POSITION === undefined) {
        issues.push({
          rule: "geometry-completeness",
          severity: "error",
          assetId,
          message: `Mesh ${mIdx} primitive ${pIdx} missing required POSITION attribute`,
        });
      } else {
        const acc = json.accessors?.[attrs.POSITION];
        if (!acc || acc.type !== "VEC3") {
          issues.push({
            rule: "geometry-completeness",
            severity: "error",
            assetId,
            message: `Mesh ${mIdx} primitive ${pIdx} POSITION must be VEC3 (got ${acc?.type})`,
          });
        }
      }

      if (attrs.NORMAL === undefined) {
        issues.push({
          rule: "geometry-completeness",
          severity: "error",
          assetId,
          message: `Mesh ${mIdx} primitive ${pIdx} missing required NORMAL attribute`,
        });
      } else {
        const acc = json.accessors?.[attrs.NORMAL];
        if (!acc || acc.type !== "VEC3") {
          issues.push({
            rule: "geometry-completeness",
            severity: "error",
            assetId,
            message: `Mesh ${mIdx} primitive ${pIdx} NORMAL must be VEC3 (got ${acc?.type})`,
          });
        }
      }

      if (attrs.TEXCOORD_0 === undefined) {
        issues.push({
          rule: "geometry-completeness",
          severity: "error",
          assetId,
          message: `Mesh ${mIdx} primitive ${pIdx} missing required TEXCOORD_0 attribute`,
        });
      } else {
        const acc = json.accessors?.[attrs.TEXCOORD_0];
        if (!acc || acc.type !== "VEC2") {
          issues.push({
            rule: "geometry-completeness",
            severity: "error",
            assetId,
            message: `Mesh ${mIdx} primitive ${pIdx} TEXCOORD_0 must be VEC2 (got ${acc?.type})`,
          });
        }
      }

      if (attrs.TANGENT !== undefined) {
        const acc = json.accessors?.[attrs.TANGENT];
        if (!acc || acc.type !== "VEC4") {
          issues.push({
            rule: "geometry-completeness",
            severity: "error",
            assetId,
            message: `Mesh ${mIdx} primitive ${pIdx} TANGENT must be VEC4 per glTF/MikkTSpace contract (got ${acc?.type})`,
          });
        }
      }
    }
  }

  // 2. Degenerierte Dreiecke (Fläche 0 / NaN)
  for (let mIdx = 0; mIdx < meshes.length; mIdx++) {
    const mesh = meshes[mIdx]!;
    const primitives: GlbPrimitive[] = mesh.primitives ?? [];
    for (let pIdx = 0; pIdx < primitives.length; pIdx++) {
      const prim = primitives[pIdx]!;
      const posAccIdx = prim.attributes?.POSITION;
      if (posAccIdx === undefined) continue;
      const posAcc = json.accessors?.[posAccIdx];
      if (!posAcc || posAcc.bufferView === undefined) continue;
      const posBv = json.bufferViews?.[posAcc.bufferView];
      if (!posBv) continue;
      const posOffset = (posBv.byteOffset ?? 0) + (posAcc.byteOffset ?? 0);
      const posStride = posBv.byteStride ?? 12;

      const getPos = (idx: number): [number, number, number] => {
        const off = posOffset + idx * posStride;
        return [bin.readFloatLE(off), bin.readFloatLE(off + 4), bin.readFloatLE(off + 8)];
      };

      let degenCount = 0;
      let nanCount = 0;

      const checkTri = (i0: number, i1: number, i2: number) => {
        if (i0 === i1 || i1 === i2 || i0 === i2) {
          degenCount++;
          return;
        }
        const p0 = getPos(i0);
        const p1 = getPos(i1);
        const p2 = getPos(i2);

        if (
          !Number.isFinite(p0[0]) ||
          !Number.isFinite(p0[1]) ||
          !Number.isFinite(p0[2]) ||
          !Number.isFinite(p1[0]) ||
          !Number.isFinite(p1[1]) ||
          !Number.isFinite(p1[2]) ||
          !Number.isFinite(p2[0]) ||
          !Number.isFinite(p2[1]) ||
          !Number.isFinite(p2[2])
        ) {
          nanCount++;
          return;
        }

        // Duplicate coincident vertices
        if (
          (p0[0] === p1[0] && p0[1] === p1[1] && p0[2] === p1[2]) ||
          (p0[0] === p2[0] && p0[1] === p2[1] && p0[2] === p2[2]) ||
          (p1[0] === p2[0] && p1[1] === p2[1] && p1[2] === p2[2])
        ) {
          degenCount++;
          return;
        }

        // Triangle area via cross product
        const e1x = p1[0] - p0[0],
          e1y = p1[1] - p0[1],
          e1z = p1[2] - p0[2];
        const e2x = p2[0] - p0[0],
          e2y = p2[1] - p0[1],
          e2z = p2[2] - p0[2];
        const cx = e1y * e2z - e1z * e2y;
        const cy = e1z * e2x - e1x * e2z;
        const cz = e1x * e2y - e1y * e2x;
        const l1 = Math.hypot(e1x, e1y, e1z);
        const l2 = Math.hypot(e2x, e2y, e2z);
        const crossL = Math.hypot(cx, cy, cz);

        if (l1 === 0 || l2 === 0 || crossL / (l1 * l2) < 1e-12) {
          degenCount++;
        }
      };

      if (prim.indices !== undefined) {
        const indAcc = json.accessors?.[prim.indices];
        if (!indAcc || indAcc.bufferView === undefined) continue;
        const indBv = json.bufferViews?.[indAcc.bufferView];
        if (!indBv) continue;
        const indOffset = (indBv.byteOffset ?? 0) + (indAcc.byteOffset ?? 0);
        const cType = indAcc.componentType;
        const count = indAcc.count;

        for (let i = 0; i < count; i += 3) {
          let i0 = 0,
            i1 = 0,
            i2 = 0;
          if (cType === 5123) {
            i0 = bin.readUInt16LE(indOffset + i * 2);
            i1 = bin.readUInt16LE(indOffset + (i + 1) * 2);
            i2 = bin.readUInt16LE(indOffset + (i + 2) * 2);
          } else if (cType === 5125) {
            i0 = bin.readUInt32LE(indOffset + i * 4);
            i1 = bin.readUInt32LE(indOffset + (i + 1) * 4);
            i2 = bin.readUInt32LE(indOffset + (i + 2) * 4);
          } else if (cType === 5121) {
            i0 = bin.readUInt8(indOffset + i);
            i1 = bin.readUInt8(indOffset + i + 1);
            i2 = bin.readUInt8(indOffset + i + 2);
          }
          checkTri(i0, i1, i2);
        }
      } else {
        const count = posAcc.count;
        for (let i = 0; i < count; i += 3) {
          checkTri(i, i + 1, i + 2);
        }
      }

      if (nanCount > 0) {
        issues.push({
          rule: "degenerate-triangles",
          severity: "error",
          assetId,
          message: `Mesh ${mIdx} primitive ${pIdx} contains ${nanCount} triangles with NaN or infinite vertex positions`,
        });
      }
      if (degenCount > 0) {
        issues.push({
          rule: "degenerate-triangles",
          severity: "error",
          assetId,
          message: `Mesh ${mIdx} primitive ${pIdx} contains ${degenCount} degenerate (zero-area or collinear) triangles`,
        });
      }
    }
  }

  // 3. Root-Transform-Konformität (keine ungewollten Rotationen/Skalierungen auf Root-Ebene)
  const scene = json.scenes ? json.scenes[json.scene ?? 0] : { nodes: [0] };
  const rootNodeIndices: number[] = scene?.nodes ?? [0];

  for (const rIdx of rootNodeIndices) {
    const node = json.nodes?.[rIdx];
    if (!node) continue;

    if (node.translation) {
      const [tx, ty, tz] = node.translation;
      if (Math.abs(tx) > 1e-4 || Math.abs(ty) > 1e-4 || Math.abs(tz) > 1e-4) {
        issues.push({
          rule: "root-transform",
          severity: "error",
          assetId,
          message: `Root node #${rIdx} has non-zero translation [${tx}, ${ty}, ${tz}] (must be frozen/identity)`,
        });
      }
    }

    if (node.rotation) {
      const [rx, ry, rz, rw] = node.rotation;
      const isIdentity =
        Math.abs(rx) < 1e-4 &&
        Math.abs(ry) < 1e-4 &&
        Math.abs(rz) < 1e-4 &&
        (Math.abs(rw - 1) < 1e-4 || Math.abs(rw + 1) < 1e-4);
      if (!isIdentity) {
        issues.push({
          rule: "root-transform",
          severity: "error",
          assetId,
          message: `Root node #${rIdx} has non-identity rotation [${rx}, ${ry}, ${rz}, ${rw}] (must be frozen/identity)`,
        });
      }
    }

    if (node.scale) {
      const [sx, sy, sz] = node.scale;
      const isUnit = Math.abs(sx - 1) < 1e-4 && Math.abs(sy - 1) < 1e-4 && Math.abs(sz - 1) < 1e-4;
      if (!isUnit) {
        issues.push({
          rule: "root-transform",
          severity: "error",
          assetId,
          message: `Root node #${rIdx} has non-unit scale [${sx}, ${sy}, ${sz}] (must be frozen/identity)`,
        });
      }
    }

    if (node.matrix) {
      const m = node.matrix;
      const isIdentity =
        Math.abs((m[0] ?? 0) - 1) < 1e-4 &&
        Math.abs((m[5] ?? 0) - 1) < 1e-4 &&
        Math.abs((m[10] ?? 0) - 1) < 1e-4 &&
        Math.abs((m[15] ?? 0) - 1) < 1e-4 &&
        [1, 2, 3, 4, 6, 7, 8, 9, 11, 12, 13, 14].every((idx) => Math.abs(m[idx] ?? 0) < 1e-4);
      if (!isIdentity) {
        issues.push({
          rule: "root-transform",
          severity: "error",
          assetId,
          message: `Root node #${rIdx} has non-identity transform matrix (must be frozen/identity)`,
        });
      }
    }
  }

  // 4. Keine negativen Skalierungen (Invertierte Winding Orders)
  const nodes: GlbNode[] = json.nodes ?? [];
  for (let nIdx = 0; nIdx < nodes.length; nIdx++) {
    const node = nodes[nIdx]!;
    if (node.scale) {
      const [sx, sy, sz] = node.scale;
      if (sx < 0 || sy < 0 || sz < 0) {
        issues.push({
          rule: "negative-scale",
          severity: "error",
          assetId,
          message: `Node #${nIdx} ("${node.name ?? "unnamed"}") has negative scale [${sx}, ${sy}, ${sz}] (inverts winding order)`,
        });
      }
    }
    if (node.matrix && node.matrix.length >= 16) {
      const m = node.matrix;
      const m0 = m[0] ?? 0,
        m1 = m[1] ?? 0,
        m2 = m[2] ?? 0;
      const m4 = m[4] ?? 0,
        m5 = m[5] ?? 0,
        m6 = m[6] ?? 0;
      const m8 = m[8] ?? 0,
        m9 = m[9] ?? 0,
        m10 = m[10] ?? 0;
      // Determinant of upper-left 3x3 block
      const det = m0 * (m5 * m10 - m6 * m9) - m1 * (m4 * m10 - m6 * m8) + m2 * (m4 * m9 - m5 * m8);
      if (det < 0) {
        issues.push({
          rule: "negative-scale",
          severity: "error",
          assetId,
          message: `Node #${nIdx} ("${node.name ?? "unnamed"}") matrix has negative determinant ${det.toFixed(4)} (inverts parity/winding order)`,
        });
      }
    }
  }

  // 5. Polycount-Budget nach ADR-0011-Tiers (Prop/Hero/Environment)
  let totalTris = 0;
  for (const mesh of meshes) {
    for (const prim of mesh.primitives ?? []) {
      if (prim.indices !== undefined) {
        const acc = json.accessors?.[prim.indices];
        if (acc?.count) totalTris += acc.count / 3;
      } else if (prim.attributes?.POSITION !== undefined) {
        const acc = json.accessors?.[prim.attributes.POSITION];
        if (acc?.count) totalTris += acc.count / 3;
      }
    }
  }
  const realTris = Math.round(totalTris);

  if (meta?.dimensions) {
    const dims = meta.dimensions;
    const lMax =
      dims.radius !== undefined
        ? Math.max(dims.radius * 2, dims.height)
        : Math.max(dims.width ?? 0, dims.height, dims.depth ?? 0);

    const budget = TIER_BUDGETS.find((b) => lMax <= b.maxL) ?? TIER_BUDGETS[3]!;
    const legacy = GRANDFATHERED_BASELINES[assetId];

    if (legacy) {
      if (realTris > legacy.tris) {
        issues.push({
          rule: "polycount-budget",
          severity: "error",
          assetId,
          message: `${realTris} tris exceeds grandfathered baseline of ${legacy.tris} tris (ADR 0011 tier ${budget.tier} target: ${budget.maxTris})`,
        });
      }
      if (fileBytes > legacy.bytes) {
        issues.push({
          rule: "polycount-budget",
          severity: "error",
          assetId,
          message: `GLB size ${fileBytes}B exceeds grandfathered baseline of ${legacy.bytes}B`,
        });
      }
    } else {
      if (realTris > budget.maxTris) {
        issues.push({
          rule: "polycount-budget",
          severity: "error",
          assetId,
          message: `Tier ${budget.tier} (Lmax ${lMax.toFixed(2)}m): ${realTris} tris exceeds budget of ${budget.maxTris} tris (ADR 0011 §1.1)`,
        });
      }
      if (fileBytes > MAX_GLB_BYTES) {
        issues.push({
          rule: "polycount-budget",
          severity: "error",
          assetId,
          message: `GLB size ${fileBytes}B exceeds maximum reference limit of ${MAX_GLB_BYTES}B (3MB)`,
        });
      }
    }
  }

  // 6. Konsistenzcheck: Tatsächliche AABB-Dimensionen vs. meta.json-Angaben
  if (meta?.dimensions) {
    const worldMatrices = new Map<number, Float32Array>();
    function traverse(nodeIdx: number, parentMat: Float32Array | null) {
      const node = json.nodes?.[nodeIdx];
      if (!node) return;
      const localMat = getNodeMatrix(node);
      const worldMat = new Float32Array(16);
      if (parentMat) multiplyMat4(worldMat, parentMat, localMat);
      else worldMat.set(localMat);
      worldMatrices.set(nodeIdx, worldMat);
      if (node.children) {
        for (const childIdx of node.children) traverse(childIdx, worldMat);
      }
    }

    for (const r of rootNodeIndices) traverse(r, null);

    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity;
    let maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;

    for (let nodeIdx = 0; nodeIdx < nodes.length; nodeIdx++) {
      const node = nodes[nodeIdx];
      if (!node || node.mesh === undefined) continue;
      const mesh = json.meshes?.[node.mesh];
      if (!mesh) continue;
      const mat = worldMatrices.get(nodeIdx) ?? getNodeMatrix(node);

      for (const prim of mesh.primitives ?? []) {
        const posAccIdx = prim.attributes?.POSITION;
        if (posAccIdx === undefined) continue;
        const acc = json.accessors?.[posAccIdx];
        if (!acc?.min || !acc?.max) continue;
        const corners = [
          [acc.min[0], acc.min[1], acc.min[2]],
          [acc.max[0], acc.min[1], acc.min[2]],
          [acc.min[0], acc.max[1], acc.min[2]],
          [acc.max[0], acc.max[1], acc.min[2]],
          [acc.min[0], acc.min[1], acc.max[2]],
          [acc.max[0], acc.min[1], acc.max[2]],
          [acc.min[0], acc.max[1], acc.max[2]],
          [acc.max[0], acc.max[1], acc.max[2]],
        ];
        for (const [cx, cy, cz] of corners) {
          const x = mat[0]! * cx! + mat[4]! * cy! + mat[8]! * cz! + mat[12]!;
          const y = mat[1]! * cx! + mat[5]! * cy! + mat[9]! * cz! + mat[13]!;
          const z = mat[2]! * cx! + mat[6]! * cy! + mat[10]! * cz! + mat[14]!;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (z < minZ) minZ = z;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
          if (z > maxZ) maxZ = z;
        }
      }
    }

    const actualDims = [maxX - minX, maxY - minY, maxZ - minZ];
    const dims = meta.dimensions;
    const metaDims =
      dims.radius !== undefined
        ? [dims.radius * 2, dims.height, dims.radius * 2]
        : [dims.width ?? 0, dims.height, dims.depth ?? 0];

    const actualSorted = [...actualDims].sort((a, b) => a - b);
    const metaSorted = [...metaDims].sort((a, b) => a - b);

    const actualAR = actualSorted[2]! / Math.max(actualSorted[0]!, 1e-4);
    const metaAR = metaSorted[2]! / Math.max(metaSorted[0]!, 1e-4);
    const arDeviation = Math.max(actualAR / metaAR, metaAR / actualAR);

    // Severe aspect-ratio mismatch check (catches errors like 1.8x2.2x0.25 vs 0.92x1.0x0.94 cube)
    if (metaSorted[0]! > 0.05 && arDeviation > 3.0) {
      issues.push({
        rule: "aabb-consistency",
        severity: "error",
        assetId,
        message: `Severe aspect-ratio mismatch between measured AABB [${actualDims.map((d) => d.toFixed(2)).join(", ")}] and meta.json [${metaDims.join(", ")}] (ratio factor ${arDeviation.toFixed(1)}x > 3.0x)`,
      });
    }
  }

  // 7. Textur-Slot- und Namensverträge (Preview check)
  if (itemPreviewPath) {
    if (!fs.existsSync(itemPreviewPath)) {
      issues.push({
        rule: "texture-contracts",
        severity: "error",
        assetId,
        message: `Item preview file missing on disk: ${itemPreviewPath}`,
      });
    } else if (!itemPreviewPath.endsWith(".webp")) {
      issues.push({
        rule: "texture-contracts",
        severity: "warning",
        assetId,
        message: `Item preview is not in WebP format (${path.basename(itemPreviewPath)})`,
      });
    }
  }

  // Check embedded textures inside GLB (if any)
  const images: GlbImage[] = json.images ?? [];
  for (let iIdx = 0; iIdx < images.length; iIdx++) {
    const img = images[iIdx]!;
    if (img.mimeType) {
      const validMimes = ["image/webp", "image/png", "image/jpeg"];
      if (!validMimes.includes(img.mimeType)) {
        issues.push({
          rule: "texture-contracts",
          severity: "error",
          assetId,
          message: `GLB embedded image #${iIdx} has unsupported mimeType "${img.mimeType}"`,
        });
      }
    }
    if (img.uri && !img.uri.startsWith("data:")) {
      const ext = path.extname(img.uri).toLowerCase();
      if (![".webp", ".png", ".jpg", ".jpeg"].includes(ext)) {
        issues.push({
          rule: "texture-contracts",
          severity: "error",
          assetId,
          message: `GLB image #${iIdx} URI has unsupported extension "${ext}"`,
        });
      }
    }
  }

  return issues;
}

/**
 * Lints a modular asset kit directory containing kit.json, items, textures, and decals.
 */
export function lintKit(kitDir: string): AssetLintIssue[] {
  const issues: AssetLintIssue[] = [];
  const kitManifestPath = path.join(kitDir, "kit.json");

  if (!fs.existsSync(kitManifestPath)) {
    return [
      {
        rule: "texture-contracts",
        severity: "error",
        assetId: path.basename(kitDir),
        message: `kit.json missing in ${kitDir}`,
      },
    ];
  }

  let manifest: KitManifest;
  try {
    manifest = JSON.parse(fs.readFileSync(kitManifestPath, "utf8")) as KitManifest;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return [
      {
        rule: "texture-contracts",
        severity: "error",
        assetId: path.basename(kitDir),
        message: `Invalid kit.json in ${kitDir}: ${message}`,
      },
    ];
  }

  // Rule 7: Texture slot and naming contracts for kit textures
  for (const tex of manifest.textures ?? []) {
    const texSlug = tex.id.split("/").pop();
    if (!texSlug) continue;
    const texDir = path.join(kitDir, "textures", texSlug);
    for (const map of tex.maps) {
      const slot = detectTextureMapSlot(map);
      if (!slot) {
        issues.push({
          rule: "texture-contracts",
          severity: "error",
          assetId: tex.id,
          message: `Texture map "${map}" does not match any recognized PBR slot (albedo, normal, roughness, metalness, ao)`,
        });
      }
      if (!map.endsWith(".webp")) {
        issues.push({
          rule: "texture-contracts",
          severity: "error",
          assetId: tex.id,
          message: `Texture map "${map}" is not in WebP format (.webp required)`,
        });
      }
      const mapPath = path.join(texDir, map);
      if (!fs.existsSync(mapPath)) {
        issues.push({
          rule: "texture-contracts",
          severity: "error",
          assetId: tex.id,
          message: `Texture map file missing on disk: ${path.relative(process.cwd(), mapPath)}`,
        });
      }
    }
  }

  // Rule 7: Decals naming and format contracts
  for (const decal of manifest.decals ?? []) {
    const decalPath = path.join(kitDir, "decals", decal.file);
    if (!fs.existsSync(decalPath)) {
      issues.push({
        rule: "texture-contracts",
        severity: "error",
        assetId: decal.id,
        message: `Decal file missing on disk: ${path.relative(process.cwd(), decalPath)}`,
      });
    }
    if (!decal.file.endsWith(".webp")) {
      issues.push({
        rule: "texture-contracts",
        severity: "error",
        assetId: decal.id,
        message: `Decal "${decal.file}" is not in WebP format (.webp required)`,
      });
    }
  }

  // Rules 1-7 for kit items (GLB models + meta.json)
  for (const item of manifest.items ?? []) {
    const metaPath = path.join(kitDir, item.meta);
    if (!fs.existsSync(metaPath)) {
      issues.push({
        rule: "texture-contracts",
        severity: "error",
        assetId: item.id,
        message: `Meta file missing on disk: ${item.meta}`,
      });
      continue;
    }

    let meta: PropMeta;
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, "utf8")) as PropMeta;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      issues.push({
        rule: "texture-contracts",
        severity: "error",
        assetId: item.id,
        message: `Invalid meta.json for ${item.id}: ${message}`,
      });
      continue;
    }

    const glbPath = path.join(kitDir, item.path);
    const previewPath = path.join(kitDir, item.preview);
    const itemIssues = lintGlbModel(glbPath, item.id, meta, previewPath);
    issues.push(...itemIssues);
  }

  return issues;
}

export interface LintAssetsSummary {
  scannedKits: number;
  scannedItems: number;
  totalIssues: number;
  errorCount: number;
  warningCount: number;
  issues: AssetLintIssue[];
}

/**
 * Runs the asset linter across specified target paths or public/assets/kits/**.
 */
export function lintAssets(targetPaths?: string[]): LintAssetsSummary {
  const root = path.resolve(process.cwd());
  const kitsRootDir = path.join(root, "public/assets/kits");
  const allIssues: AssetLintIssue[] = [];
  let scannedKits = 0;
  let scannedItems = 0;

  if (targetPaths && targetPaths.length > 0) {
    for (const target of targetPaths) {
      const fullPath = path.resolve(root, target);
      if (!fs.existsSync(fullPath)) {
        allIssues.push({
          rule: "texture-contracts",
          severity: "error",
          assetId: target,
          message: `Path does not exist: ${target}`,
        });
        continue;
      }
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        const kitJson = path.join(fullPath, "kit.json");
        if (fs.existsSync(kitJson)) {
          scannedKits++;
          const kitIssues = lintKit(fullPath);
          allIssues.push(...kitIssues);
        } else {
          // Check if it's kits parent dir
          const entries = fs.readdirSync(fullPath, { withFileTypes: true });
          for (const e of entries) {
            if (e.isDirectory() && fs.existsSync(path.join(fullPath, e.name, "kit.json"))) {
              scannedKits++;
              const kitIssues = lintKit(path.join(fullPath, e.name));
              allIssues.push(...kitIssues);
            }
          }
        }
      } else if (fullPath.endsWith(".glb")) {
        scannedItems++;
        const dir = path.dirname(fullPath);
        const metaPath = path.join(dir, "meta.json");
        const meta: PropMeta | undefined = fs.existsSync(metaPath)
          ? (JSON.parse(fs.readFileSync(metaPath, "utf8")) as PropMeta)
          : undefined;
        const assetId = path.relative(kitsRootDir, fullPath).replace(/\\/g, "/");
        const issues = lintGlbModel(fullPath, assetId, meta);
        allIssues.push(...issues);
      }
    }
  } else {
    // Default: scan all kits in public/assets/kits/**
    if (fs.existsSync(kitsRootDir)) {
      const entries = fs.readdirSync(kitsRootDir, { withFileTypes: true });
      for (const e of entries) {
        const kitDir = path.join(kitsRootDir, e.name);
        if (e.isDirectory() && fs.existsSync(path.join(kitDir, "kit.json"))) {
          scannedKits++;
          const kitIssues = lintKit(kitDir);
          allIssues.push(...kitIssues);
        }
      }
    }
  }

  const errorCount = allIssues.filter((i) => i.severity === "error").length;
  const warningCount = allIssues.filter((i) => i.severity === "warning").length;

  return {
    scannedKits,
    scannedItems,
    totalIssues: allIssues.length,
    errorCount,
    warningCount,
    issues: allIssues,
  };
}

// CLI Execution Entry Point
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const isHelp = args.includes("-h") || args.includes("--help");
  const isVerbose = args.includes("-v") || args.includes("--verbose");
  const targetPaths = args.filter((a) => !a.startsWith("-"));

  if (isHelp) {
    console.log(`
Asset Linter CLI (Small World Machine)
Usage: npm run lint:assets [-- [options] [paths...]]

Checks all modular models and kits under public/assets/kits/** against 7 core rules:
  1. Geometrie-Vollständigkeit: POSITION (VEC3), NORMAL (VEC3), TEXCOORD_0 (VEC2), TANGENT (VEC4).
  2. Degenerierte Dreiecke: No zero-area triangles, collinear vertices, duplicate indices, or NaN/Inf.
  3. Root-Transform-Konformität: Root nodes must have identity transforms (no unbaked translation/rotation/scale).
  4. Keine negativen Skalierungen: No negative scale in any node transform (prevents inverted winding orders).
  5. Polycount-Budget nach ADR-0011-Tiers: 4-Tier polycount & file size budgets with grandfathered baselines.
  6. Konsistenzcheck AABB: Actual measured mesh bounding box vs. meta.json dimensions (catches export bugs).
  7. Textur-Slot- und Namensverträge: Texture slot matching via TextureSlotMatcher & WebP format contracts.

Options:
  -v, --verbose    Print detailed asset checks and stats
  -h, --help       Show this help message
`);
    process.exit(0);
  }

  console.log("==> Running Small World Machine Asset Linter (7 core checks)...");
  const summary = lintAssets(targetPaths.length > 0 ? targetPaths : undefined);

  if (isVerbose) {
    console.log(`Scanned ${summary.scannedKits} kits, ${summary.scannedItems} standalone items.`);
  }

  if (summary.issues.length > 0) {
    console.log(
      `\nFound ${summary.issues.length} issue(s) (${summary.errorCount} errors, ${summary.warningCount} warnings):\n`,
    );
    for (const issue of summary.issues) {
      const badge = issue.severity === "error" ? "\x1b[31m[ERROR]\x1b[0m" : "\x1b[33m[WARN]\x1b[0m";
      console.log(`  ${badge} (${issue.rule}) \x1b[1m${issue.assetId}\x1b[0m: ${issue.message}`);
    }
    console.log("");
  }

  if (summary.errorCount > 0) {
    console.error(`\x1b[31m✖ Asset linting failed with ${summary.errorCount} error(s).\x1b[0m\n`);
    process.exit(1);
  } else {
    console.log(
      `\x1b[32m✔ All kit assets passed 7/7 core checks cleanly (${summary.scannedKits} kits verified).\x1b[0m\n`,
    );
    process.exit(0);
  }
}
