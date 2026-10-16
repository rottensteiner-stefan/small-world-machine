import { zSliceFromViewDepth } from "./ClusterGrid.js";

/**
 * Froxel grid math (option R: reuses the clustered light grid as the volumetric fog grid).
 *
 * V1 of the volumetric fog ("Froxel Stage 3") does NOT build a separate 160x90x64 grid: it uses
 * the existing clustered light grid (`computeClusterCounts`/`zSliceFromViewDepth` in
 * `ClusterGrid.ts`) directly -- the same screen-space tiles and logarithmically-staggered depth
 * slices the clustered forward+ light culling uses. This keeps light injection and slicing fully
 * shared with ADR 0007, exactly what W1 in `docs/research/aaa-engine-techniques.md` asks for.
 *
 * `sliceCenterViewDepth` is the inverse of `zSliceFromViewDepth`: it returns the view-space depth
 * at the centre of a depth slice, used by the injection compute shader to place each froxel cell
 * in world space (via the inverse view-projection matrix).
 */

/**
 * View-space depth at the centre of a given depth slice (the inverse of `zSliceFromViewDepth`).
 * @param slice Slice index (0..slices-1).
 * @param near Camera near-plane distance.
 * @param far Camera far-plane distance.
 * @param slices Number of depth slices -- must match the cluster grid's `z` dimension.
 */
export function sliceCenterViewDepth(
  slice: number,
  near: number,
  far: number,
  slices: number,
): number {
  const clamped = Math.min(Math.max(slice, 0), slices - 1);
  const n = Math.max(near, 1e-6);
  const f = Math.max(far, n + 1e-6);
  // Geometric centre of the log-spaced slice, in view-space depth (positive distance from camera).
  // slice=0 must not be at exact near (tangent blows up), so clamp to a tiny epsilon above near.
  const low = Math.pow(f / n, clamped / slices) * n;
  const high = Math.pow(f / n, (clamped + 1) / slices) * n;
  return Math.max(n * 1.001, Math.sqrt(low * high));
}

/**
 * Resolves the grid across the depth axis for a given scene far plane, honouring the documented
 * `z` slice count of the cluster grid. Exists so volumetric components and the cluster grid can
 * never drift apart on the depth-slice axis (single source of truth for the Z dimension).
 * @param zSlices The cluster grid's `z` slice count.
 */
export function froxelDepthSlices(zSlices: number): number {
  return Math.max(1, Math.floor(zSlices));
}

/**
 * Conservative max distance clamp for volumetric evaluation: never marches further than the scene's
 * far plane (the volume texture covers only the froxel depth range), but never below the density
 * scale of a meaningful volume either.
 * @param requested Requested `maxDistance` from the element.
 * @param far Scene far plane distance.
 */
export function clampFroxelMaxDistance(requested: number, far: number): number {
  return Math.min(Math.max(requested, 1.0), Math.max(far, 1.0));
}

/**
 * Maps a world-space point to its froxel depth slice index (delegates to the shared cluster-grid
 * function so the volume and the light culling always slice identically).
 * @param viewZ View-space depth of the point (positive distance from camera).
 * @param near Camera near plane.
 * @param far Camera far plane.
 * @param slices Froxel depth slices (== cluster grid `z`).
 */
export function froxelSliceFromViewDepth(
  viewZ: number,
  near: number,
  far: number,
  slices: number,
): number {
  return zSliceFromViewDepth(viewZ, near, far, slices);
}
