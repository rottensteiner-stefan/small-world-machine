import type { GeometryDataInterface } from "../interfaces/index.js";
import type { RenderBatch } from "../core/Scene.js";
import { Topology, WireframeMode } from "../enums/index.js";

/** Whether the shadow passes draw `batch` as world-width line quads instead of 1-texel lines. */
export function usesLineQuadShadow(batch: RenderBatch): boolean {
  return batch.topology === Topology.LINE_LIST && (batch.shadowWidth ?? 0) > 0;
}

/** Vertices per edge: two triangles, non-indexed. */
export const LINE_SHADOW_RIBBON_VERTICES_PER_EDGE = 6;

/**
 * Edge ribbon of a line caster, drawn by the shadow passes as world-width quads instead of
 * 1-texel lines. Each edge (A, B) becomes two triangles; every vertex carries its own endpoint
 * (`positions`, vertex slot 0), the opposite endpoint (`others`, slot 1, the normal slot) and
 * `sides` (slot 2, the uv slot): x = which side of the edge (±1), y = +1 at A, -1 at B, so
 * `(other - this) * y` is the edge direction A→B at both ends. The vertex shader does the actual
 * expansion in light clip space (`line_shadow.vert.wgsl` / `.glsl`).
 */
export interface LineShadowRibbon {
  positions: Float32Array;
  others: Float32Array;
  sides: Float32Array;
  vertexCount: number;
}

// Corner order of the two triangles: (A,-) (A,+) (B,+) / (A,-) (B,+) (B,-).
const CORNER_END: readonly number[] = [0, 0, 1, 0, 1, 1];
const CORNER_SIDE: readonly number[] = [-1, 1, 1, -1, 1, -1];

/**
 * Builds the shadow ribbon from the same edge list the 1-texel line path draws: the structural
 * `wireframeIndices` in `STRUCTURAL` mode, otherwise `indices`, otherwise consecutive vertex
 * pairs. Setup-time code (called once per geometry, not per frame).
 */
export function buildLineShadowRibbon(
  geo: GeometryDataInterface,
  wireframeMode: WireframeMode = WireframeMode.DEFAULT,
): LineShadowRibbon {
  const lineIndices =
    wireframeMode === WireframeMode.STRUCTURAL && geo.wireframeIndices?.length
      ? geo.wireframeIndices
      : geo.indices?.length
        ? geo.indices
        : undefined;
  const v = geo.vertices;
  const edgeCount = Math.floor((lineIndices ? lineIndices.length : v.length / 3) / 2);
  const vertexCount = edgeCount * LINE_SHADOW_RIBBON_VERTICES_PER_EDGE;
  const positions = new Float32Array(vertexCount * 3);
  const others = new Float32Array(vertexCount * 3);
  const sides = new Float32Array(vertexCount * 2);

  for (let e = 0; e < edgeCount; e++) {
    const a = lineIndices ? lineIndices[e * 2]! : e * 2;
    const b = lineIndices ? lineIndices[e * 2 + 1]! : e * 2 + 1;
    for (let c = 0; c < LINE_SHADOW_RIBBON_VERTICES_PER_EDGE; c++) {
      const atB = CORNER_END[c] === 1;
      const self = atB ? b : a;
      const other = atB ? a : b;
      const o = (e * LINE_SHADOW_RIBBON_VERTICES_PER_EDGE + c) * 3;
      positions[o] = v[self * 3]!;
      positions[o + 1] = v[self * 3 + 1]!;
      positions[o + 2] = v[self * 3 + 2]!;
      others[o] = v[other * 3]!;
      others[o + 1] = v[other * 3 + 1]!;
      others[o + 2] = v[other * 3 + 2]!;
      const s = (e * LINE_SHADOW_RIBBON_VERTICES_PER_EDGE + c) * 2;
      sides[s] = CORNER_SIDE[c]!;
      sides[s + 1] = atB ? -1 : 1;
    }
  }

  return { positions, others, sides, vertexCount };
}
