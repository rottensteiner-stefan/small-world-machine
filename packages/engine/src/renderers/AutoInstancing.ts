import type { Object3D } from "../core/Object3D.js";
import { InstancedMesh } from "../core/InstancedMesh.js";
import { isSkinnedMesh } from "../core/animation/SkinnedMesh.js";
import type { GeometryDataInterface } from "../interfaces/index.js";

/** Shortest run of same-geometry objects worth one instanced draw instead of per-object draws. */
export const AUTO_INSTANCING_MIN_RUN = 4;

/** Whether `o` differs from its neighbours only in its world matrix (no skinning, own instances). */
function isRunCandidate(o: Object3D, requireCastShadow: boolean): boolean {
  return (
    o.geometry !== undefined &&
    !o.geometry.joints &&
    !isSkinnedMesh(o) &&
    !(o instanceof InstancedMesh) &&
    (!requireCastShadow || o.castShadow)
  );
}

/**
 * Splits one opaque subgroup (all objects share a material, see `RenderBatch`) for automatic
 * instancing (ADR 0046): consecutive objects with the same geometry that differ only in their
 * world matrix form a run; runs of at least `AUTO_INSTANCING_MIN_RUN` objects go to
 * `runObjects` with their `[start, end)` index pairs in `runs`, everything else to `rest`.
 * `requireCastShadow` (shadow passes) keeps non-casters out of runs. All three outputs are
 * cleared first and reused by the caller (no per-frame allocation).
 */
export function partitionInstanceRuns(
  objects: readonly Object3D[],
  runObjects: Object3D[],
  runs: number[],
  rest: Object3D[],
  requireCastShadow: boolean = false,
): void {
  runObjects.length = 0;
  runs.length = 0;
  rest.length = 0;

  let i = 0;
  while (i < objects.length) {
    const first = objects[i]!;
    let end = i + 1;
    if (isRunCandidate(first, requireCastShadow)) {
      while (
        end < objects.length &&
        objects[end]!.geometry === first.geometry &&
        isRunCandidate(objects[end]!, requireCastShadow)
      ) {
        end++;
      }
    }

    if (end - i >= AUTO_INSTANCING_MIN_RUN) {
      runs.push(runObjects.length);
      for (let j = i; j < end; j++) runObjects.push(objects[j]!);
      runs.push(runObjects.length);
    } else {
      for (let j = i; j < end; j++) rest.push(objects[j]!);
    }
    i = end;
  }
}

/**
 * ADR 0046 supplement (A2): reorders an opaque subgroup in place so that objects sharing the exact
 * same `GeometryData` become consecutive. `partitionInstanceRuns` only merges *consecutive* same-
 * geometry objects, so this maximizes the runs it can form (and, on WebGPU, also the existing K6
 * vertex-buffer state dedup) without a global per-frame sort. Identical semantics to ADR 0046:
 * only reference-equal geometries merge, content-identical but distinct objects do not.
 *
 * The sort is stable (ES2019 `Array.prototype.sort`) and deterministic (key = a monotonically
 * assigned geometry ordinal), so rendering order, determinism and Capture-Frame-Rate are
 * unaffected. `ordinals` is persistent scratch and `nextOrdinal` the next free ordinal; the
 * function returns the continuation value the caller must keep. A `WeakMap` never keeps disposed
 * geometries alive, and the helper returns without touching anything below `AUTO_INSTANCING_MIN_RUN`
 * (`undefined`-geometry objects deterministically sink to the end).
 */
export function groupByGeometryForInstancing(
  objects: Object3D[],
  ordinals: WeakMap<GeometryDataInterface, number>,
  nextOrdinal: number,
): number {
  if (objects.length < AUTO_INSTANCING_MIN_RUN) return nextOrdinal;
  for (let i = 0; i < objects.length; i++) {
    const geometry = objects[i]!.geometry;
    if (geometry !== undefined && !ordinals.has(geometry)) {
      ordinals.set(geometry, nextOrdinal++);
    }
  }
  objects.sort((a, b) => {
    const ga = a.geometry;
    const gb = b.geometry;
    if (ga === undefined) return gb === undefined ? 0 : 1;
    if (gb === undefined) return -1;
    return (ordinals.get(ga) ?? 0) - (ordinals.get(gb) ?? 0);
  });
  return nextOrdinal;
}
