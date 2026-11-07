import { Vector3D } from "@small-world-machine/engine";
import type { DecalStampHit } from "./DecalStampTool.js";

/** A fitted receiver plane: `point` is the pointer hit projected onto it, `spread` the largest
 * distance of any footprint hit from the plane. */
export interface DecalPlaneFit {
  point: Vector3D;
  normal: Vector3D;
  spread: number;
}

/** Largest angle between the fitted plane and any footprint hit's own normal before the footprint
 * counts as straddling a corner or an edge (a 90 degree corner fits a plane 45 degrees off each wall). */
export const MAX_FIT_DEVIATION = (35 * Math.PI) / 180;

function angleBetween(a: Vector3D, b: Vector3D): number {
  const d = a.dot(b) / (a.length() * b.length());
  return Math.acos(Math.max(-1, Math.min(1, d)));
}

/**
 * Fits one plane to the surface under a decal's footprint. `corners` are the ray hits at the four
 * footprint corners in order around the rectangle (`undefined` where the ray missed), `reference` is
 * the single hit under the pointer. Three corners give the plane through them, four use the cross
 * product of the diagonals (the exact normal for a planar patch, a good average for a curved one).
 * @returns undefined when fewer than three corners hit, the points are degenerate, or the footprint
 * straddles a corner/edge (the caller then falls back to the plain single-hit normal).
 */
export function fitDecalPlane(
  reference: DecalStampHit,
  corners: readonly (DecalStampHit | undefined)[],
): DecalPlaneFit | undefined {
  const hits = corners.filter((c): c is DecalStampHit => undefined !== c);
  if (hits.length < 3) return undefined;

  let normal: Vector3D;
  if (4 === corners.length && 4 === hits.length) {
    const d1 = hits[2]!.point.clone().sub(hits[0]!.point);
    const d2 = hits[3]!.point.clone().sub(hits[1]!.point);
    normal = d1.cross(d2);
  } else {
    const [a, b, c] = hits as [DecalStampHit, DecalStampHit, DecalStampHit];
    normal = b.point.clone().sub(a.point).cross(c.point.clone().sub(a.point));
  }
  if (normal.length() < 1e-9) return undefined;
  normal.normalize();
  if (normal.dot(reference.normal) < 0) normal.scale(-1);

  if (angleBetween(normal, reference.normal) > MAX_FIT_DEVIATION) return undefined;
  for (const hit of hits) {
    if (angleBetween(normal, hit.normal) > MAX_FIT_DEVIATION) return undefined;
  }

  const centroid = new Vector3D();
  for (const hit of hits) centroid.add(hit.point);
  centroid.scale(1 / hits.length);

  let spread = 0;
  for (const hit of hits) {
    spread = Math.max(spread, Math.abs(hit.point.clone().sub(centroid).dot(normal)));
  }
  const offset = reference.point.clone().sub(centroid).dot(normal);
  const point = reference.point.clone().sub(normal.clone().scale(offset));
  return { point, normal, spread };
}
