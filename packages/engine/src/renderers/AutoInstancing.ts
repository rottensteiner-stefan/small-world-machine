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
  // Index writes + one final `length = n` instead of `length = 0` + push(): V8 drops an array's
  // backing store on `length = 0`, so these per-pass scratch lists regrew from zero every frame.
  let nRun = 0;
  let nRuns = 0;
  let nRest = 0;

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
      runs[nRuns++] = nRun;
      for (let j = i; j < end; j++) runObjects[nRun++] = objects[j]!;
      runs[nRuns++] = nRun;
    } else {
      for (let j = i; j < end; j++) rest[nRest++] = objects[j]!;
    }
    i = end;
  }
  runObjects.length = nRun;
  runs.length = nRuns;
  rest.length = nRest;
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
  // The same list is grouped again by every pass of a frame (main, pre-pass, each cascade) and
  // scene order is often grouped already: an O(n) check skips the sort and its temp buffers.
  _sortOrdinals = ordinals;
  if (!isGrouped(objects)) objects.sort(compareByGeometryOrdinal);
  _sortOrdinals = undefined;
  return nextOrdinal;
}

/** Ordinal table of the running `groupByGeometryForInstancing` call (module-level comparator, so
 * no closure is allocated per call; only ever set synchronously around the sort). */
let _sortOrdinals: WeakMap<GeometryDataInterface, number> | undefined;

/** Sort key: geometry ordinal; objects without geometry go last (matches the comparator). */
function geometryKey(o: Object3D): number {
  const g = o.geometry;
  return g === undefined ? Number.POSITIVE_INFINITY : (_sortOrdinals!.get(g) ?? 0);
}

function compareByGeometryOrdinal(a: Object3D, b: Object3D): number {
  const ka = geometryKey(a);
  const kb = geometryKey(b);
  return ka === kb ? 0 : ka < kb ? -1 : 1;
}

function isGrouped(objects: readonly Object3D[]): boolean {
  let prev = geometryKey(objects[0]!);
  for (let i = 1; i < objects.length; i++) {
    const key = geometryKey(objects[i]!);
    if (key < prev) return false;
    prev = key;
  }
  return true;
}

/** Reused result slots of {@link splitByInstancing} (zero-GC). */
export interface InstancingSplit {
  standard: Object3D[];
  instanced: Object3D[];
}

const NO_OBJECTS: Object3D[] = [];

/**
 * Splits a draw list into plain objects and `InstancedMesh`es. A uniform list (the common case:
 * one batch = one material, no hand-built instancing) is passed through as-is instead of being
 * copied into a scratch list -- per pass and per cascade that copy dominated the remaining
 * per-frame allocation. Only a mixed list is copied (index writes, trimmed once).
 */
export function splitByInstancing(
  objects: Object3D[],
  standardScratch: Object3D[],
  instancedScratch: Object3D[],
  out: InstancingSplit,
): void {
  let nInstanced = 0;
  for (let i = 0; i < objects.length; i++) {
    if (objects[i] instanceof InstancedMesh) nInstanced++;
  }
  if (nInstanced === 0) {
    out.standard = objects;
    out.instanced = NO_OBJECTS;
    return;
  }
  if (nInstanced === objects.length) {
    out.standard = NO_OBJECTS;
    out.instanced = objects;
    return;
  }
  let nI = 0;
  let nS = 0;
  for (let i = 0; i < objects.length; i++) {
    const o = objects[i]!;
    if (o instanceof InstancedMesh) instancedScratch[nI++] = o;
    else standardScratch[nS++] = o;
  }
  instancedScratch.length = nI;
  standardScratch.length = nS;
  out.standard = standardScratch;
  out.instanced = instancedScratch;
}
