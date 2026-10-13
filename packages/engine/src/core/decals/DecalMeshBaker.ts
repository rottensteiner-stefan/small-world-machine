import { Matrix4 } from "../../math/index.js";
import { ModelGeometry } from "../../geometry/index.js";
import { BoundingBox } from "../../physix/index.js";
import { BlendingMode, CullMode, Topology } from "../../enums/index.js";
import { BasicMaterial, DecalMaterial, StandardMaterial } from "../materials/index.js";
import type { AbstractMaterial } from "../materials/index.js";
import { InstancedMesh } from "../InstancedMesh.js";
import { Object3D } from "../Object3D.js";
import { Decal } from "../objects/Decal.js";
import { compareDecals } from "./DecalMath.js";

/** Tuning for the mesh-decal baker. */
export interface DecalBakeOptions {
  /** Distance (world units) the baked surface is lifted along the receiver triangle normal against z-fighting. Defaults to 0.002. */
  normalOffset?: number;
}

/** Extra options of `bakeSceneDecals`. */
export interface SceneDecalBakeOptions extends DecalBakeOptions {
  /** Hide each decal box that was baked (default true), so a backend that could also draw the box does not draw it twice. */
  hideBakedDecals?: boolean;
}

/** One receiver triangle soup in plain arrays: no scene-graph types, so the clipping core is unit-testable. */
export interface BakeReceiverInput {
  /** Local-space vertex positions (x, y, z, ...). */
  positions: ArrayLike<number>;
  /** Triangle list indices; omitted means consecutive vertices form the triangles. */
  indices?: ArrayLike<number> | undefined;
  /** Receiver local-to-world matrix. */
  world: Matrix4;
  /** Optional local-space AABB for a cheap whole-receiver rejection before any triangle work. */
  localBounds?: { min: ArrayLike<number>; max: ArrayLike<number> } | undefined;
}

/** Baked decal surface in world space; every triangle owns its three vertices (flat normal). */
export interface BakedDecalGeometry {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  /** 16-bit while the vertex count allows it: WebGL1 has no 32-bit indices without an extension. */
  indices: Uint16Array | Uint32Array;
}

const DEFAULT_NORMAL_OFFSET = 0.002;
const DEG2RAD = Math.PI / 180;
export type Vec3 = [number, number, number];

/** Clips a convex polygon against the half-space `sign * p[axis] <= 0.5` (Sutherland-Hodgman, one plane). */
function clipPlane(poly: Vec3[], axis: 0 | 1 | 2, sign: 1 | -1): Vec3[] {
  const out: Vec3[] = [];
  const count = poly.length;
  for (let i = 0; i < count; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % count]!;
    const da = 0.5 - sign * a[axis];
    const db = 0.5 - sign * b[axis];
    if (da >= 0) out.push(a);
    if (da >= 0 !== db >= 0) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    }
  }
  return out;
}

/** Clips a polygon against the unit box [-0.5, 0.5]^3; fewer than 3 vertices left means nothing is inside. */
export function clipPolygonToUnitBox(polygon: Vec3[]): Vec3[] {
  let poly = polygon;
  for (const axis of [0, 1, 2] as const) {
    for (const sign of [1, -1] as const) {
      poly = clipPlane(poly, axis, sign);
      if (poly.length < 3) return [];
    }
  }
  return poly;
}

function transformPoint(m: Float32Array, x: number, y: number, z: number): Vec3 {
  return [
    m[0]! * x + m[4]! * y + m[8]! * z + m[12]!,
    m[1]! * x + m[5]! * y + m[9]! * z + m[13]!,
    m[2]! * x + m[6]! * y + m[10]! * z + m[14]!,
  ];
}

function determinant3(m: Float32Array): number {
  return (
    m[0]! * (m[5]! * m[10]! - m[6]! * m[9]!) -
    m[4]! * (m[1]! * m[10]! - m[2]! * m[9]!) +
    m[8]! * (m[1]! * m[6]! - m[2]! * m[5]!)
  );
}

/** True when the receiver's local AABB lies completely outside one face of the decal box. */
function boundsOutsideBox(
  bounds: { min: ArrayLike<number>; max: ArrayLike<number> },
  receiverToBox: Matrix4,
): boolean {
  const m = receiverToBox.data;
  const lo: Vec3 = [Infinity, Infinity, Infinity];
  const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < 8; i++) {
    const p = transformPoint(
      m,
      i & 1 ? bounds.max[0]! : bounds.min[0]!,
      i & 2 ? bounds.max[1]! : bounds.min[1]!,
      i & 4 ? bounds.max[2]! : bounds.min[2]!,
    );
    for (let k = 0; k < 3; k++) {
      lo[k] = Math.min(lo[k]!, p[k]!);
      hi[k] = Math.max(hi[k]!, p[k]!);
    }
  }
  return lo.some((v, k) => v > 0.5 || hi[k]! < -0.5);
}

/**
 * Clips every receiver triangle against the decal's unit box and returns the covered surface in
 * world space, or undefined when nothing is covered. Pure math on plain arrays.
 *
 * Triangles facing away from the decal's up axis (+Y of `decalWorld`) are dropped, and so are those
 * whose angle to it exceeds `angleFadeEnd` (hard cut, no fade). UV = (box.x + 0.5, box.z + 0.5).
 * The normal is the flat receiver triangle normal; a negative-determinant receiver matrix is
 * handled (its triangle winding is reversed so front stays front).
 */
export function clipTrianglesToDecalBox(
  decalWorld: Matrix4,
  receivers: readonly BakeReceiverInput[],
  angleFadeEnd: number,
  normalOffset: number = DEFAULT_NORMAL_OFFSET,
): BakedDecalGeometry | undefined {
  const boxFromWorld = new Matrix4();
  if (!Matrix4.invert(decalWorld, boxFromWorld)) return undefined;

  const d = decalWorld.data;
  const upLength = Math.hypot(d[4]!, d[5]!, d[6]!);
  if (upLength === 0) return undefined;
  const up: Vec3 = [d[4]! / upLength, d[5]! / upLength, d[6]! / upLength];
  // Hard cut: a surface exactly edge-on (cos 0) can never receive, so never drop below a tiny positive cosine.
  const minCos = Math.max(Math.cos(angleFadeEnd * DEG2RAD), 1e-6);

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const receiverToBox = new Matrix4();

  for (const receiver of receivers) {
    Matrix4.multiply(boxFromWorld, receiver.world, receiverToBox);
    if (receiver.localBounds && boundsOutsideBox(receiver.localBounds, receiverToBox)) continue;

    const rw = receiver.world.data;
    const flip = determinant3(rw) < 0;
    const src = receiver.positions;
    const idx = receiver.indices;
    const triangleCount = Math.floor((idx ? idx.length : src.length / 3) / 3);

    for (let t = 0; t < triangleCount; t++) {
      const corner = (c: number): number => (idx ? idx[t * 3 + c]! : t * 3 + c) * 3;
      const order = flip ? [0, 2, 1] : [0, 1, 2];
      const world: Vec3[] = order.map((c) => {
        const o = corner(c);
        return transformPoint(rw, src[o]!, src[o + 1]!, src[o + 2]!);
      });

      const e1: Vec3 = [
        world[1]![0] - world[0]![0],
        world[1]![1] - world[0]![1],
        world[1]![2] - world[0]![2],
      ];
      const e2: Vec3 = [
        world[2]![0] - world[0]![0],
        world[2]![1] - world[0]![1],
        world[2]![2] - world[0]![2],
      ];
      const nx = e1[1] * e2[2] - e1[2] * e2[1];
      const ny = e1[2] * e2[0] - e1[0] * e2[2];
      const nz = e1[0] * e2[1] - e1[1] * e2[0];
      const nLength = Math.hypot(nx, ny, nz);
      if (nLength < 1e-12) continue;
      const n: Vec3 = [nx / nLength, ny / nLength, nz / nLength];
      if (n[0] * up[0] + n[1] * up[1] + n[2] * up[2] < minCos) continue;

      const box = world.map((p) => transformPoint(boxFromWorld.data, p[0], p[1], p[2]));
      const polygon = clipPolygonToUnitBox(box);
      if (polygon.length < 3) continue;

      const base = positions.length / 3;
      for (const p of polygon) {
        const w = transformPoint(d, p[0], p[1], p[2]);
        positions.push(
          w[0] + n[0] * normalOffset,
          w[1] + n[1] * normalOffset,
          w[2] + n[2] * normalOffset,
        );
        normals.push(n[0], n[1], n[2]);
        uvs.push(p[0] + 0.5, p[2] + 0.5);
      }
      for (let i = 1; i < polygon.length - 1; i++) indices.push(base, base + i, base + i + 1);
    }
  }

  if (indices.length === 0) return undefined;
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    indices: positions.length / 3 <= 0xffff ? new Uint16Array(indices) : new Uint32Array(indices),
  };
}

/** Maps the decal's material onto the closest lit/unlit mesh material; the decal's alpha stays `color.a`. */
function createBakedMaterial(source: DecalMaterial): AbstractMaterial {
  const color = source.color.clone();
  let material: AbstractMaterial;
  if (source.unlit) {
    material = new BasicMaterial({
      color,
      ...(source.diffuseMap && { diffuseMap: source.diffuseMap }),
    });
  } else {
    // ormMap is the glTF packed layout (R = AO, G = roughness, B = metallic), which the standard
    // material reads from its three separate maps.
    material = new StandardMaterial({
      color,
      diffuseMap: source.diffuseMap,
      normalMap: source.normalMap,
      aoMap: source.ormMap,
      roughnessMap: source.ormMap,
      metallicMap: source.ormMap,
      roughness: source.roughness,
      metallic: source.metallic,
      emissiveMap: source.emissiveMap,
      emissiveColor: source.emissiveColor.clone(),
      emissiveIntensity: source.emissiveIntensity,
    });
  }
  material.transparent = true;
  material.depthWrite = false;
  material.cullMode = CullMode.NONE;
  return material;
}

/** Why a receiver cannot be baked against, or undefined if it can. */
function skipReason(receiver: Object3D): string | undefined {
  const geometry = receiver.geometry;
  if (!geometry || geometry.vertices.length === 0) return "has no geometry data";
  if (geometry.joints || geometry.weights) return "is skinned";
  if (receiver instanceof InstancedMesh) return "is instanced";
  if (geometry.topology !== undefined && geometry.topology !== Topology.TRIANGLE_LIST) {
    return "is not a triangle list";
  }
  return undefined;
}

/**
 * Bakes one decal into a regular transparent mesh for backends without box decals (WebGL1):
 * the receiver triangles inside the decal box, clipped to it, UV-mapped like the box projection.
 * Returns undefined when no receiver surface lies inside the box.
 *
 * World matrices of the decal and receivers must be current (`scene.update()`). The mesh holds
 * world-space geometry around its own origin (the decal's world position, for transparent
 * sorting), so add it to a parent with identity transform, e.g. the scene root. Skinned,
 * instanced, non-triangle and geometry-less receivers are skipped with a warning.
 *
 * Limits: no edge or angle fade (triangles past `angleFadeEnd` are cut, the texture alpha shapes
 * the edge), flat normals, and baked decals sort among transparents by decal-centre distance, not
 * by `priority`.
 */
export function bakeDecalMesh(
  decal: Decal,
  receivers: readonly Object3D[],
  options: DecalBakeOptions = {},
): Object3D | undefined {
  const source = decal.material;
  if (!(source instanceof DecalMaterial)) {
    console.warn(`[DecalMeshBaker] Decal "${decal.name}" has no DecalMaterial, not baked.`);
    return undefined;
  }

  const inputs: BakeReceiverInput[] = [];
  for (const receiver of receivers) {
    const reason = skipReason(receiver);
    if (reason) {
      console.warn(`[DecalMeshBaker] Receiver "${receiver.name}" ${reason}, skipped.`);
      continue;
    }
    const geometry = receiver.geometry!;
    const bounds = geometry.getBoundingVolume();
    inputs.push({
      positions: geometry.vertices,
      indices: geometry.indices,
      world: receiver.worldMatrix,
      localBounds:
        bounds instanceof BoundingBox
          ? {
              min: [bounds.min.x, bounds.min.y, bounds.min.z],
              max: [bounds.max.x, bounds.max.y, bounds.max.z],
            }
          : undefined,
    });
  }

  const baked = clipTrianglesToDecalBox(
    decal.worldMatrix,
    inputs,
    source.angleFadeEnd,
    options.normalOffset,
  );
  if (!baked) return undefined;

  // Re-centre on the decal's world position so the mesh sorts and culls where the decal is.
  const dm = decal.worldMatrix.data;
  const ox = dm[12]!;
  const oy = dm[13]!;
  const oz = dm[14]!;
  for (let i = 0; i < baked.positions.length; i += 3) {
    baked.positions[i] = baked.positions[i]! - ox;
    baked.positions[i + 1] = baked.positions[i + 1]! - oy;
    baked.positions[i + 2] = baked.positions[i + 2]! - oz;
  }

  const mesh = new Object3D(`${decal.name}Baked`);
  mesh.geometry = new ModelGeometry(
    baked.positions,
    baked.uvs,
    baked.normals,
    baked.indices,
  ).getGeometryData();
  mesh.material = createBakedMaterial(source);
  mesh.setPosition(ox, oy, oz);
  mesh.isCollidable = false;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * Bakes every `Decal` under `root` against all visible, baked-capable meshes under it whose
 * bounds touch the decal box, in stacking order (`compareDecals`), and adds the results to `root`.
 * Decal boxes that produced a mesh are hidden unless `hideBakedDecals` is false. Call it once after
 * the scene is built, and only on backends without box decals (`renderer.type === WEB_GL1`);
 * on others it would duplicate them. Returns the baked meshes.
 */
export function bakeSceneDecals(root: Object3D, options: SceneDecalBakeOptions = {}): Object3D[] {
  root.updateMatrixWorld(true);
  const decals: Decal[] = [];
  const receivers: Object3D[] = [];
  root.traverse((obj: Object3D): void => {
    if (!obj.isVisible) return;
    if (obj instanceof Decal) decals.push(obj);
    else if (obj.geometry && obj.material) {
      const manifest = obj.material.getRenderManifest();
      if (manifest.state?.isDecal || manifest.state?.blending === BlendingMode.ALPHA) return;
      const reason = skipReason(obj);
      if (reason) console.warn(`[DecalMeshBaker] Receiver "${obj.name}" ${reason}, skipped.`);
      else receivers.push(obj);
    }
  });
  decals.sort(compareDecals);

  const baked: Object3D[] = [];
  for (const decal of decals) {
    const mesh = bakeDecalMesh(decal, receivers, options);
    if (!mesh) continue;
    root.add(mesh);
    baked.push(mesh);
    if (options.hideBakedDecals !== false) decal.isVisible = false;
  }
  return baked;
}
