import type { BoundingBox } from "./BoundingBox.js";
import type { BoundingSphere } from "./BoundingSphere.js";
import type { OBB } from "./OBB.js";
import { Ray } from "./Ray.js";
import type { Vector2D, Matrix4 } from "../math/index.js";
import { Vector3D, MathPool } from "../math/index.js";
import type { CameraInterfaceData } from "../interfaces/index.js";
import type { Object3D } from "../core/Object3D.js";
import { BoundingType } from "../enums/index.js";

/**
 * Represents an intersection result from a raycast.
 */
export interface Intersection {
  /** Distance from the ray origin to the intersection point. */
  distance: number;
  /** The intersected object. */
  object: Object3D;
  /** World-space hit point. */
  point: Vector3D;
  /** Unit world-space surface normal at the hit, flipped to face the ray origin. For hits resolved by the broad phase only (no triangle geometry) it is the negated ray direction. */
  normal: Vector3D;
}

/**
 * Casts rays into the scene to pick or select objects.
 */
export class Raycaster {
  /** The internal mathematical ray used for casting. */
  public ray: Ray = new Ray();

  /**
   * Sets the ray's origin and direction based on screen coordinates and the camera.
   * @param coords The 2D coordinates in Normalized Device Coordinates (NDC) [-1, 1].
   * @param camera The camera used to render the scene.
   */
  public setFromCamera(coords: Vector2D, camera: CameraInterfaceData): void {
    const invVP: Matrix4 = MathPool.acquireMatrix();
    if (false === camera.viewProjectionMatrix4.invert(invVP)) {
      MathPool.releaseMatrix(invVP);
      return;
    }

    // Unproject both the near- and far-plane points for this screen coordinate, rather than
    // using camera.position as the origin. For a perspective camera this gives an identical
    // ray (the near-plane point is colinear with the camera position along it), but for an
    // orthographic camera rays are parallel and do NOT converge at the camera position -- using
    // camera.position there would put the origin outside the frustum and yield wrong hits.
    const near: Vector3D = MathPool.acquireVector().set(coords.x, coords.y, -1.0);
    const far: Vector3D = MathPool.acquireVector().set(coords.x, coords.y, 1.0);
    invVP.transformVector(near);
    invVP.transformVector(far);

    this.ray.origin.copyFrom(near);
    this.ray.direction.copyFrom(far).sub(near).normalize();

    MathPool.releaseVector(near);
    MathPool.releaseVector(far);
    MathPool.releaseMatrix(invVP);
  }

  /**
   * Tests the ray against a list of objects. Uses a fast broad-phase bounds test
   * (AABB, sphere, or OBB, whichever the object's `bounds` are) and, if the object has
   * real triangle geometry, refines that into an exact Möller-Trumbore hit --
   * otherwise the broad-phase distance is used directly (e.g. for sprite-like
   * objects picked purely by their bounding volume).
   * @param objects The objects to test against.
   * @param sort If true, the results are sorted by distance (closest first).
   * @returns An array of intersections.
   */
  public intersectObjects(objects: Object3D[], sort: boolean = true): Intersection[] {
    const intersects: Intersection[] = [];

    for (const obj of objects) {
      if (!obj.isCollidable || !obj.bounds) {
        continue;
      }

      let broadT: number;
      if (BoundingType.BOX === obj.bounds.type) {
        broadT = this.ray.intersectsBox(obj.bounds as BoundingBox);
      } else if (BoundingType.SPHERE === obj.bounds.type) {
        broadT = this.ray.intersectsSphere(obj.bounds as BoundingSphere);
      } else if (BoundingType.OBB === obj.bounds.type) {
        broadT = this.ray.intersectsOBB(obj.bounds as OBB);
      } else {
        continue;
      }

      if (0 > broadT) continue;

      const geoData = obj.geometry;
      if (geoData && geoData.vertices && geoData.indices) {
        const invWorld = MathPool.acquireMatrix();
        if (false === obj.worldMatrix.invert(invWorld)) {
          MathPool.releaseMatrix(invWorld);
          // Degenerate (non-invertible) world matrix -- e.g. zero-scale decals. The geometry
          // collapses to a point in world space, so there is no well-defined local ray to test
          // against. Fall back to the broad-phase distance (same path as objects without
          // triangle geometry below) instead of silently dropping the object from picking.
          intersects.push(this._broadPhaseHit(broadT, obj));
          continue;
        }

        const localOrigin = MathPool.acquireVector();
        const localDirection = MathPool.acquireVector();
        const tempPoint = MathPool.acquireVector();

        invWorld.transformVector(this.ray.origin, localOrigin);
        tempPoint.copyFrom(this.ray.origin).add(this.ray.direction);
        invWorld.transformVector(tempPoint, localDirection);
        localDirection.sub(localOrigin);

        MathPool.releaseVector(tempPoint);

        const vertices = geoData.vertices;
        const indices = geoData.indices;
        let closestT = Infinity;
        let closestTri = -1;

        for (let i = 0; i < indices.length; i += 3) {
          const i0 = (indices[i] ?? 0) * 3;
          const i1 = (indices[i + 1] ?? 0) * 3;
          const i2 = (indices[i + 2] ?? 0) * 3;

          const tTri = this._intersectTriangleDirect(
            vertices[i0] ?? 0,
            vertices[i0 + 1] ?? 0,
            vertices[i0 + 2] ?? 0,
            vertices[i1] ?? 0,
            vertices[i1 + 1] ?? 0,
            vertices[i1 + 2] ?? 0,
            vertices[i2] ?? 0,
            vertices[i2 + 1] ?? 0,
            vertices[i2 + 2] ?? 0,
            localOrigin,
            localDirection,
          );

          if (tTri >= 0 && tTri < closestT) {
            closestT = tTri;
            closestTri = i;
          }
        }

        MathPool.releaseVector(localOrigin);
        MathPool.releaseVector(localDirection);

        if (closestT !== Infinity) {
          intersects.push({
            distance: closestT,
            object: obj,
            point: this.ray.at(closestT),
            normal: this._worldTriangleNormal(vertices, indices, closestTri, invWorld),
          });
        }
        MathPool.releaseMatrix(invWorld);
      } else {
        intersects.push(this._broadPhaseHit(broadT, obj));
      }
    }

    if (sort) {
      intersects.sort((a, b) => a.distance - b.distance);
    }

    return intersects;
  }

  private _broadPhaseHit(distance: number, object: Object3D): Intersection {
    const d = this.ray.direction;
    return {
      distance,
      object,
      point: this.ray.at(distance),
      normal: new Vector3D(-d.x, -d.y, -d.z),
    };
  }

  /**
   * World-space normal of the triangle starting at `indices[tri]`: the local face normal goes
   * through the inverse-transpose of the world matrix (correct under non-uniform scale), then is
   * flipped to face the ray.
   */
  private _worldTriangleNormal(
    vertices: ArrayLike<number>,
    indices: ArrayLike<number>,
    tri: number,
    invWorld: Matrix4,
  ): Vector3D {
    const i0 = (indices[tri] ?? 0) * 3;
    const i1 = (indices[tri + 1] ?? 0) * 3;
    const i2 = (indices[tri + 2] ?? 0) * 3;
    const e1x = (vertices[i1] ?? 0) - (vertices[i0] ?? 0);
    const e1y = (vertices[i1 + 1] ?? 0) - (vertices[i0 + 1] ?? 0);
    const e1z = (vertices[i1 + 2] ?? 0) - (vertices[i0 + 2] ?? 0);
    const e2x = (vertices[i2] ?? 0) - (vertices[i0] ?? 0);
    const e2y = (vertices[i2 + 1] ?? 0) - (vertices[i0 + 1] ?? 0);
    const e2z = (vertices[i2 + 2] ?? 0) - (vertices[i0 + 2] ?? 0);
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;

    const m = invWorld.data;
    const wx = m[0]! * nx + m[1]! * ny + m[2]! * nz;
    const wy = m[4]! * nx + m[5]! * ny + m[6]! * nz;
    const wz = m[8]! * nx + m[9]! * ny + m[10]! * nz;
    const len = Math.hypot(wx, wy, wz);
    if (len < 1e-12) {
      const d = this.ray.direction;
      return new Vector3D(-d.x, -d.y, -d.z);
    }
    const d = this.ray.direction;
    const sign = wx * d.x + wy * d.y + wz * d.z > 0 ? -1 : 1;
    const k = sign / len;
    return new Vector3D(wx * k, wy * k, wz * k);
  }

  /**
   * Direct Möller-Trumbore intersection algorithm using scalar vertex coordinates and a local ray.
   */
  private _intersectTriangleDirect(
    v0x: number,
    v0y: number,
    v0z: number,
    v1x: number,
    v1y: number,
    v1z: number,
    v2x: number,
    v2y: number,
    v2z: number,
    origin: Vector3D,
    dir: Vector3D,
  ): number {
    const EPSILON = 1e-6;

    const edge1X = v1x - v0x;
    const edge1Y = v1y - v0y;
    const edge1Z = v1z - v0z;

    const edge2X = v2x - v0x;
    const edge2Y = v2y - v0y;
    const edge2Z = v2z - v0z;

    const hX = dir.y * edge2Z - dir.z * edge2Y;
    const hY = dir.z * edge2X - dir.x * edge2Z;
    const hZ = dir.x * edge2Y - dir.y * edge2X;

    const a = edge1X * hX + edge1Y * hY + edge1Z * hZ;

    if (a > -EPSILON && a < EPSILON) {
      return -1;
    }

    const f = 1.0 / a;

    const sX = origin.x - v0x;
    const sY = origin.y - v0y;
    const sZ = origin.z - v0z;

    const u = f * (sX * hX + sY * hY + sZ * hZ);
    if (u < 0.0 || u > 1.0) {
      return -1;
    }

    const qX = sY * edge1Z - sZ * edge1Y;
    const qY = sZ * edge1X - sX * edge1Z;
    const qZ = sX * edge1Y - sY * edge1X;

    const v = f * (dir.x * qX + dir.y * qY + dir.z * qZ);
    if (v < 0.0 || u + v > 1.0) {
      return -1;
    }

    const t = f * (edge2X * qX + edge2Y * qY + edge2Z * qZ);
    if (t > EPSILON) {
      return t;
    }

    return -1;
  }
}
