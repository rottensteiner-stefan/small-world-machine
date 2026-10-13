import { Matrix4, MathPool, Quaternion, Vector3D } from "../../math/index.js";
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

/** Shortest-arc rotation taking the decal's up axis (+Y) onto `normal`. */
export function quaternionFromNormal(normal: Vector3D): Quaternion {
  const len = normal.length();
  if (len < 1e-9) return new Quaternion(0, 0, 0, 1);
  const nx = normal.x / len;
  const ny = normal.y / len;
  const nz = normal.z / len;
  // Antiparallel: the cross product vanishes, any axis in the XZ plane is a valid half-turn.
  if (ny < -0.999999) return new Quaternion(1, 0, 0, 0);
  // axis = Y x n = (nz, 0, -nx), w = 1 + dot(Y, n); normalizing yields the half-angle quaternion.
  const q = new Quaternion(nz, 0, -nx, 1 + ny);
  const qLen = Math.hypot(q.x, q.y, q.z, q.w);
  return new Quaternion(q.x / qLen, q.y / qLen, q.z / qLen, q.w / qLen);
}

/**
 * Orientation of a decal whose +Y is `normal`, additionally spun by `spin` radians about that
 * normal. Returned as the Euler angles (YXZ, like `Object3D.rotation`), so the editor's gizmo and
 * inspector keep working on a decal placed this way; no quaternion is attached to it.
 */
export function decalEulerFromNormal(normal: Vector3D, spin: number): Vector3D {
  const q = quaternionFromNormal(normal);
  q.multiply(new Quaternion(0, Math.sin(spin / 2), 0, Math.cos(spin / 2)));
  return q.toEuler();
}
