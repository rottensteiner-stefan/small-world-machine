import { Collision } from "./Collision.js";
import type { Ray } from "./Ray.js";
import type { BoundingSphere } from "./BoundingSphere.js";
import type { BoundingVolume, BoundingVolumeShape, FrustumInterface } from "../interfaces/index.js";
import type { Matrix4 } from "../math/index.js";
import { Vector3D } from "../math/index.js";
import { BoundingType } from "../enums/index.js";

/**
 * Represents an axis-aligned bounding box (AABB).
 */
export class BoundingBox implements BoundingVolumeShape {
  /** @inheritdoc */
  public readonly type: typeof BoundingType.BOX = BoundingType.BOX;

  /** The center of the box. */
  public center: Vector3D = new Vector3D();

  /**
   * Creates a new BoundingBox.
   * @param min The minimum coordinates.
   * @param max The maximum coordinates.
   */
  constructor(
    public min: Vector3D = new Vector3D(Infinity, Infinity, Infinity),
    public max: Vector3D = new Vector3D(-Infinity, -Infinity, -Infinity),
  ) {
    this.center.copyFrom(min).add(max).scale(0.5);
  }

  /**
   * Creates a new BoundingBox that encapsulates all provided vertices.
   * @param vertices The raw vertex data [x, y, z, ...].
   * @returns A new BoundingBox instance.
   */
  public static fromVertices(vertices: ArrayLike<number>): BoundingBox {
    const min: Vector3D = new Vector3D(Infinity, Infinity, Infinity);
    const max: Vector3D = new Vector3D(-Infinity, -Infinity, -Infinity);

    for (let i: number = 0; i < vertices.length; i += 3) {
      const x: number = vertices[i]!;
      const y: number = vertices[i + 1]!;
      const z: number = vertices[i + 2]!;

      if (x < min.x) {
        min.x = x;
      }
      if (y < min.y) {
        min.y = y;
      }
      if (z < min.z) {
        min.z = z;
      }

      if (x > max.x) {
        max.x = x;
      }
      if (y > max.y) {
        max.y = y;
      }
      if (z > max.z) {
        max.z = z;
      }
    }

    return new BoundingBox(min, max);
  }

  /** @inheritdoc */
  public getBroadRadius(): number {
    return this.min.distanceTo(this.max) * 0.5;
  }

  /**
   * Checks if a point is inside the box.
   * @param point The point to check.
   * @returns True if inside.
   */
  public containsPoint(point: Vector3D): boolean {
    return (
      point.x >= this.min.x &&
      point.x <= this.max.x &&
      point.y >= this.min.y &&
      point.y <= this.max.y &&
      point.z >= this.min.z &&
      point.z <= this.max.z
    );
  }

  /**
   * Checks if another box intersects with this one.
   * @param other The other box.
   * @returns True if intersecting.
   */
  public intersectsBox(other: BoundingBox): boolean {
    return (
      this.min.x <= other.max.x &&
      this.max.x >= other.min.x &&
      this.min.y <= other.max.y &&
      this.max.y >= other.min.y &&
      this.min.z <= other.max.z &&
      this.max.z >= other.min.z
    );
  }

  /**
   * Checks if another box is entirely contained within this one.
   * @param other The other box.
   * @returns True if entirely contained.
   */
  public containsBox(other: BoundingBox): boolean {
    return (
      this.min.x <= other.min.x &&
      this.max.x >= other.max.x &&
      this.min.y <= other.min.y &&
      this.max.y >= other.max.y &&
      this.min.z <= other.min.z &&
      this.max.z >= other.max.z
    );
  }

  /**
   * Checks if a sphere is entirely contained within this box.
   * @param other The sphere.
   * @returns True if entirely contained.
   */
  public containsSphere(other: BoundingSphere): boolean {
    return (
      this.min.x <= other.center.x - other.radius &&
      this.max.x >= other.center.x + other.radius &&
      this.min.y <= other.center.y - other.radius &&
      this.max.y >= other.center.y + other.radius &&
      this.min.z <= other.center.z - other.radius &&
      this.max.z >= other.center.z + other.radius
    );
  }

  /** @inheritdoc */
  public intersectsFrustum(frustum: FrustumInterface): boolean {
    const p: Float32Array = frustum.planes;

    for (let i: number = 0; 6 > i; i++) {
      const idx: number = i * 4;
      const p0 = p[idx]!;
      const p1 = p[idx + 1]!;
      const p2 = p[idx + 2]!;
      const p3 = p[idx + 3]!;

      const px: number = 0 <= p0 ? this.max.x : this.min.x;
      const py: number = 0 <= p1 ? this.max.y : this.min.y;
      const pz: number = 0 <= p2 ? this.max.z : this.min.z;

      const dist: number = p0 * px + p1 * py + p2 * pz + p3;

      if (0 > dist) {
        return false;
      }
    }

    return true;
  }

  /** @inheritdoc */
  public intersectsVolume(other: BoundingVolume): boolean {
    return Collision.test(this, other);
  }

  /** @inheritdoc */
  public containsVolume(other: BoundingVolume): boolean {
    if (BoundingType.BOX === other.type) {
      return this.containsBox(other);
    }
    if (BoundingType.SPHERE === other.type) {
      return this.containsSphere(other);
    }
    if (BoundingType.OBB === other.type) {
      // Conservative sphere-approximation, consistent with how OBBs are already treated for
      // broad-phase elsewhere (getBroadRadius()). Without this branch, containment for OBB-typed
      // bounds always returns false, so an OBB-bounded object can never be inserted into an
      // Octree regardless of the tree's actual extent.
      //
      // Deliberately NOT delegating to containsSphere(): an OBB has no `.radius` field, so reusing
      // it would mean allocating `new BoundingSphere(...)` on a path called once per OBB-bounded
      // object on every dynamic-octree rebuild (i.e. every frame -- see
      // Scene.updateDynamicOctree()). Inlining the comparison keeps this alloc-free.
      const r = other.getBroadRadius();
      const c = other.center;
      return (
        this.min.x <= c.x - r &&
        this.max.x >= c.x + r &&
        this.min.y <= c.y - r &&
        this.max.y >= c.y + r &&
        this.min.z <= c.z - r &&
        this.max.z >= c.z + r
      );
    }
    if (BoundingType.HULL === other.type) {
      // Same conservative sphere-approximation as the OBB branch above, and for
      // the same reason -- without it, a ConvexHull-bounded object (e.g. a
      // Voronoi fracture shard) can never be inserted into an Octree.
      const r = other.getBroadRadius();
      const c = other.center;
      return (
        this.min.x <= c.x - r &&
        this.max.x >= c.x + r &&
        this.min.y <= c.y - r &&
        this.max.y >= c.y + r &&
        this.min.z <= c.z - r &&
        this.max.z >= c.z + r
      );
    }
    return false;
  }

  /** @inheritdoc */
  public transform(matrix: Matrix4): void {
    const e = matrix.data;
    const minX = this.min.x;
    const minY = this.min.y;
    const minZ = this.min.z;
    const maxX = this.max.x;
    const maxY = this.max.y;
    const maxZ = this.max.z;

    // Translation component
    let newMinX = e[12]!;
    let newMaxX = e[12]!;
    let newMinY = e[13]!;
    let newMaxY = e[13]!;
    let newMinZ = e[14]!;
    let newMaxZ = e[14]!;

    // X column contribution
    let a = e[0]! * minX;
    let b = e[0]! * maxX;
    if (a < b) {
      newMinX += a;
      newMaxX += b;
    } else {
      newMinX += b;
      newMaxX += a;
    }

    a = e[1]! * minX;
    b = e[1]! * maxX;
    if (a < b) {
      newMinY += a;
      newMaxY += b;
    } else {
      newMinY += b;
      newMaxY += a;
    }

    a = e[2]! * minX;
    b = e[2]! * maxX;
    if (a < b) {
      newMinZ += a;
      newMaxZ += b;
    } else {
      newMinZ += b;
      newMaxZ += a;
    }

    // Y column contribution
    a = e[4]! * minY;
    b = e[4]! * maxY;
    if (a < b) {
      newMinX += a;
      newMaxX += b;
    } else {
      newMinX += b;
      newMaxX += a;
    }

    a = e[5]! * minY;
    b = e[5]! * maxY;
    if (a < b) {
      newMinY += a;
      newMaxY += b;
    } else {
      newMinY += b;
      newMaxY += a;
    }

    a = e[6]! * minY;
    b = e[6]! * maxY;
    if (a < b) {
      newMinZ += a;
      newMaxZ += b;
    } else {
      newMinZ += b;
      newMaxZ += a;
    }

    // Z column contribution
    a = e[8]! * minZ;
    b = e[8]! * maxZ;
    if (a < b) {
      newMinX += a;
      newMaxX += b;
    } else {
      newMinX += b;
      newMaxX += a;
    }

    a = e[9]! * minZ;
    b = e[9]! * maxZ;
    if (a < b) {
      newMinY += a;
      newMaxY += b;
    } else {
      newMinY += b;
      newMaxY += a;
    }

    a = e[10]! * minZ;
    b = e[10]! * maxZ;
    if (a < b) {
      newMinZ += a;
      newMaxZ += b;
    } else {
      newMinZ += b;
      newMaxZ += a;
    }

    this.min.set(newMinX, newMinY, newMinZ);
    this.max.set(newMaxX, newMaxY, newMaxZ);
    this.center.set(
      (newMinX + newMaxX) * 0.5,
      (newMinY + newMaxY) * 0.5,
      (newMinZ + newMaxZ) * 0.5,
    );
  }

  /** @inheritdoc */
  public getAabb(): BoundingBox {
    return new BoundingBox(this.min.clone(), this.max.clone());
  }

  /** @inheritdoc */
  public translate(v: Vector3D): void {
    this.min.add(v);
    this.max.add(v);
    this.center.add(v);
  }

  /** @inheritdoc */
  public intersectsRay(ray: Ray): boolean {
    return 0 <= ray.intersectsBox(this);
  }

  /** @inheritdoc */
  public surfaceNormalAt(point: Vector3D): Vector3D {
    const dxMin = Math.abs(point.x - this.min.x);
    const dxMax = Math.abs(point.x - this.max.x);
    const dyMin = Math.abs(point.y - this.min.y);
    const dyMax = Math.abs(point.y - this.max.y);
    const dzMin = Math.abs(point.z - this.min.z);
    const dzMax = Math.abs(point.z - this.max.z);
    const minD = Math.min(dxMin, dxMax, dyMin, dyMax, dzMin, dzMax);
    if (minD === dxMin) return new Vector3D(-1, 0, 0);
    if (minD === dxMax) return new Vector3D(1, 0, 0);
    if (minD === dyMin) return new Vector3D(0, -1, 0);
    if (minD === dyMax) return new Vector3D(0, 1, 0);
    if (minD === dzMin) return new Vector3D(0, 0, -1);
    return new Vector3D(0, 0, 1);
  }

  /** @inheritdoc */
  public volume(): number {
    return (this.max.x - this.min.x) * (this.max.y - this.min.y) * (this.max.z - this.min.z);
  }

  /** @inheritdoc */
  public closestPoint(point: Vector3D): Vector3D {
    const cx = Math.max(this.min.x, Math.min(point.x, this.max.x));
    const cy = Math.max(this.min.y, Math.min(point.y, this.max.y));
    const cz = Math.max(this.min.z, Math.min(point.z, this.max.z));
    // Outside (or on the boundary): the clamped point is the closest surface point.
    if (cx !== point.x || cy !== point.y || cz !== point.z) {
      return new Vector3D(cx, cy, cz);
    }
    // Strictly inside: push onto the nearest face.
    const dxMin = point.x - this.min.x;
    const dxMax = this.max.x - point.x;
    const dyMin = point.y - this.min.y;
    const dyMax = this.max.y - point.y;
    const dzMin = point.z - this.min.z;
    const dzMax = this.max.z - point.z;
    const minD = Math.min(dxMin, dxMax, dyMin, dyMax, dzMin, dzMax);
    if (minD === dxMin) return new Vector3D(this.min.x, cy, cz);
    if (minD === dxMax) return new Vector3D(this.max.x, cy, cz);
    if (minD === dyMin) return new Vector3D(cx, this.min.y, cz);
    if (minD === dyMax) return new Vector3D(cx, this.max.y, cz);
    if (minD === dzMin) return new Vector3D(cx, cy, this.min.z);
    return new Vector3D(cx, cy, this.max.z);
  }

  /** @inheritdoc */
  public cloneEmpty(): BoundingVolume {
    return new BoundingBox();
  }

  /** @inheritdoc */
  public setFromLocal(center: Vector3D, halfExtents: Vector3D): void {
    this.min.set(center.x - halfExtents.x, center.y - halfExtents.y, center.z - halfExtents.z);
    this.max.set(center.x + halfExtents.x, center.y + halfExtents.y, center.z + halfExtents.z);
    this.center.copyFrom(center);
  }
}
