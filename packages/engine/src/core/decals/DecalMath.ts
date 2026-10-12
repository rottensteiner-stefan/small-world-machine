import { Matrix4, MathPool } from "../../math/index.js";
import type { Decal } from "../objects/Decal.js";

/** Absolute determinant of the world matrix's 3x3 part: the volume of the unit decal box in world space. */
export function decalWorldVolume(world: Matrix4): number {
  const m = world.data;
  const det =
    m[0]! * (m[5]! * m[10]! - m[6]! * m[9]!) -
    m[4]! * (m[1]! * m[10]! - m[2]! * m[9]!) +
    m[8]! * (m[1]! * m[6]! - m[2]! * m[5]!);
  return Math.abs(det);
}

/**
 * Static, camera-independent stacking order for overlapping decals: explicit `priority` first,
 * then large volumes before small ones (broad grime below small details), then creation order.
 * Back-to-front distance sorting says nothing here, since overlapping boxes sit on one surface.
 */
export function compareDecals(a: Decal, b: Decal): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  const volumeA = decalWorldVolume(a.worldMatrix);
  const volumeB = decalWorldVolume(b.worldMatrix);
  if (volumeA !== volumeB) return volumeB - volumeA;
  return a.sequence - b.sequence;
}

/**
 * Writes `inverse(world) * invViewProj` into `out`: maps a clip-space position (x, y in
 * [-1, 1], z in the GL convention [-1, 1], w = 1) straight into the decal's unit box, where the
 * box spans [-0.5, 0.5] on every axis. Returns false (leaving `out` untouched) if the world
 * matrix is singular.
 */
export function computeClipToBox(world: Matrix4, invViewProj: Matrix4, out: Matrix4): boolean {
  const worldToBox = MathPool.acquireMatrix();
  const invertible = Matrix4.invert(world, worldToBox);
  if (invertible) Matrix4.multiply(worldToBox, invViewProj, out);
  MathPool.releaseMatrix(worldToBox);
  return invertible;
}
