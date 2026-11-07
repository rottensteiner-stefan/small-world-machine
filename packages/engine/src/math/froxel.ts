/**
 * Froxel grid math (option R: reuses the clustered light grid as the volumetric fog grid).
 *
 * V1 of the volumetric fog ("Froxel Stage 3") does NOT build a separate 160x90x64 grid: it uses
 * the existing clustered light grid (`computeClusterCounts`/`zSliceFromViewDepth` in
 * `ClusterGrid.ts`) directly -- the same screen-space tiles and logarithmically-staggered depth
 * slices the clustered forward+ light culling uses. This keeps light injection and slicing fully
 * shared with ADR 0007, exactly what W1 in `docs/research/aaa-engine-techniques.md` asks for.
 *
 * `sliceCenterViewDepth` is the inverse of `zSliceFromViewDepth` (`ClusterGrid.ts`): the view-space
 * depth at the centre of a depth slice. It is the TypeScript reference of `sliceCenterDepth` in
 * `froxel_inject.wgsl`, `froxel_reproject.wgsl` and `froxel_integrate.wgsl` (WGSL has no imports, so
 * the formula is duplicated there; keep all four in sync).
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
